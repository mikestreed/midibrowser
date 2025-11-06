import React from 'react';
import { FileEntry } from '../types';
import FileListItem from './FileListItem';

interface FileListProps {
  files: FileEntry[];
  selectedIndex: number;
  loading: boolean;
  scanMode: boolean;
  scanning: boolean;
  column?: 'left' | 'right';
  onFileMove?: (sourcePath: string, targetDir: string) => void;
  onFileClick: (index: number) => void;
  onFileDoubleClick: (file: FileEntry) => void;
}

const FileList: React.FC<FileListProps> = ({
  files,
  selectedIndex,
  loading,
  scanMode,
  scanning,
  column,
  onFileMove,
  onFileClick,
  onFileDoubleClick
}) => {
  if (loading || scanning) {
    return (
      <div className="loading">
        {scanning ? 'Scanning...' : 'Loading...'}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🎵</div>
        <h2 className="empty-state-title">No MIDI or audio files found</h2>
        <p className="empty-state-subtitle">
          Navigate to a folder containing MIDI (.mid, .midi) or audio files (.wav, .mp3, etc.)
        </p>
      </div>
    );
  }

  return (
    <div className="file-list-container">
      <table className="file-table">
        <thead>
          <tr>
            <th>Name</th>
            {column === 'left' ? (
              <>
                <th style={{ width: '80px' }}>Size</th>
                <th style={{ width: '70px' }}>Files</th>
              </>
            ) : (
              <>
                <th style={{ width: '80px' }}>Length</th>
                <th style={{ width: '70px' }}>Tempo</th>
                <th style={{ width: '70px' }}>Tracks</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {files.map((file, index) => (
            <FileListItem
              key={file.path}
              file={file}
              selected={index === selectedIndex}
              scanMode={scanMode}
              column={column}
              onFileMove={onFileMove}
              onClick={() => onFileClick(index)}
              onDoubleClick={() => onFileDoubleClick(file)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FileList;
