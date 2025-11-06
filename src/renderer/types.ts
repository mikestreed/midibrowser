export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMidi?: boolean;
  isAudio?: boolean;
  size?: number;
  modified?: Date;
  fileCount?: number; // For scan mode: number of MIDI files in folder
}

export interface MidiMetadata {
  duration: number; // in seconds
  trackCount: number;
  tempo?: number; // BPM
}
