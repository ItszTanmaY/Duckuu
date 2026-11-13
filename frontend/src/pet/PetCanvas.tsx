import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PetStateMachine } from './engine/petStateMachine';
import { SpriteEngine } from './engine/spriteEngine';
import { PetEmotion, WebSocketServerEvent } from '@/types/api';
import { getWsUrl, detectApiPort } from '@/config/api';

export const PetCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateMachineRef = useRef<PetStateMachine | null>(null);
  const spriteEngineRef = useRef<SpriteEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [currentEmotion, setCurrentEmotion] = useState<PetEmotion>('idle');
  const [speechPill, setSpeechPill] = useState<string | null>(null);
  const isIgnoringMouseRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number } | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const strokeDistanceRef = useRef<number>(0);

  // Initialize State Machine and Sprite Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const stateMachine = new PetStateMachine();
    stateMachineRef.current = stateMachine;

    const spriteEngine = new SpriteEngine(ctx, canvas.width, canvas.height);
    spriteEngineRef.current = spriteEngine;

    const unsubscribe = stateMachine.subscribe((emotion) => {
      setCurrentEmotion(emotion);
    });

    // Animation Render Loop
    let animationFrameId: number;
    const renderLoop = () => {
      const activeEmotion = stateMachine.getState();
      spriteEngine.update(activeEmotion);
      spriteEngine.render(activeEmotion);
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    animationFrameId = requestAnimationFrame(renderLoop);

    // Global Hotkey IPC Listeners (Phase 2 & 3)
    const unsubDictation = window.duckuuApi?.onToggleDictation?.((data) => {
      if (data.active) {
        stateMachine.setState('listening');
        setSpeechPill('Dictating...');
      } else {
        stateMachine.setState('happy', 2000);
        setSpeechPill('Injected into focused app');
        setTimeout(() => setSpeechPill(null), 2500);
      }
    });

    const unsubWake = window.duckuuApi?.onWakeAndListen?.(() => {
      stateMachine.setState('listening');
      setSpeechPill('Listening...');
      setTimeout(() => setSpeechPill(null), 2000);
    });

    // Audio-Synced Speech State from HTML5 Audio playback in speechService
    const unsubSpeechState = window.duckuuApi?.onPetSpeechState?.((data) => {
      if (data.speaking) {
        stateMachine.setState('speaking');
      } else {
        stateMachine.setState('idle');
      }
    });

    // Electron Roaming Engine State Relay (walking, sitting, idle, sleeping)
    const unsubPetState = window.duckuuApi?.onPetStateChange?.((state) => {
      stateMachine.setState(state as PetEmotion);
    });

    // WebSocket connection to backend
    const connectWs = async () => {
      try {
        await detectApiPort();
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          // Connected to local agent
        };

        ws.onmessage = (event) => {
          try {
            const data: WebSocketServerEvent = jsonTryParse(event.data);
            if (data?.type === 'PET_STATE_CHANGE') {
              stateMachine.setState(data.emotion, data.duration_ms);
              if (data.emotion === 'happy') playSubtleChime('quack');
              else if (data.emotion === 'working') playSubtleChime('alert');
            } else if ((data as any)?.type === 'SPEECH_PILL') {
              setSpeechPill((data as any).text);
              playSubtleChime((data as any).level === 'working' ? 'alert' : 'success');
              setTimeout(() => setSpeechPill(null), (data as any).duration_ms || 2500);
            }
          } catch {
            // Ignore malformed packets
          }
        };

        ws.onclose = () => {
          setTimeout(connectWs, 3000);
        };
      } catch {
        setTimeout(connectWs, 3000);
      }
    };
    connectWs();

    return () => {
      cancelAnimationFrame(animationFrameId);
      unsubscribe();
      unsubDictation?.();
      unsubWake?.();
      unsubSpeechState?.();
      unsubPetState?.();
      stateMachine.destroy();
      wsRef.current?.close();
    };
  }, []);

  const sendWsInteraction = useCallback((interaction: 'click' | 'pet' | 'scold_rapid_clicks') => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'PET_INTERACTION',
        interaction,
        intensity: 1.0
      }));
    }
  }, []);

  // Pixel Alpha Hit-Testing
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const sprite = spriteEngineRef.current;
    if (!canvas || !sprite) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);

    // If currently dragging, update window position via Electron IPC
    if (isDraggingRef.current && dragStartRef.current) {
      const deltaX = e.screenX - dragStartRef.current.mouseX;
      const deltaY = e.screenY - dragStartRef.current.mouseY;
      if (window.duckuuApi) {
        window.duckuuApi.movePetWindow(deltaX, deltaY);
      }
      dragStartRef.current = { mouseX: e.screenX, mouseY: e.screenY };
      return;
    }

    // Inspect pixel alpha
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const alpha = pixel[3];
      const isOverDuck = alpha > 10;

      // Toggle Electron click-through dynamically
      const shouldIgnore = !isOverDuck;
      if (shouldIgnore !== isIgnoringMouseRef.current) {
        isIgnoringMouseRef.current = shouldIgnore;
        if (window.duckuuApi) {
          window.duckuuApi.setIgnoreMouseEvents(shouldIgnore);
        }
      }

      // Track petting gesture (movement while over duck body)
      if (isOverDuck) {
        strokeDistanceRef.current += Math.hypot(e.movementX, e.movementY);
        if (strokeDistanceRef.current > 120) {
          strokeDistanceRef.current = 0;
          stateMachineRef.current?.registerPetting();
          sendWsInteraction('pet');
        }
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Only primary mouse button

    const sprite = spriteEngineRef.current;
    if (!sprite) return;

    isDraggingRef.current = true;
    sprite.isDragging = true;
    dragStartRef.current = { mouseX: e.screenX, mouseY: e.screenY };
    stateMachineRef.current?.registerDragStart();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const sprite = spriteEngineRef.current;
    const sm = stateMachineRef.current;
    if (sprite) {
      sprite.isDragging = false;
    }
    isDraggingRef.current = false;
    dragStartRef.current = null;

    // Check for double click vs single click
    const now = Date.now();
    const timeSinceLast = now - lastClickTimeRef.current;
    lastClickTimeRef.current = now;

    if (timeSinceLast < 320) {
      // Double click toggles chat window!
      if (window.duckuuApi) {
        window.duckuuApi.toggleChat();
      }
    } else {
      // Single click interaction
      if (sm) {
        const { isScolded } = sm.registerClick();
        sendWsInteraction(isScolded ? 'scold_rapid_clicks' : 'click');
      }
    }
  };

  return (
    <div className="relative w-[220px] h-[220px] flex items-center justify-center">
      {speechPill && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (window.duckuuApi) {
              window.duckuuApi.toggleChat();
            }
          }}
          className="absolute -top-1 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#121110]/95 backdrop-blur-xl border border-amber-400/60 text-[10px] font-mono-telemetry text-amber-200 font-bold whitespace-nowrap shadow-2xl z-30 animate-in fade-in zoom-in-95 duration-200 cursor-pointer pointer-events-auto hover:bg-amber-500/20 hover:border-amber-400 transition-all active:scale-95 flex items-center gap-1.5"
          title="Click to view in chat"
        >
          <span>{speechPill}</span>
          <span className="text-[9px] text-amber-400/70 font-normal">↗</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={220}
        height={220}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        className="cursor-pointer"
      />
      <div className="sr-only">Duckuu: {currentEmotion}</div>
    </div>
  );
};

function playSubtleChime(type: 'alert' | 'success' | 'quack' = 'alert') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.035, now);

    if (type === 'alert') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'quack') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Audio context not available or muted
  }
}

function jsonTryParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
