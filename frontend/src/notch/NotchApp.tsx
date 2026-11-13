import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Volume2, Sparkles, LayoutDashboard } from 'lucide-react';
import { apiFetch, getWsUrl, detectApiPort } from '@/config/api';
import { speechService } from '@/services/speechService';

type NotchState = 'idle' | 'listening' | 'thinking' | 'speaking';

export const NotchApp: React.FC = () => {
  const [notchState, setNotchState] = useState<NotchState>('idle');
  const [displayText, setDisplayText] = useState<string>('DUCKUU // STEALTH');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const shrinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Set mouse ignore on transparent background
  const handleMouseEnter = () => {
    setIsHovered(true);
    window.duckuuApi?.setNotchIgnoreMouseEvents(false);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    window.duckuuApi?.setNotchIgnoreMouseEvents(true);
  };

  const scheduleShrink = useCallback((delayMs = 2800) => {
    if (shrinkTimeoutRef.current) {
      clearTimeout(shrinkTimeoutRef.current);
    }
    shrinkTimeoutRef.current = setTimeout(() => {
      setNotchState('idle');
      setDisplayText('DUCKUU // STEALTH');
    }, delayMs);
  }, []);

  // Cleanup Web Audio
  const cleanupAudio = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  // Stop Recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    cleanupAudio();
  }, [cleanupAudio]);

  // Start Mic Recording with real-time VAD
  const startRecording = useCallback(async () => {
    try {
      cleanupAudio();
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

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size > 500) {
          setNotchState('thinking');
          setDisplayText('Processing voice...');
          try {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
              const base64Audio = (reader.result as string).split(',')[1];
              const res = await apiFetch('/api/v1/voice/dictate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_base64: base64Audio, clean_with_llm: true })
              }).catch(() => null);

              let resData = null;
              if (res && res.ok) resData = await res.json();
              const text = (resData?.clean_text || resData?.raw_text || '').trim();

              if (text) {
                setDisplayText(`"${text}"`);
                // Send to chat backend
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      type: 'CHAT_MESSAGE',
                      conversation_id: 'stealth-voice-session',
                      message: text,
                      mode: 'general'
                    })
                  );
                }
              } else {
                setDisplayText('No voice detected');
                scheduleShrink(2000);
              }
            };
          } catch {
            setDisplayText('Voice error');
            scheduleShrink(2000);
          }
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setNotchState('listening');
      setDisplayText('Listening...');

      // VAD Loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let speechStarted = false;
      let lastSpeechTime = Date.now();

      const vadLoop = () => {
        if (!analyserRef.current || !streamRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / dataArray.length) * 100;

        const now = Date.now();
        if (rms > 8.5) {
          speechStarted = true;
          lastSpeechTime = now;
        } else if (speechStarted && now - lastSpeechTime > 850) {
          stopRecording();
          return;
        }

        animFrameRef.current = requestAnimationFrame(vadLoop);
      };

      animFrameRef.current = requestAnimationFrame(vadLoop);
    } catch (err) {
      console.error('Failed to start notch mic:', err);
      setIsRecording(false);
      setNotchState('idle');
    }
  }, [cleanupAudio, scheduleShrink, stopRecording]);

  // Connect to WebSocket server for telemetry
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectWs = async () => {
      try {
        await detectApiPort();
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {};

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'PET_STATE_CHANGE') {
              if (data.emotion === 'listening') {
                setNotchState('listening');
                setDisplayText('Listening...');
              } else if (data.emotion === 'working' || data.emotion === 'thinking') {
                setNotchState('thinking');
                setDisplayText('Duckuu is thinking...');
              } else if (data.emotion === 'happy') {
                setDisplayText('Quack! Done.');
                scheduleShrink(2000);
              }
            } else if (data.type === 'SPEECH_PILL') {
              setDisplayText(data.text || 'Notification');
              setNotchState('speaking');
              scheduleShrink(data.duration_ms || 2500);
            } else if (data.type === 'CHAT_CHUNK') {
              setNotchState('speaking');
              if (data.delta) {
                setDisplayText((prev) => (prev.length > 35 ? data.delta : `${prev} ${data.delta}`).trim());
              }
            } else if (data.type === 'CHAT_COMPLETE') {
              setNotchState('speaking');
              if (data.full_content) {
                const preview = data.full_content.slice(0, 48) + (data.full_content.length > 48 ? '...' : '');
                setDisplayText(preview);
              }
              scheduleShrink(3500);
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connectWs, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    // Listen to Speech Start / End events
    const unsubSpeechStart = speechService.subscribeSpeechStart(() => {
      setNotchState('speaking');
    });

    const unsubSpeechEnd = speechService.subscribeSpeechEnd(() => {
      scheduleShrink(2000);
    });

    // IPC: Activate voice via Alt+Space or pet click in stealth mode
    const unsubNotchVoice = window.duckuuApi?.onNotchActivateVoice?.(() => {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });

    // IPC: Focus Notch input via Alt+Shift+Q
    const unsubFocusInput = window.duckuuApi?.onNotchFocusInput?.(() => {
      setNotchState('idle');
      window.duckuuApi?.setNotchIgnoreMouseEvents(false);
      setTimeout(() => {
        const el = document.getElementById('notch-input') as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      }, 50);
    });

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      unsubSpeechStart();
      unsubSpeechEnd();
      unsubNotchVoice?.();
      unsubFocusInput?.();
      cleanupAudio();
    };
  }, [cleanupAudio, isRecording, scheduleShrink, startRecording, stopRecording]);

  // In-app Push-to-Talk via 'Shift + Q' inside Notch
  useEffect(() => {
    let shiftQPressedTime = 0;
    let isPushToTalk = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isQ = e.key === 'Q' || e.key === 'q' || e.code === 'KeyQ';
      if (isQ && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        isPushToTalk = true;
        shiftQPressedTime = Date.now();
        if (!isRecording) {
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
          // Hold for push-to-talk (>250ms) -> stop on release
          if (duration > 250 && isRecording) {
            stopRecording();
          }
          isPushToTalk = false;
        }
      }
    };

    const handleBlur = () => {
      isPushToTalk = false;
      if (isRecording) {
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
  }, [isRecording, startRecording, stopRecording]);

  // Switch back to Dashboard Mode
  const handleOpenDashboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.duckuuApi?.setInteractionMode('dashboard');
  };

  const handleToggleMic = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputText.trim()) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'CHAT_MESSAGE',
          conversation_id: 'stealth-voice-session',
          message: inputText.trim(),
          mode: 'general'
        }));
      }
      setNotchState('thinking');
      setDisplayText(`"${inputText.trim()}"`);
      setInputText('');
    }
  };

  // Dynamic width classes based on state
  const getPillWidthClass = () => {
    switch (notchState) {
      case 'listening':
        return 'w-[280px] border-amber-500/50 shadow-amber-500/20';
      case 'thinking':
        return 'w-[260px] border-purple-500/50 shadow-purple-500/20 animate-pulse';
      case 'speaking':
        return 'w-[390px] border-emerald-500/50 shadow-emerald-500/20';
      case 'idle':
      default:
        return isHovered ? 'w-[320px] border-amber-500/40' : 'w-[260px] border-white/10';
    }
  };

  return (
    <div className="stealth-notch-container p-2 select-none">
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`stealth-notch-pill h-11 px-3.5 flex items-center justify-between rounded-full cursor-default ${getPillWidthClass()} spring-pill shadow-xl`}
      >
        {/* Left Indicator & State Icon */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {notchState === 'listening' ? (
            <div className="w-6 h-6 rounded-full bg-amber-500/25 border border-amber-400 flex items-center justify-center text-amber-300 animate-pulse shrink-0">
              <Mic className="w-3.5 h-3.5 text-amber-400" />
            </div>
          ) : notchState === 'thinking' ? (
            <div className="w-6 h-6 rounded-full bg-purple-500/25 border border-purple-400 flex items-center justify-center text-purple-300 shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-spin" />
            </div>
          ) : notchState === 'speaking' ? (
            <div className="w-6 h-6 rounded-full bg-emerald-500/25 border border-emerald-400 flex items-center justify-center text-emerald-300 shrink-0">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center p-0.5 shrink-0">
              <img src="/assets/duck-avatar.svg" alt="Duckuu" className="w-4 h-4 object-contain" />
            </div>
          )}

          {/* Soundwave animation when listening or speaking */}
          {(notchState === 'listening' || notchState === 'speaking') && (
            <div className="flex items-center gap-0.5 h-4 shrink-0 px-1">
              <span className={`w-0.5 rounded-full ${notchState === 'listening' ? 'bg-amber-400 wave-bar-1' : 'bg-emerald-400 wave-bar-1'}`} />
              <span className={`w-0.5 rounded-full ${notchState === 'listening' ? 'bg-amber-400 wave-bar-2' : 'bg-emerald-400 wave-bar-2'}`} />
              <span className={`w-0.5 rounded-full ${notchState === 'listening' ? 'bg-amber-400 wave-bar-3' : 'bg-emerald-400 wave-bar-3'}`} />
              <span className={`w-0.5 rounded-full ${notchState === 'listening' ? 'bg-amber-400 wave-bar-4' : 'bg-emerald-400 wave-bar-4'}`} />
              <span className={`w-0.5 rounded-full ${notchState === 'listening' ? 'bg-amber-400 wave-bar-5' : 'bg-emerald-400 wave-bar-5'}`} />
            </div>
          )}

          {/* Dynamic Label or Sleek Input */}
          {notchState === 'idle' ? (
            <input
              type="text"
              id="notch-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => window.duckuuApi?.setNotchIgnoreMouseEvents(false)}
              placeholder="Type a command..."
              className="w-full bg-transparent border-none text-[11px] font-mono-telemetry text-neutral-200 placeholder-neutral-500 focus:outline-none px-1"
            />
          ) : (
            <span className="text-[11px] font-mono-telemetry font-bold text-neutral-200 truncate pr-1">
              {displayText}
            </span>
          )}
        </div>

        {/* Quick Action Controls (Mic & Open Dashboard) */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {/* Quick Mic Button */}
          <button
            onClick={handleToggleMic}
            className={`p-1.5 rounded-full transition-all spring-pill cursor-pointer ${
              isRecording
                ? 'bg-rose-500/30 text-rose-300 border border-rose-500/60 animate-pulse'
                : 'bg-white/5 hover:bg-amber-500/20 text-neutral-400 hover:text-amber-300 border border-white/10'
            }`}
            title={isRecording ? 'Stop voice recording' : 'Talk to Duckuu'}
          >
            <Mic className="w-3 h-3" />
          </button>

          {/* Quick Dashboard Expand Button */}
          <button
            onClick={handleOpenDashboard}
            className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-neutral-400 hover:text-white border border-white/10 transition-all spring-pill cursor-pointer"
            title="Open Full Dashboard Mode"
          >
            <LayoutDashboard className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
