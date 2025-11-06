import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

// Set the app name for macOS menu bar
app.setName('MIDI Browser');

let mainWindow: BrowserWindow | null = null;

function createMenu() {
  const template: any[] = [
    {
      label: 'MIDI Browser',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MIDI Browser',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 10 }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers for file system operations
ipcMain.handle('read-directory', async (event, dirPath: string) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      // Skip hidden files and folders (those starting with .)
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true
        });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.mid', '.midi', '.wav', '.mp3', '.ogg', '.m4a', '.flac'].includes(ext)) {
          const stats = await fs.stat(fullPath);
          result.push({
            name: entry.name,
            path: fullPath,
            isDirectory: false,
            isMidi: ['.mid', '.midi'].includes(ext),
            isAudio: ['.wav', '.mp3', '.ogg', '.m4a', '.flac'].includes(ext),
            size: stats.size,
            modified: stats.mtime
          });
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

ipcMain.handle('read-file', async (event, filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    return buffer;
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

// Read file with retry for Dropbox online-only files
ipcMain.handle('read-file-with-retry', async (event, filePath: string, maxRetries: number = 5) => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check file stats first
      const stats = await fs.stat(filePath);

      // If file is 0 bytes, it's likely a Dropbox online-only file
      if (stats.size === 0 && attempt === 0) {
        console.log(`File is 0 bytes (online-only), attempting to trigger sync: ${filePath}`);
        // Try to read it anyway - this triggers Dropbox to download
        try {
          await fs.readFile(filePath);
        } catch (e) {
          // Expected to fail on first try
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // If file has size, try to read it
      if (stats.size > 0) {
        const buffer = await fs.readFile(filePath);
        if (buffer.length > 0) {
          console.log(`Successfully read file on attempt ${attempt + 1}: ${filePath}`);
          return buffer;
        }
      }

      // If we get here, wait and retry
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(`File not ready, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Error reading file, retrying in ${delay}ms: ${error}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error('Failed to read file after retries:', filePath);
  throw lastError || new Error('Failed to read file after retries');
});

// Pre-sync all MIDI files in a directory (for Dropbox)
ipcMain.handle('presync-midi-files', async (event, dirPath: string) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const syncPromises: Promise<void>[] = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.mid', '.midi'].includes(ext)) {
          const fullPath = path.join(dirPath, entry.name);

          // Trigger sync by attempting to read (don't wait for it)
          syncPromises.push(
            (async () => {
              try {
                const stats = await fs.stat(fullPath);
                if (stats.size === 0) {
                  console.log(`Pre-syncing MIDI file: ${entry.name}`);
                  // Just open and close to trigger Dropbox sync
                  await fs.readFile(fullPath);
                }
              } catch (e) {
                // Ignore errors during pre-sync
              }
            })()
          );
        }
      }
    }

    // Don't wait for all to complete, just trigger them
    Promise.all(syncPromises).catch(() => {});

    return { triggered: syncPromises.length };
  } catch (error) {
    console.error('Error pre-syncing MIDI files:', error);
    return { triggered: 0 };
  }
});

ipcMain.handle('get-home-directory', async () => {
  return app.getPath('home');
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }

  return null;
});

ipcMain.handle('get-file-info', async (event, filePath: string) => {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    const dirPath = path.dirname(filePath);
    const fileName = path.basename(filePath);

    return {
      dirPath,
      fileName
    };
  } catch (error) {
    console.error('Error getting file info:', error);
    return null;
  }
});
