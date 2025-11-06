import React, { useState, useEffect, useCallback } from 'react';
import FileList from './components/FileList';
import QuickLook from './components/QuickLook';
import { FileEntry } from './types';

const { ipcRenderer } = window.require('electron');

const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [leftFiles, setLeftFiles] = useState<FileEntry[]>([]);
  const [rightFiles, setRightFiles] = useState<FileEntry[]>([]);
  const [leftPath, setLeftPath] = useState<string>('');
  const [rightPath, setRightPath] = useState<string>('');
  const [selectedColumn, setSelectedColumn] = useState<'left' | 'right'>('right');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [quickLookFile, setQuickLookFile] = useState<FileEntry | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingLeft, setLoadingLeft] = useState<boolean>(false);
  const [loadingRight, setLoadingRight] = useState<boolean>(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [scanMode, setScanMode] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<FileEntry[]>([]);
  const [scanRootPath, setScanRootPath] = useState<string>('');
  const [favoritesFirst, setFavoritesFirst] = useState<boolean>(false);

  // Helper function to check if a file is marked as favorite
  const isFavorite = (fileName: string): boolean => {
    const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    return nameWithoutExt.endsWith('🟢');
  };

  // Helper function to filter and sort files
  const filterAndSortFiles = useCallback((files: FileEntry[], sortFavoritesFirst: boolean): FileEntry[] => {
    // Filter out files starting with 'xxxxx'
    const filtered = files.filter(file => !file.name.startsWith('xxxxx'));

    // Sort files
    filtered.sort((a, b) => {
      // If favorites sorting is enabled
      if (sortFavoritesFirst) {
        const aIsFav = !a.isDirectory && isFavorite(a.name);
        const bIsFav = !b.isDirectory && isFavorite(b.name);

        if (aIsFav && !bIsFav) return -1;
        if (!aIsFav && bIsFav) return 1;
      }

      // Directories first, then alphabetical
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, []);

  const loadDirectory = useCallback(async (path: string, keepScanResults: boolean = false) => {
    setLoadingLeft(!keepScanResults);
    setLoadingRight(true);

    try {
      // If we have scan results and should keep them, don't load parent folder
      if (!keepScanResults || scanResults.length === 0) {
        setScanMode(false);

        // Load parent folder for left column
        const pathParts = path.split('/').filter(Boolean);
        let parentPath = '/';
        if (pathParts.length > 0) {
          pathParts.pop();
          parentPath = '/' + pathParts.join('/');
        }

        // Load parent directory
        const parentEntries: FileEntry[] = await ipcRenderer.invoke('read-directory', parentPath);

        // Calculate folder stats for directories in parent
        const statsPromises = parentEntries.map(async (entry) => {
          if (entry.isDirectory) {
            const stats = await ipcRenderer.invoke('get-folder-stats', entry.path);
            entry.size = stats.size;
            entry.fileCount = stats.fileCount;
          }
          return entry;
        });

        const parentWithStats = await Promise.all(statsPromises);

        // Filter and sort parent files
        const sortedParent = filterAndSortFiles(parentWithStats, favoritesFirst);
        setLeftFiles(sortedParent);
        setLeftPath(parentPath);
      }

      // Load current directory
      const entries: FileEntry[] = await ipcRenderer.invoke('read-directory', path);

      // Filter and sort current directory files
      const sortedEntries = filterAndSortFiles(entries, favoritesFirst);
      setRightFiles(sortedEntries);
      setRightPath(path);
      setCurrentPath(path);
      setSelectedIndex(-1);
      setSelectedColumn('right');

      // Pre-sync all MIDI files in this folder (for Dropbox online-only files)
      ipcRenderer.invoke('presync-midi-files', path).then((result: any) => {
        if (result.triggered > 0) {
          console.log(`Triggered sync for ${result.triggered} MIDI files`);
        }
      }).catch((err: any) => {
        console.error('Error pre-syncing files:', err);
      });
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setLoadingLeft(false);
      setLoadingRight(false);
      setLoading(false);
    }
  }, [scanResults, favoritesFirst, filterAndSortFiles]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanMode(true);
    setSelectedIndex(-1);

    try {
      const results = await ipcRenderer.invoke('scan-for-midi-folders', currentPath);

      // Convert scan results to FileEntry format
      const scanEntries: FileEntry[] = results.map((result: any) => ({
        name: result.name,
        path: result.path,
        isDirectory: true,
        isMidi: false,
        isAudio: false,
        size: result.totalSize,
        modified: new Date(),
        fileCount: result.fileCount // Add custom property for scan mode
      }));

      setScanResults(scanEntries);
      setScanRootPath(currentPath);
      // Scan results go to LEFT column, RIGHT column becomes empty
      const sortedScanEntries = filterAndSortFiles(scanEntries, favoritesFirst);
      setLeftFiles(sortedScanEntries);
      setRightFiles([]);
      setLeftPath(currentPath + ' (scan results)');
      setRightPath('');
      setSelectedColumn('left');
      console.log(`Scan complete: found ${scanEntries.length} folders with MIDI files`);
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setScanning(false);
    }
  }, [currentPath, filterAndSortFiles, favoritesFirst]);

  const navigateToPath = useCallback((path: string) => {
    const newHistory = pathHistory.slice(0, historyIndex + 1);
    newHistory.push(path);
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    loadDirectory(path);
  }, [pathHistory, historyIndex, loadDirectory]);

  const navigateBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      loadDirectory(pathHistory[newIndex]);
    }
  }, [historyIndex, pathHistory, loadDirectory]);

  const navigateForward = useCallback(() => {
    if (historyIndex < pathHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      loadDirectory(pathHistory[newIndex]);
    }
  }, [historyIndex, pathHistory, loadDirectory]);

  const handleFileClick = useCallback((column: 'left' | 'right', index: number) => {
    const files = column === 'left' ? leftFiles : rightFiles;
    const file = files[index];

    // Single click on folder in left column should navigate
    if (column === 'left' && file.isDirectory) {
      // If in scan mode, keep scan results in left column
      loadDirectory(file.path, scanMode);
    } else {
      setSelectedColumn(column);
      setSelectedIndex(index);
    }
  }, [leftFiles, rightFiles, scanMode, loadDirectory]);

  const handleFileDoubleClick = useCallback(async (column: 'left' | 'right', file: FileEntry) => {
    if (file.isDirectory) {
      navigateToPath(file.path);
    } else {
      // Double-click on a file reveals it in Finder
      await ipcRenderer.invoke('reveal-in-finder', file.path);
    }
  }, [navigateToPath]);

  const handleChooseFolder = useCallback(async () => {
    const path = await ipcRenderer.invoke('select-directory');
    if (path) {
      navigateToPath(path);
    }
  }, [navigateToPath]);

  const navigateUp = useCallback(() => {
    if (!currentPath) return;

    // If we came from scan results, go back to them
    if (scanResults.length > 0 && currentPath !== scanRootPath) {
      setScanMode(true);
      setLeftFiles(scanResults);
      setRightFiles([]);
      setLeftPath(scanRootPath + ' (scan results)');
      setRightPath('');
      setCurrentPath(scanRootPath);
      setSelectedIndex(-1);
      setSelectedColumn('left');
      return;
    }

    const pathParts = currentPath.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      pathParts.pop(); // Remove last segment
      const parentPath = '/' + pathParts.join('/');
      navigateToPath(parentPath || '/');
    }
  }, [currentPath, navigateToPath, scanResults, scanRootPath]);

  const handleBreadcrumbClick = useCallback((index: number) => {
    const pathParts = currentPath.split('/').filter(Boolean);
    const newPathParts = pathParts.slice(0, index + 1);
    const newPath = '/' + newPathParts.join('/');
    navigateToPath(newPath);
  }, [currentPath, navigateToPath]);

  const closeQuickLook = useCallback(() => {
    setQuickLookFile(null);
  }, []);

  const handleQuickLookNavigate = useCallback((index: number) => {
    setSelectedIndex(index);
    const files = selectedColumn === 'left' ? leftFiles : rightFiles;
    const file = files[index];
    if (!file.isDirectory) {
      setQuickLookFile(file);
    }
  }, [leftFiles, rightFiles, selectedColumn]);

  const handleFileMove = useCallback(async (sourcePath: string, targetDir: string) => {
    const result = await ipcRenderer.invoke('move-file', sourcePath, targetDir);
    if (result.success) {
      console.log('File moved successfully:', result.newPath);
      // Refresh the current directory to show the changes
      loadDirectory(currentPath);
    } else {
      console.error('Failed to move file:', result.error);
      alert(`Failed to move file: ${result.error}`);
    }
  }, [currentPath, loadDirectory]);

  // Handle file drop
  const handleFileDrop = useCallback(async (filePath: string) => {
    const fileInfo = await ipcRenderer.invoke('get-file-info', filePath);

    if (!fileInfo) {
      console.log('Not a valid file');
      return;
    }

    const { dirPath, fileName } = fileInfo;

    // Load the directory
    await loadDirectory(dirPath);

    // Update history
    const newHistory = pathHistory.slice(0, historyIndex + 1);
    newHistory.push(dirPath);
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Find and select the file in the right column
    // We need to wait for the files to be loaded
    setTimeout(() => {
      const fileIndex = rightFiles.findIndex((f: FileEntry) => f.name === fileName);
      if (fileIndex >= 0) {
        setSelectedIndex(fileIndex);
        setSelectedColumn('right');
      }
    }, 100);
  }, [loadDirectory, pathHistory, historyIndex, rightFiles]);

  // Drag and drop handlers
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const filePath = files[0].path;
        handleFileDrop(filePath);
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [handleFileDrop]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't handle shortcuts when Quick Look is open (it handles its own)
      if (quickLookFile) return;

      const files = selectedColumn === 'left' ? leftFiles : rightFiles;

      // Backspace or Delete: prefix filename with 'xxxxx' to hide
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIndex >= 0) {
        e.preventDefault();
        const file = files[selectedIndex];
        if (!file.isDirectory && (file.isMidi || file.isAudio)) {
          const newName = 'xxxxx' + file.name;
          const result = await ipcRenderer.invoke('rename-file', file.path, newName);
          if (result.success) {
            // Reload the current directory
            loadDirectory(currentPath);
          }
        }
        return;
      }

      // = or + key: add green circle emoji to mark as favorite
      if ((e.key === '=' || e.key === '+') && selectedIndex >= 0) {
        e.preventDefault();
        const file = files[selectedIndex];
        if (!file.isDirectory && (file.isMidi || file.isAudio)) {
          // Extract name and extension
          const lastDot = file.name.lastIndexOf('.');
          const nameWithoutExt = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;
          const ext = lastDot > 0 ? file.name.substring(lastDot) : '';

          // Always add a green circle
          const newName = nameWithoutExt + '🟢' + ext;

          const result = await ipcRenderer.invoke('rename-file', file.path, newName);
          if (result.success) {
            // Reload the current directory
            loadDirectory(currentPath);
          }
        }
        return;
      }

      // - key: remove the last character from filename
      if (e.key === '-' && selectedIndex >= 0) {
        e.preventDefault();
        const file = files[selectedIndex];
        if (!file.isDirectory && (file.isMidi || file.isAudio)) {
          // Extract name and extension
          const lastDot = file.name.lastIndexOf('.');
          const nameWithoutExt = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;
          const ext = lastDot > 0 ? file.name.substring(lastDot) : '';

          // Remove the last character if there are any characters
          if (nameWithoutExt.length > 0) {
            const chars = Array.from(nameWithoutExt);
            chars.pop(); // Remove last character
            const newName = chars.join('') + ext;
            const result = await ipcRenderer.invoke('rename-file', file.path, newName);
            if (result.success) {
              // Reload the current directory
              loadDirectory(currentPath);
            }
          }
        }
        return;
      }

      // Escape to go back
      if (e.key === 'Escape') {
        e.preventDefault();
        navigateUp();
        return;
      }

      // Left arrow to select left column
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedColumn('left');
        setSelectedIndex(Math.min(selectedIndex, leftFiles.length - 1));
        return;
      }

      // Right arrow to select right column
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedColumn('right');
        setSelectedIndex(Math.min(selectedIndex, rightFiles.length - 1));
        return;
      }

      // Cmd+Up to go up one folder level (Mac)
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        navigateUp();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(-1, prev - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(files.length - 1, prev + 1));
      } else if (e.key === ' ' && selectedIndex >= 0) {
        e.preventDefault();
        const file = files[selectedIndex];
        if (!file.isDirectory) {
          setQuickLookFile(file);
        }
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleFileDoubleClick(selectedColumn, files[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [leftFiles, rightFiles, selectedColumn, selectedIndex, quickLookFile, handleFileDoubleClick, navigateUp, currentPath, loadDirectory]);

  // Re-sort files when favorites toggle changes
  useEffect(() => {
    if (leftFiles.length > 0) {
      const sortedLeft = filterAndSortFiles([...leftFiles], favoritesFirst);
      setLeftFiles(sortedLeft);
    }
    if (rightFiles.length > 0) {
      const sortedRight = filterAndSortFiles([...rightFiles], favoritesFirst);
      setRightFiles(sortedRight);
    }
  }, [favoritesFirst]); // Only run when favoritesFirst changes

  // Load home directory on startup
  useEffect(() => {
    (async () => {
      const homePath = await ipcRenderer.invoke('get-home-directory');
      navigateToPath(homePath);
    })();
  }, []);

  return (
    <div className="app">
      <div className="title-bar">
        <div className="navigation-buttons">
          <button
            className="nav-button"
            onClick={navigateBack}
            disabled={historyIndex <= 0}
            title="Back"
          >
            ←
          </button>
          <button
            className="nav-button"
            onClick={navigateForward}
            disabled={historyIndex >= pathHistory.length - 1}
            title="Forward"
          >
            →
          </button>
        </div>
        <div className="path-display">
          <span className="breadcrumb-root" onClick={() => navigateToPath('/')}>
            /
          </span>
          {currentPath.split('/').filter(Boolean).map((segment, index) => (
            <span key={index}>
              <span className="breadcrumb-separator">/</span>
              <span
                className="breadcrumb-segment"
                onClick={() => handleBreadcrumbClick(index)}
              >
                {segment}
              </span>
            </span>
          ))}
        </div>
        <button className="choose-folder-button" onClick={handleChooseFolder}>
          Choose Folder
        </button>
        <button className="scan-button" onClick={handleScan} disabled={scanning}>
          {scanning ? 'Scanning...' : 'SCAN'}
        </button>
        <button
          className={`favorites-toggle-button ${favoritesFirst ? 'active' : ''}`}
          onClick={() => setFavoritesFirst(!favoritesFirst)}
          title="Sort favorites first"
        >
          🟢↑
        </button>
      </div>

      <div className="two-column-container">
        <div className="column left-column">
          <FileList
            files={leftFiles}
            selectedIndex={selectedColumn === 'left' ? selectedIndex : -1}
            loading={loadingLeft}
            scanMode={scanMode}
            scanning={false}
            column="left"
            onFileMove={handleFileMove}
            onFileClick={(index) => handleFileClick('left', index)}
            onFileDoubleClick={(file) => handleFileDoubleClick('left', file)}
          />
        </div>
        <div className="column right-column">
          <FileList
            files={rightFiles}
            selectedIndex={selectedColumn === 'right' ? selectedIndex : -1}
            loading={loadingRight}
            scanMode={false}
            scanning={scanning}
            column="right"
            onFileMove={handleFileMove}
            onFileClick={(index) => handleFileClick('right', index)}
            onFileDoubleClick={(file) => handleFileDoubleClick('right', file)}
          />
        </div>
      </div>

      {quickLookFile && (
        <QuickLook
          file={quickLookFile}
          files={selectedColumn === 'left' ? leftFiles : rightFiles}
          currentIndex={selectedIndex}
          onClose={closeQuickLook}
          onNavigate={handleQuickLookNavigate}
        />
      )}
    </div>
  );
};

export default App;
