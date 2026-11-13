import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, Paperclip, Loader2, Square, Radio, Volume2 } from 'lucide-react';
import { apiFetch } from '@/config/api';
import { speechService } from '@/services/speechService';

interface InputBarProps {
  onSendMessage: (text: string) => void;
  onUploadFile?: (file: File) => void;
  disabled?: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({ onSendMessage, onUploadFile, disabled }) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [audioRms, setAudioRms] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // VAD tracking refs
  const speechDetectedRef = useRef(false);
  const lastSpeechTimestampRef = useRef<number>(0);
  const isLiveModeRef = useRef(false);
  const isAiSpeakingRef = useRef(false);
  const isRecordingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isLiveModeRef.current = isLiveMode;
  }, [isLiveMode]);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && onUploadFile) {
      onUploadFile(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (disabled || !text.trim()) return;
    onSendMessage(text);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Convert Blob to Base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Clean stop of audio context & stream
  const cleanupAudioNodes = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    speechDetectedRef.current = false;
    setIsUserSpeaking(false);
    setAudioRms(0);
  };

  // Stop recording cleanly
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    cleanupAudioNodes();
    setIsRecording(false);
  }, []);

  // Forward ref for startRecording to be called by speech listener
  const startRecordingRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Start Voice Recording with Web Audio API VAD (Voice Activity Detection)
  const startRecording = useCallback(async () => {
    if (isAiSpeakingRef.current) return;
    try {
      cleanupAudioNodes();
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      // Initialize Web Audio API Analyser for real-time VAD
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Select supported audio mimeType
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size > 500) {
          setIsTranscribing(true);
          try {
            const base64Audio = await blobToBase64(audioBlob);
            const res = await apiFetch('/api/v1/voice/dictate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio_base64: base64Audio, clean_with_llm: true })
            }).catch(() => null);

            let resData = null;
            if (res && res.ok) {
              resData = await res.json();
            } else {
              const fallbackRes = await apiFetch('/api/voice/dictate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_base64: base64Audio, clean_with_llm: true })
              });
              if (fallbackRes.ok) resData = await fallbackRes.json();
            }

            const transcribed = (resData?.clean_text || resData?.raw_text || '').trim();
            if (transcribed) {
              // Hands-free auto-send directly to chat!
              onSendMessage(transcribed);
              setText('');
            }
          } catch (err) {
            console.error('Audio transcription error:', err);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);
      speechDetectedRef.current = false;
      lastSpeechTimestampRef.current = 0;

      // VAD Loop: Sample audio RMS energy ~30 times per second
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const SPEECH_RMS_THRESHOLD = 9.0; // Voice energy threshold
      const SILENCE_TIMEOUT_MS = 850;   // 0.85s of silence after speech triggers auto-stop

      const vadLoop = () => {
        if (!analyserRef.current || !isRecordingRef.current) return;

        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length) * 100;
        setAudioRms(rms);

        // Echo protection: If Duckuu starts speaking, do not process user VAD
        if (isAiSpeakingRef.current) {
          animFrameRef.current = requestAnimationFrame(vadLoop);
          return;
        }

        const now = Date.now();
        if (rms > SPEECH_RMS_THRESHOLD) {
          speechDetectedRef.current = true;
          lastSpeechTimestampRef.current = now;
          setIsUserSpeaking(true);
        } else {
          if (speechDetectedRef.current) {
            setIsUserSpeaking(false);
            const silenceElapsed = now - lastSpeechTimestampRef.current;
            if (silenceElapsed > SILENCE_TIMEOUT_MS) {
              // Pause detected after speech! Auto-stop and dispatch!
              speechDetectedRef.current = false;
              stopRecording();
              return;
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(vadLoop);
      };

      animFrameRef.current = requestAnimationFrame(vadLoop);

      timerIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied or error:', err);
      setIsRecording(false);
      setIsLiveMode(false);
      alert('Microphone access was denied or not detected. Please ensure microphone permissions are granted.');
    }
  }, [onSendMessage, stopRecording]);

  startRecordingRef.current = startRecording;

  // Listen to Duckuu TTS speech events for Hands-Free Live Voice Loop
  useEffect(() => {
    const unsubStart = speechService.subscribeSpeechStart(() => {
      setIsAiSpeaking(true);
      // Mute/stop mic while Duckuu is speaking to prevent acoustic feedback loop
      if (isRecordingRef.current) {
        stopRecording();
      }
    });

    const unsubEnd = speechService.subscribeSpeechEnd(() => {
      setIsAiSpeaking(false);
      // If Live Voice Mode is active, automatically resume listening for user's next turn!
      if (isLiveModeRef.current) {
        window.setTimeout(() => {
          if (isLiveModeRef.current && !isAiSpeakingRef.current && !isRecordingRef.current) {
            startRecordingRef.current?.();
          }
        }, 350); // slight pause after AI finishes speaking
      }
    });

    return () => {
      unsubStart();
      unsubEnd();
      cleanupAudioNodes();
    };
  }, [stopRecording]);

  // In-app Push-to-Talk via 'Shift + Q' inside Dashboard
  useEffect(() => {
    let shiftQPressedTime = 0;
    let isPushToTalk = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isQ = e.key === 'Q' || e.key === 'q' || e.code === 'KeyQ';
      if (isQ && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        isPushToTalk = true;
        shiftQPressedTime = Date.now();
        if (!isRecordingRef.current) {
          startRecording();
        } else {
          stopRecording();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const isQ = e.key === 'Q' || e.key === 'q' || e.code === 'KeyQ';
      if (isQ || e.key === 'Shift') {
        if (isPushToTalk) {
          const duration = Date.now() - shiftQPressedTime;
          // Hold for push-to-talk (>250ms) -> stop recording on release
          if (duration > 250 && isRecordingRef.current) {
            stopRecording();
          }
          isPushToTalk = false;
        }
      }
    };

    const handleBlur = () => {
      isPushToTalk = false;
      if (isRecordingRef.current) {
        stopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [startRecording, stopRecording]);

  // Toggle Standard Recording (with auto-send VAD)
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Toggle Live Voice Continuous Loop Mode
  const toggleLiveMode = () => {
    const nextMode = !isLiveMode;
    setIsLiveMode(nextMode);
    if (nextMode) {
      speechService.stop();
      startRecording();
    } else {
      stopRecording();
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const chips = [
    { label: 'Inspect screen', text: 'Analyze screen and describe what is visible' },
    { label: 'Focus 25m', text: 'Start focus session for 25 minutes' },
    { label: 'Clean downloads', text: 'Clean up downloads' },
    { label: 'Open VS Code', text: 'Open VS Code and open folder F:\\DUCKUU' },
    { label: 'System status', text: 'Give me a complete status report of Duckuu backend' }
  ];

  return (
    <div className="p-3.5 border-t border-white/10 bg-black/20 backdrop-blur-xl space-y-2.5 bg-gradient-to-t from-black/25 to-transparent">
      {/* Quick Action Chips & Live Voice Mode Button */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 text-[11px] font-mono-telemetry">
        {/* Continuous Hands-Free Live Voice Loop Toggle */}
        <button
          onClick={toggleLiveMode}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full font-bold transition-all spring-pill border shadow-sm ${
            isLiveMode
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-500/20'
              : 'bg-black/30 backdrop-blur-xl hover:bg-emerald-500/10 text-neutral-300 hover:text-emerald-300 border-white/10 hover:border-emerald-500/30'
          }`}
          title="Toggle Gemini Live / Wispr hands-free conversational loop (auto-listens after Duckuu speaks)"
        >
          <Radio className={`w-3.5 h-3.5 ${isLiveMode ? 'text-emerald-400 animate-pulse' : 'text-neutral-400'}`} />
          <span>{isLiveMode ? 'LIVE VOICE: ACTIVE' : 'Live Voice Loop'}</span>
          {isLiveMode && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block ml-0.5" />
          )}
        </button>

        {chips.map((c, i) => (
          <button
            key={i}
            onClick={() => onSendMessage(c.text)}
            className="shrink-0 px-3 py-1 rounded-full bg-black/30 backdrop-blur-xl hover:bg-amber-500/15 border border-white/10 hover:border-amber-400/40 text-neutral-300 hover:text-amber-200 transition-all spring-pill"
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Floating Translucent Pill Input with Glowing Focus Ring */}
      <div
        className={`relative flex items-end gap-2 rounded-full bg-black/20 backdrop-blur-2xl border border-white/10 focus-within:border-yellow-400/50 focus-within:ring-2 focus-within:ring-yellow-400/50 hover:border-white/20 p-2 px-3.5 transition-all duration-300 shadow-2xl bg-gradient-to-br from-white/5 to-transparent ${
          isRecording
            ? 'border-rose-500/80 ring-2 ring-rose-500/25 bg-rose-950/15'
            : isLiveMode
            ? 'border-emerald-500/70 ring-2 ring-emerald-500/20'
            : ''
        }`}
      >
        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".pdf,.txt,.md,.json,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-neutral-400 hover:text-amber-400 hover:bg-white/5 rounded-xl transition-colors spring-pill"
          title="Attach PDF or file"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Textarea or Live Audio Visualizer */}
        <div className="flex-1 relative flex items-center">
          {isRecording ? (
            <div className="flex-1 flex items-center justify-between py-1 px-1.5 text-xs font-mono-telemetry">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                <span className="text-neutral-200 font-semibold">
                  {isUserSpeaking ? 'Speaking...' : 'Listening (auto-sends on pause)...'}
                </span>
                <span className="text-neutral-400 text-[10px]">({formatTimer(recordingSeconds)})</span>
              </div>

              {/* Dynamic Soundwave / RMS Energy Meter */}
              <div className="flex items-center gap-1 h-4 pr-1">
                {[0.4, 0.8, 1.2, 0.6, 1.0].map((multiplier, idx) => {
                  const barHeight = Math.min(Math.max((audioRms * multiplier) / 3, 3), 16);
                  return (
                    <div
                      key={idx}
                      style={{ height: `${barHeight}px` }}
                      className={`w-1 rounded-full transition-all duration-75 ${
                        isUserSpeaking ? 'bg-amber-400' : 'bg-rose-500/60'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          ) : isAiSpeaking ? (
            <div className="flex-1 flex items-center gap-2 py-1 px-1.5 text-xs text-amber-300 font-mono-telemetry animate-pulse">
              <Volume2 className="w-4 h-4 text-amber-400" />
              <span>Duckuu is speaking...</span>
              <button
                type="button"
                onClick={() => speechService.stop()}
                className="ml-auto text-[10px] text-neutral-400 hover:text-rose-400 underline font-normal"
              >
                Interrupt
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isTranscribing
                  ? 'Transcribing and cleaning speech...'
                  : isLiveMode
                  ? '⚡ Live Voice active — speak anytime or type...'
                  : 'Consult Duckuu, or press Enter...'
              }
              className="w-full bg-transparent border-0 resize-none text-xs text-neutral-100 placeholder-neutral-500 py-1.5 px-1 focus:outline-none max-h-32 leading-relaxed font-body-sm"
            />
          )}
        </div>

        {/* Voice Dictation toggle with VAD */}
        <button
          type="button"
          onClick={toggleRecording}
          disabled={isTranscribing}
          className={`p-2 rounded-full transition-all spring-pill flex items-center gap-1.5 ${
            isRecording
              ? 'bg-rose-500 text-white shadow-md font-mono text-[10px]'
              : isTranscribing
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
              : 'text-neutral-400 hover:text-amber-400 hover:bg-white/10'
          }`}
          title={isRecording ? 'Click to stop early' : 'Dictate (auto-stops on silence)'}
        >
          {isTranscribing ? (
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
          ) : isRecording ? (
            <>
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </>
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        {/* Send button with spring physics */}
        <button
          type="button"
          disabled={disabled || (!text.trim() && !isRecording)}
          onClick={() => {
            if (isRecording) {
              stopRecording();
            } else {
              handleSubmit();
            }
          }}
          className="p-2 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-35 disabled:hover:from-amber-400 text-obsidian font-bold transition-all shadow-md active:scale-95 spring-pill shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
