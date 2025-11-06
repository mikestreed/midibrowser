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
  const instrumentsRef = useRef<any[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const midiDataRef = useRef<Midi | null>(null);
  const scheduledNotesRef = useRef<any[]>([]);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const shouldAutoPlayRef = useRef<boolean>(true);
  const startOffsetRef = useRef<number>(0);

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

    // Close and reset audio context and instruments for fresh start
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // Ignore
      }
      audioContextRef.current = null;
    }
    instrumentsRef.current = [];
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

  // Map GM program numbers to soundfont instrument names
  const getInstrumentName = (program: number): string => {
    const gmInstruments = [
      'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
      'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
      'celesta', 'glockenspiel', 'music_box', 'vibraphone',
      'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
      'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
      'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
      'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
      'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
      'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
      'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
      'violin', 'viola', 'cello', 'contrabass',
      'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
      'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
      'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
      'trumpet', 'trombone', 'tuba', 'muted_trumpet',
      'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
      'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
      'oboe', 'english_horn', 'bassoon', 'clarinet',
      'piccolo', 'flute', 'recorder', 'pan_flute',
      'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
      'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
      'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass__lead',
      'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
      'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
      'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
      'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
      'sitar', 'banjo', 'shamisen', 'koto',
      'kalimba', 'bagpipe', 'fiddle', 'shanai',
      'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
      'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
      'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
      'telephone_ring', 'helicopter', 'applause', 'gunshot'
    ];

    return gmInstruments[program] || 'acoustic_grand_piano';
  };

  const playMidi = useCallback(() => {
    if (instrumentsRef.current.length === 0 || !midiDataRef.current || !audioContextRef.current) {
      console.log('Cannot play MIDI - missing resources');
      return;
    }

    const midi = midiDataRef.current;
    const audioContext = audioContextRef.current;

    // Collect all notes from all tracks with their instrument assignments
    const notes: any[] = [];
    midi.tracks.forEach((track, trackIndex) => {
      const instrument = instrumentsRef.current[trackIndex];
      track.notes.forEach((note) => {
        notes.push({
          time: note.time,
          duration: note.duration,
          midi: note.midi,
          velocity: note.velocity,
          instrument: instrument
        });
      });
    });

    // Sort by time
    notes.sort((a, b) => a.time - b.time);

    if (notes.length === 0) {
      console.log('No notes to play');
      return;
    }

    // Find the start offset (skip silence at beginning)
    const firstNoteTime = notes[0].time;
    const startOffset = firstNoteTime;
    startOffsetRef.current = startOffset;

    console.log('Playing MIDI with', notes.length, 'notes, skipping', startOffset.toFixed(2), 'seconds of silence');

    // Schedule all notes with offset
    const contextStartTime = audioContext.currentTime;
    startTimeRef.current = Date.now();

    scheduledNotesRef.current = notes.map((note) => {
      const adjustedTime = note.time - startOffset;
      return note.instrument.play(
        note.midi,
        contextStartTime + adjustedTime,
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
      setCurrentTime(elapsed + startOffset);

      if (elapsed >= (duration - startOffset)) {
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

    // Always create fresh audio context
    audioContextRef.current = new AudioContext();

    // Analyze the MIDI file to determine instruments
    const allNotes: number[] = [];
    midi.tracks.forEach(track => {
      track.notes.forEach(note => {
        allNotes.push(note.midi);
      });
    });

    // Check if this is a single-note file (metronome/click track)
    const uniqueNotes = [...new Set(allNotes)];
    const isSingleNote = uniqueNotes.length === 1;

    console.log('MIDI analysis:', {
      totalNotes: allNotes.length,
      uniqueNotes: uniqueNotes.length,
      isSingleNote,
      pitch: isSingleNote ? uniqueNotes[0] : null
    });

    // Load instruments for each track
    const instruments: any[] = [];

    for (let i = 0; i < midi.tracks.length; i++) {
      const track = midi.tracks[i];
      let instrumentName = 'acoustic_grand_piano';

      // Special handling for single-note files
      if (isSingleNote && allNotes.length > 0) {
        const pitch = uniqueNotes[0];
        if (pitch < 24) { // Below C1
          instrumentName = 'synth_drum'; // Kick drum
          console.log('Using kick drum for low single note');
        } else {
          instrumentName = 'synth_drum'; // Hi-hat/percussion
          console.log('Using hi-hat for single note');
        }
      } else if (track.instrument) {
        // Use the instrument assigned in the MIDI file
        const program = track.instrument.number;
        instrumentName = getInstrumentName(program);
        console.log(`Track ${i}: Using GM instrument #${program} (${instrumentName})`);
      } else if (track.channel === 9) {
        // Channel 10 (9 in 0-indexed) is drums
        instrumentName = 'synth_drum';
        console.log(`Track ${i}: Drum track detected`);
      }

      const instrument = await Soundfont.instrument(
        audioContextRef.current!,
        instrumentName as any
      );
      instruments.push(instrument);
    }

    instrumentsRef.current = instruments;
    console.log('Loaded', instruments.length, 'instruments for', midi.tracks.length, 'tracks');
  }, [file.path]);

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

    // Detect silence at start using Web Audio API
    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await buffer.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const channelData = audioBuffer.getChannelData(0);
      const threshold = 0.01; // Very low threshold above background noise
      let silenceEnd = 0;

      // Find first sample above threshold
      for (let i = 0; i < channelData.length; i++) {
        if (Math.abs(channelData[i]) > threshold) {
          silenceEnd = i / audioBuffer.sampleRate;
          break;
        }
      }

      startOffsetRef.current = silenceEnd;
      console.log('Audio file: skipping', silenceEnd.toFixed(2), 'seconds of silence');

      audioContext.close();
    } catch (err) {
      console.error('Error analyzing audio:', err);
      startOffsetRef.current = 0;
    }

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

      console.log('Auto-play triggered for:', file.name);

      // Start playback
      setTimeout(() => {
        if (file.isMidi) {
          playMidi();
        } else if (file.isAudio && audioRef.current) {
          // Skip silence at the start of audio files
          if (startOffsetRef.current > 0) {
            audioRef.current.currentTime = startOffsetRef.current;
          }
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
