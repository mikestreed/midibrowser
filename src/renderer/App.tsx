import React, { useState, useEffect, useCallback } from 'react';
import FileList from './components/FileList';
import QuickLook from './components/QuickLook';
import { FileEntry } from './types';

const { ipcRenderer } = window.require('electron');

const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [quickLookFile, setQuickLookFile] = useState<FileEntry | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const entries: FileEntry[] = await ipcRenderer.invoke('read-directory', path);

      // Sort: directories first, then by name
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      setFiles(entries);
      setCurrentPath(path);
      setSelectedIndex(-1);
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleFileClick = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleFileDoubleClick = useCallback((file: FileEntry) => {
    if (file.isDirectory) {
      navigateToPath(file.path);
    } else {
      setQuickLookFile(file);
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

    const pathParts = currentPath.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      pathParts.pop(); // Remove last segment
      const parentPath = '/' + pathParts.join('/');
      navigateToPath(parentPath || '/');
    }
  }, [currentPath, navigateToPath]);

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
    const file = files[index];
    if (!file.isDirectory) {
      setQuickLookFile(file);
    }
  }, [files]);

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

    // Find and select the file
    // We need to wait for the files to be loaded
    setTimeout(() => {
      setFiles((currentFiles) => {
        const fileIndex = currentFiles.findIndex((f) => f.name === fileName);
        if (fileIndex >= 0) {
          setSelectedIndex(fileIndex);
        }
        return currentFiles;
      });
    }, 100);
  }, [loadDirectory, pathHistory, historyIndex]);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when Quick Look is open (it handles its own)
      if (quickLookFile) return;

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
        handleFileDoubleClick(files[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [files, selectedIndex, quickLookFile, handleFileDoubleClick, navigateUp]);

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
      </div>

      <FileList
        files={files}
        selectedIndex={selectedIndex}
        loading={loading}
        onFileClick={handleFileClick}
        onFileDoubleClick={handleFileDoubleClick}
      />

      {quickLookFile && (
        <QuickLook
          file={quickLookFile}
          files={files}
          currentIndex={selectedIndex}
          onClose={closeQuickLook}
          onNavigate={handleQuickLookNavigate}
        />
      )}
    </div>
  );
};

export default App;
