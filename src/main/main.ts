import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
ipcMain.handle('read-file-with-retry', async (event, filePath: string, maxRetries: number = 10) => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check file stats first
      const stats = await fs.stat(filePath);

      // If file is 0 bytes, it's likely a Dropbox online-only file
      if (stats.size === 0) {
        console.log(`File is 0 bytes (online-only) on attempt ${attempt + 1}, triggering sync: ${filePath}`);

        // Use 'cat' command to trigger Dropbox Smart Sync without opening any app
        if (attempt === 0) {
          try {
            // Escape the file path for shell
            const escapedPath = filePath.replace(/'/g, "'\\''");
            // Cat the file to /dev/null to trigger download without opening Logic Pro
            execAsync(`cat '${escapedPath}' > /dev/null 2>&1`).catch(() => {});
            console.log(`Triggered Dropbox sync with 'cat' command (no app will open)`);
          } catch (e) {
            console.log(`Error triggering sync: ${e}`);
          }
        }

        // Wait progressively longer for download to complete
        const delay = Math.min(1500 + (attempt * 1000), 8000);
        console.log(`Waiting ${delay}ms for Dropbox to download file...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // If file has size, try to read it
      if (stats.size > 0) {
        const buffer = await fs.readFile(filePath);
        if (buffer.length > 0) {
          console.log(`Successfully read file (${buffer.length} bytes) on attempt ${attempt + 1}: ${filePath}`);
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

// Recursively scan for folders containing MIDI files
ipcMain.handle('scan-for-midi-folders', async (event, rootPath: string) => {
  const results: Array<{
    name: string;
    path: string;
    fileCount: number;
    totalSize: number;
  }> = [];

  async function scanDirectory(dirPath: string) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      let midiFiles: string[] = [];
      const subdirs: string[] = [];

      // First pass: find MIDI files and subdirectories
      for (const entry of entries) {
        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          subdirs.push(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.mid', '.midi'].includes(ext)) {
            midiFiles.push(fullPath);
          }
        }
      }

      // If this folder has MIDI files directly in it, add it to results
      if (midiFiles.length > 0) {
        let totalSize = 0;
        for (const filePath of midiFiles) {
          try {
            const stats = await fs.stat(filePath);
            totalSize += stats.size;
          } catch (e) {
            // Skip files we can't stat
          }
        }

        results.push({
          name: path.basename(dirPath),
          path: dirPath,
          fileCount: midiFiles.length,
          totalSize: totalSize
        });
      }

      // Recursively scan subdirectories
      for (const subdir of subdirs) {
        await scanDirectory(subdir);
      }

    } catch (error) {
      // Skip directories we can't read
      console.error(`Error scanning ${dirPath}:`, error);
    }
  }

  await scanDirectory(rootPath);

  // Sort alphabetically by folder name
  results.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Scan found ${results.length} folders with MIDI files`);
  return results;
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

          // Trigger sync by reading file with 'cat' (don't wait for it)
          syncPromises.push(
            (async () => {
              try {
                const stats = await fs.stat(fullPath);
                if (stats.size === 0) {
                  console.log(`Pre-syncing MIDI file: ${entry.name}`);
                  // Use 'cat' to trigger Dropbox Smart Sync without opening any app
                  try {
                    const escapedPath = fullPath.replace(/'/g, "'\\''");
                    execAsync(`cat '${escapedPath}' > /dev/null 2>&1`).catch(() => {});
                  } catch (e) {
                    // Ignore errors
                  }
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

// Handle native drag and drop out of app
ipcMain.on('ondragstart', (event, filePath: string) => {
  event.sender.startDrag({
    file: filePath,
    icon: path.join(__dirname, 'icon.png') // Optional: add drag icon
  });
});

// Move file from one location to another
ipcMain.handle('move-file', async (event, sourcePath: string, targetDir: string) => {
  try {
    const fileName = path.basename(sourcePath);
    const destPath = path.join(targetDir, fileName);

    // Check if target already exists
    try {
      await fs.access(destPath);
      throw new Error('File already exists in target directory');
    } catch (err: any) {
      // File doesn't exist, proceed with move
      if (err.code !== 'ENOENT') throw err;
    }

    // Move the file
    await fs.rename(sourcePath, destPath);
    console.log(`Moved file from ${sourcePath} to ${destPath}`);
    return { success: true, newPath: destPath };
  } catch (error: any) {
    console.error('Error moving file:', error);
    return { success: false, error: error.message };
  }
});
