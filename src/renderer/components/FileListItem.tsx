import React, { useEffect, useState } from 'react';
import { Midi } from '@tonejs/midi';
import { FileEntry, MidiMetadata } from '../types';

const { ipcRenderer } = window.require('electron');

interface FileListItemProps {
  file: FileEntry;
  selected: boolean;
  scanMode: boolean;
  column?: 'left' | 'right';
  onFileMove?: (sourcePath: string, targetDir: string) => void;
  onClick: () => void;
  onDoubleClick: () => void;
}

const FileListItem: React.FC<FileListItemProps> = ({
  file,
  selected,
  scanMode,
  column,
  onFileMove,
  onClick,
  onDoubleClick
}) => {
  const [metadata, setMetadata] = useState<MidiMetadata | null>(null);
  const [dragOver, setDragOver] = useState<boolean>(false);

  useEffect(() => {
    if (file.isMidi) {
      loadMidiMetadata();
    }
  }, [file]);

  const loadMidiMetadata = async () => {
    try {
      // Skip metadata loading for 0-byte files (Dropbox online-only)
      // They'll load when the user tries to play them
      if (file.size === 0) {
        setMetadata({
          duration: 0,
          trackCount: 0
        });
        return;
      }

      const buffer = await ipcRenderer.invoke('read-file', file.path);
      const midi = new Midi(buffer);

      // Extract tempo from MIDI file
      // Tempo is in BPM (beats per minute)
      let tempo = midi.header.tempos && midi.header.tempos.length > 0
        ? Math.round(midi.header.tempos[0].bpm)
        : undefined;

      setMetadata({
        duration: midi.duration,
        trackCount: midi.tracks.length,
        tempo: tempo
      });
    } catch (error) {
      console.error('Failed to load MIDI metadata:', error);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getIcon = (): string => {
    if (file.isDirectory) return '📁';
    if (file.isMidi) return '🎹';
    if (file.isAudio) return '🎵';
    return '📄';
  };

  const className = `${selected ? 'selected' : ''} ${file.isAudio ? 'audio-file' : ''} ${dragOver ? 'drag-over' : ''}`;

  const handleDragStart = (e: React.DragEvent) => {
    // Enable dragging files out of the app to Finder/desktop
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', file.path);

    // For Electron, set the file path for native drag
    const { ipcRenderer } = window.require('electron');
    ipcRenderer.send('ondragstart', file.path);
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Only folders in the left column can accept drops
    if (file.isDirectory && column === 'left') {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    setDragOver(false);

    // Only handle drops on folders in the left column
    if (!file.isDirectory || column !== 'left') {
      // Let the event bubble up to the document handler for navigation
      return;
    }

    // Check if this is an internal drag (moving files)
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (sourcePath && sourcePath !== file.path && onFileMove) {
      // This is an internal file move, handle it here
      e.preventDefault();
      e.stopPropagation();
      onFileMove(sourcePath, file.path);
      return;
    }

    // If we get here, let the event bubble up
  };

  return (
    <tr
      className={className}
      draggable={!file.isDirectory || scanMode} // Files are draggable, folders only in scan mode
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <td>
        <div className="file-name">
          <span className="file-icon">{getIcon()}</span>
          <span>{file.name}</span>
        </div>
      </td>
      {column === 'left' ? (
        <>
          <td className="file-size">
            {file.size ? formatSize(file.size) : ''}
          </td>
          <td className="file-count">
            {file.fileCount ? file.fileCount : ''}
          </td>
        </>
      ) : (
        <>
          <td className="file-length">
            {metadata && metadata.duration > 0 ? formatDuration(metadata.duration) : (file.size === 0 ? '☁️' : '')}
          </td>
          <td className="tempo">
            {metadata && metadata.tempo ? metadata.tempo : ''}
          </td>
          <td className="track-count">
            {metadata && metadata.trackCount > 0 ? metadata.trackCount : ''}
          </td>
        </>
      )}
    </tr>
  );
};

export default FileListItem;
