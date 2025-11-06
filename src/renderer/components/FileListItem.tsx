import React, { useEffect, useState } from 'react';
import { Midi } from '@tonejs/midi';
import { FileEntry, MidiMetadata } from '../types';

const { ipcRenderer } = window.require('electron');

interface FileListItemProps {
  file: FileEntry;
  selected: boolean;
  scanMode: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

const FileListItem: React.FC<FileListItemProps> = ({
  file,
  selected,
  scanMode,
  onClick,
  onDoubleClick
}) => {
  const [metadata, setMetadata] = useState<MidiMetadata | null>(null);

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

  const className = `${selected ? 'selected' : ''} ${file.isAudio ? 'audio-file' : ''}`;

  return (
    <tr
      className={className}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <td>
        <div className="file-name">
          <span className="file-icon">{getIcon()}</span>
          <span>{file.name}</span>
        </div>
      </td>
      <td className="file-length">
        {scanMode
          ? (file.size ? formatSize(file.size) : '')
          : (metadata && metadata.duration > 0 ? formatDuration(metadata.duration) : (file.size === 0 ? '☁️' : ''))
        }
      </td>
      <td className="tempo">
        {scanMode
          ? (file.fileCount ? file.fileCount : '')
          : (metadata && metadata.tempo ? metadata.tempo : '')
        }
      </td>
      <td className="track-count">
        {scanMode
          ? ''
          : (metadata && metadata.trackCount > 0 ? metadata.trackCount : '')
        }
      </td>
    </tr>
  );
};

export default FileListItem;
