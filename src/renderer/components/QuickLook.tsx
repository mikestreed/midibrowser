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
  const shouldAutoPlayRef = useRef<boolean>(true);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
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

    // Close and reset audio context and instrument for fresh start
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // Ignore
      }
      audioContextRef.current = null;
    }
    instrumentRef.current = null;
    midiDataRef.current = null;
  }, []);

  const stopMidi = useCallback(() => {
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
  }, []);

  const playMidi = useCallback(() => {
    if (!instrumentRef.current || !midiDataRef.current || !audioContextRef.current) {
      console.log('Cannot play MIDI - missing resources', {
        instrument: !!instrumentRef.current,
        midi: !!midiDataRef.current,
        audioContext: !!audioContextRef.current
      });
      return;
    }

    const instrument = instrumentRef.current;
    const midi = midiDataRef.current;
    const audioContext = audioContextRef.current;

    console.log('Playing MIDI:', midi.name, 'Notes:', midi.tracks.reduce((sum, t) => sum + t.notes.length, 0), 'Duration:', duration);

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

  const loadMidiFile = useCallback(async () => {
    const buffer = await ipcRenderer.invoke('read-file', file.path);
    const midi = new Midi(buffer);

    midiDataRef.current = midi;
    setDuration(midi.duration);
    setTrackCount(midi.tracks.length);

    // Always create fresh audio context and instrument for each file
    audioContextRef.current = new AudioContext();
    instrumentRef.current = await Soundfont.instrument(
      audioContextRef.current,
      'acoustic_grand_piano'
    );

    console.log('Loaded MIDI file:', file.name, 'Duration:', midi.duration);
  }, [file.path, file.name]);

  const loadAudioFile = useCallback(async () => {
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
  }, [file.path]);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setCurrentTime(0);
    cleanup();

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
  }, [file, loadMidiFile, loadAudioFile, cleanup]);

  // Load file when component mounts or file changes
  useEffect(() => {
    shouldAutoPlayRef.current = true;
    loadFile();

    return () => {
      cleanup();
    };
  }, [file.path, loadFile, cleanup]);

  // Auto-play after loading completes
  useEffect(() => {
    if (!loading && shouldAutoPlayRef.current) {
      shouldAutoPlayRef.current = false;

      console.log('Auto-play triggered for:', file.name, 'isMidi:', file.isMidi);

      // Start playback
      setTimeout(() => {
        if (file.isMidi) {
          console.log('Calling playMidi()');
          playMidi();
        } else if (file.isAudio && audioRef.current) {
          console.log('Playing audio file');
          audioRef.current.play().catch(err => {
            console.error('Audio play error:', err);
          });
          setIsPlaying(true);
        }
      }, 150);
    }
  }, [loading, file.isMidi, file.isAudio, file.name, playMidi]);

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
      onNavigate(newIndex);
    }
  }, [currentIndex, files, onNavigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        navigateToFile('next');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        navigateToFile('prev');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, navigateToFile]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    setCurrentTime(newTime);

    if (file.isAudio && audioRef.current) {
      audioRef.current.currentTime = newTime;
    } else if (file.isMidi) {
      // For MIDI, would need to restart from new position
      // This is a simplified implementation
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
              <div className="play-indicator">
                {isPlaying ? '⏵ Playing' : '⏸ Paused'}
              </div>

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
