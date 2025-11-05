# MIDI Browser

A desktop application for browsing and playing MIDI files, inspired by macOS Finder's list view and Quick Look feature.

## Features

- **OSX Finder-style Interface**: Clean list view showing file name, duration, and track count
- **Quick Look Playback**: Press spacebar to instantly preview MIDI and audio files
- **MIDI File Support**: Parse and play MIDI files with track information
- **Audio File Support**: Play common audio formats (MP3, WAV, OGG, M4A, FLAC)
- **File System Navigation**: Browse your entire computer for MIDI and audio files
- **Keyboard Shortcuts**:
  - `↑/↓`: Navigate through files
  - `Space`: Quick Look preview (play/pause)
  - `Enter`: Open folder or file
  - `Esc`: Close Quick Look

## Installation

```bash
npm install
```

## Usage

### Development Mode

```bash
npm run dev
```

This will start the application in development mode with hot reloading.

### Production Build

```bash
npm run build
npm start
```

## Technology Stack

- **Electron**: Desktop application framework
- **React**: UI components
- **TypeScript**: Type-safe development
- **@tonejs/midi**: MIDI file parsing
- **midi-sounds-react**: MIDI playback engine
- **Web Audio API**: Audio file playback

## Project Structure

```
midibrowser/
├── src/
│   ├── main/           # Electron main process
│   │   └── main.ts     # Main entry point, IPC handlers
│   └── renderer/       # React application
│       ├── components/ # React components
│       ├── App.tsx     # Main app component
│       ├── types.ts    # TypeScript type definitions
│       └── styles.css  # Application styles
├── dist/               # Compiled output
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## How It Works

1. **File System Access**: Electron's main process provides secure file system access through IPC
2. **MIDI Parsing**: MIDI files are parsed using @tonejs/midi to extract metadata (duration, tracks)
3. **Playback**: MIDI files are played using midi-sounds-react with General MIDI instrument mapping
4. **Audio Files**: Displayed greyed out and played using the Web Audio API

## Future Enhancements

- Playlist creation
- Search/filter functionality
- Multiple file selection
- Metadata editing
- Export capabilities
- Customizable keyboard shortcuts
