export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMidi?: boolean;
  isAudio?: boolean;
  size?: number;
  modified?: Date;
}

export interface MidiMetadata {
  duration: number; // in seconds
  trackCount: number;
}
