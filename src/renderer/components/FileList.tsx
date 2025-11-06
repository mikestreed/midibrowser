import React from 'react';
import { FileEntry } from '../types';
import FileListItem from './FileListItem';

interface FileListProps {
  files: FileEntry[];
  selectedIndex: number;
  loading: boolean;
  scanMode: boolean;
  scanning: boolean;
  onFileClick: (index: number) => void;
  onFileDoubleClick: (file: FileEntry) => void;
}

const FileList: React.FC<FileListProps> = ({
  files,
  selectedIndex,
  loading,
  scanMode,
  scanning,
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
            <th style={{ width: '80px' }}>{scanMode ? 'Size' : 'Length'}</th>
            <th style={{ width: '70px' }}>{scanMode ? 'Files' : 'Tempo'}</th>
            <th style={{ width: '70px' }}>{scanMode ? '' : 'Tracks'}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file, index) => (
            <FileListItem
              key={file.path}
              file={file}
              selected={index === selectedIndex}
              scanMode={scanMode}
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
