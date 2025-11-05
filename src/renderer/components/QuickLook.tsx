import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Midi } from '@tonejs/midi';
import * as Soundfont from 'soundfont-player';
import { FileEntry } from '../types';

const { ipcRenderer } = window.require('electron');

interface QuickLookProps {
  file: FileEntry;
  files: FileEntry[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const QuickLook: React.FC<QuickLookProps> = ({ file, files, currentIndex, onClose, onNavigate }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackCount, setTrackCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const instrumentRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const midiDataRef = useRef<Midi | null>(null);
  const scheduledNotesRef = useRef<any[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    loadFile();

    return () => {
      cleanup();
    };
  }, [file]);

  // Auto-play when file is loaded
  useEffect(() => {
    if (!loading && !isPlaying) {
      // Small delay to ensure everything is ready
      const timer = setTimeout(() => {
        togglePlayPause();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Stop all scheduled notes
    scheduledNotesRef.current.forEach(note => {
      if (note && note.stop) {
        try {
          note.stop();
        } catch (e) {
          // Ignore
        }
      }
    });
    scheduledNotesRef.current = [];

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const loadFile = async () => {
    setLoading(true);
    setCurrentTime(0);
    setIsPlaying(false);

    try {
      if (file.isMidi) {
        await loadMidiFile();
      } else if (file.isAudio) {
        await loadAudioFile();
      }
    } catch (error) {
      console.error('Failed to load file:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMidiFile = async () => {
    const buffer = await ipcRenderer.invoke('read-file', file.path);
    const midi = new Midi(buffer);

    midiDataRef.current = midi;
    setDuration(midi.duration);
    setTrackCount(midi.tracks.length);

    // Initialize audio context and load instrument
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (!instrumentRef.current) {
      instrumentRef.current = await Soundfont.instrument(
        audioContextRef.current,
        'acoustic_grand_piano'
      );
    }
  };

  const loadAudioFile = async () => {
    const buffer = await ipcRenderer.invoke('read-file', file.path);
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
    });

    await audio.load();
  };

  const playMidi = useCallback(() => {
    if (!instrumentRef.current || !midiDataRef.current || !audioContextRef.current) return;

    const instrument = instrumentRef.current;
    const midi = midiDataRef.current;
    const audioContext = audioContextRef.current;

    // Collect all notes from all tracks
    const notes: any[] = [];
    midi.tracks.forEach((track) => {
      track.notes.forEach((note) => {
        notes.push({
          time: note.time,
          duration: note.duration,
          midi: note.midi,
          velocity: note.velocity
        });
      });
    });

    // Sort by time
    notes.sort((a, b) => a.time - b.time);

    // Schedule all notes
    const contextStartTime = audioContext.currentTime;
    startTimeRef.current = Date.now();

    scheduledNotesRef.current = notes.map((note) => {
      return instrument.play(
        note.midi,
        contextStartTime + note.time,
        {
          duration: note.duration,
          gain: note.velocity
        }
      );
    });

    setIsPlaying(true);

    // Update progress
    const updateProgress = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setCurrentTime(elapsed);

      if (elapsed >= duration) {
        setIsPlaying(false);
        setCurrentTime(0);
        scheduledNotesRef.current = [];
      } else {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    updateProgress();
  }, [duration]);

  const stopMidi = () => {
    scheduledNotesRef.current.forEach(note => {
      if (note && note.stop) {
        try {
          note.stop();
        } catch (e) {
          // Ignore
        }
      }
    });
    scheduledNotesRef.current = [];

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (file.isMidi) {
      if (isPlaying) {
        stopMidi();
      } else {
        playMidi();
      }
    } else if (file.isAudio && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    setCurrentTime(newTime);

    if (file.isAudio && audioRef.current) {
      audioRef.current.currentTime = newTime;
    } else if (file.isMidi) {
      // For MIDI, restart playback from beginning
      // Full seek support would require more complex implementation
      if (isPlaying) {
        stopMidi();
      }
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Navigate to next/previous file
  const navigateToFile = useCallback((direction: 'next' | 'prev') => {
    let newIndex = currentIndex;

    if (direction === 'next') {
      // Find next non-directory file
      for (let i = currentIndex + 1; i < files.length; i++) {
        if (!files[i].isDirectory) {
          newIndex = i;
          break;
        }
      }
    } else {
      // Find previous non-directory file
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (!files[i].isDirectory) {
          newIndex = i;
          break;
        }
      }
    }

    if (newIndex !== currentIndex) {
      // Stop current playback before navigating
      if (isPlaying) {
        if (file.isMidi) {
          stopMidi();
        } else if (audioRef.current) {
          audioRef.current.pause();
        }
      }
      onNavigate(newIndex);
    }
  }, [currentIndex, files, isPlaying, file.isMidi, onNavigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateToFile('next');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateToFile('prev');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, navigateToFile]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="quicklook-overlay" onClick={onClose}>
      <div className="quicklook-panel" onClick={(e) => e.stopPropagation()}>
        <div className="quicklook-header">
          <h2 className="quicklook-title">{file.name}</h2>
          <p className="quicklook-subtitle">
            {file.isMidi && `MIDI File • ${trackCount} tracks`}
            {file.isAudio && 'Audio File'}
          </p>
        </div>

        <div className="quicklook-body">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : (
            <div className="playback-controls">
              <button
                className="play-pause-button"
                onClick={togglePlayPause}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              <div className="seek-bar-container">
                <div className="time-display">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="seek-bar" onClick={handleSeek}>
                  <div
                    className="seek-bar-progress"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="seek-bar-thumb"
                    style={{ left: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="quicklook-footer">
          Press Space or Esc to close • Use ↑/↓ arrows to navigate files
        </div>
      </div>
    </div>
  );
};

export default QuickLook;
