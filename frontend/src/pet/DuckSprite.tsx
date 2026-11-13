import React, { useState, useEffect } from 'react';
import './DuckSprite.css';

export type DuckState =
  | 'idle'
  | 'blinking'
  | 'walking'
  | 'sitting'
  | 'listening'
  | 'speaking'
  | 'sleeping';

interface DuckSpriteProps {
  state?: DuckState;
  facingDirection?: 'left' | 'right';
  className?: string;
  onStateChange?: (state: DuckState) => void;
}

export const DuckSprite: React.FC<DuckSpriteProps> = ({
  state: controlledState,
  facingDirection = 'right',
  className = '',
  onStateChange
}) => {
  const [internalState, setInternalState] = useState<DuckState>('idle');
  const [isAudioSpeaking, setIsAudioSpeaking] = useState(false);
  const [isBlinkingInternal, setIsBlinkingInternal] = useState(false);

  const activeState = controlledState || (isAudioSpeaking ? 'speaking' : internalState);

  // Sync with Electron IPC audio playback event from ElevenLabs
  useEffect(() => {
    const unsub = window.duckuuApi?.onPetSpeechState?.((data) => {
      setIsAudioSpeaking(Boolean(data.speaking));
    });
    return () => unsub?.();
  }, []);

  // Listen to remote Electron Roaming Engine state (walking, sitting, etc.)
  useEffect(() => {
    const unsub = window.duckuuApi?.onPetStateChange?.((newState) => {
      setInternalState(newState as DuckState);
      onStateChange?.(newState as DuckState);
    });
    return () => unsub?.();
  }, [onStateChange]);

  // Periodic natural blinking when in idle or sitting
  useEffect(() => {
    if (activeState !== 'idle' && activeState !== 'sitting') return;

    const blinkInterval = setInterval(() => {
      setIsBlinkingInternal(true);
      setTimeout(() => setIsBlinkingInternal(false), 240);
    }, 3600);

    return () => clearInterval(blinkInterval);
  }, [activeState]);

  const isBlinking = activeState === 'blinking' || isBlinkingInternal;
  const isWalking = activeState === 'walking';
  const isSleeping = activeState === 'sleeping';
  const isListening = activeState === 'listening';
  const isSpeaking = activeState === 'speaking' || isAudioSpeaking;
  const isSitting = activeState === 'sitting';

  return (
    <div
      className={`relative inline-block select-none ${className}`}
      style={{
        transform: facingDirection === 'left' ? 'scaleX(-1)' : 'scaleX(1)'
      }}
    >
      {/* Floating Sleeping Zzz Particle */}
      {isSleeping && (
        <div className="absolute -top-3 right-4 font-bold text-sky-300 text-sm pointer-events-none duck-zzz-particle font-mono">
          z
        </div>
      )}

      {/* Floating Listening Music Note */}
      {isListening && (
        <div className="absolute -top-3 right-2 text-pink-400 text-sm font-bold pointer-events-none animate-bounce">
          ♪
        </div>
      )}

      {/* Main Animated Vector Duck Body */}
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        className={`duck-state-${activeState}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Soft Ambient Ground Shadow */}
        <ellipse
          cx="50"
          cy={isSleeping ? "90" : "88"}
          rx={isSleeping ? "34" : "28"}
          ry="6"
          fill="#3C2415"
          fillOpacity="0.18"
        />

        {/* Feet (Hidden when sleeping) */}
        {!isSleeping && (
          <g id="duck-feet">
            {/* Left Foot */}
            <ellipse
              cx="38"
              cy={isSitting ? "86" : "85"}
              rx={isSitting ? "8" : "9"}
              ry={isSitting ? "4" : "4.5"}
              fill="#F27420"
              stroke="#3C2415"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isWalking ? "duck-walking-foot-left" : ""}
            />
            {/* Right Foot */}
            <ellipse
              cx="62"
              cy={isSitting ? "86" : "85"}
              rx={isSitting ? "8" : "9"}
              ry={isSitting ? "4" : "4.5"}
              fill="#F27420"
              stroke="#3C2415"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isWalking ? "duck-walking-foot-right" : ""}
            />
          </g>
        )}

        {/* Chubby Pear Body / Sleeping Loaf Silhouette */}
        {isSleeping ? (
          <path
            d="M 22 80 C 16 66, 26 50, 48 48 C 68 46, 88 56, 88 72 C 88 82, 74 85, 54 85 C 34 85, 26 84, 22 80 Z"
            fill="#FDE872"
            stroke="#3C2415"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M 50 18 C 66 18, 77 28, 76 42 C 75 54, 84 62, 84 74 C 84 84, 66 85, 50 85 C 34 85, 16 84, 16 74 C 16 62, 25 54, 24 42 C 23 28, 34 18, 50 18 Z"
            fill="#FDE872"
            stroke="#3C2415"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Soft Belly Depth Highlight */}
        <ellipse
          cx="50"
          cy="78"
          rx="24"
          ry="5.5"
          fill="#F59E0B"
          fillOpacity="0.22"
        />

        {/* Wings (Flippers) */}
        {!isSleeping && (
          <g id="duck-wings">
            <ellipse
              cx="22"
              cy="56"
              rx="6.5"
              ry="12"
              fill="#FDE872"
              stroke="#3C2415"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              transform="rotate(-10 22 56)"
            />
            <ellipse
              cx="78"
              cy="56"
              rx="6.5"
              ry="12"
              fill="#FDE872"
              stroke="#3C2415"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              transform="rotate(10 78 56)"
            />
          </g>
        )}

        {/* Headphones (Listening Mode) */}
        {isListening && (
          <g id="duck-headphones">
            {/* Headband arch */}
            <path
              d="M 28 42 C 28 20, 72 20, 72 42"
              stroke="#1E293B"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            {/* Left earcup */}
            <rect x="22" y="36" width="7" height="15" rx="3.5" fill="#334155" stroke="#3C2415" strokeWidth="1.8" />
            <circle cx="25.5" cy="43.5" r="2" fill="#38BDF8" />
            {/* Right earcup */}
            <rect x="71" y="36" width="7" height="15" rx="3.5" fill="#334155" stroke="#3C2415" strokeWidth="1.8" />
            <circle cx="74.5" cy="43.5" r="2" fill="#38BDF8" />
          </g>
        )}

        {/* Beak & Mouth Cavity */}
        <g id="duck-beak">
          {isSpeaking ? (
            <g className="duck-beak-speaking">
              {/* Open Mouth Cavity */}
              <ellipse cx="50" cy="48" rx="8.5" ry="5.5" fill="#8A1C14" />
              {/* Red Tongue */}
              <ellipse cx="50" cy="51" rx="4" ry="2" fill="#EF4444" />
              {/* Upper Beak */}
              <path
                d="M 40 46 C 40 42, 60 42, 60 46 Z"
                fill="#F27420"
                stroke="#3C2415"
                strokeWidth="2.2"
              />
              {/* Lower Beak */}
              <path
                d="M 42 50 C 42 54, 58 54, 58 50 Z"
                fill="#F27420"
                stroke="#3C2415"
                strokeWidth="2"
              />
            </g>
          ) : (
            <ellipse
              cx="50"
              cy={isSleeping ? "66" : "46"}
              rx="10"
              ry="6"
              fill="#F27420"
              stroke="#3C2415"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>

        {/* Eyes (Blinking, Sleeping, or Beady Dots) */}
        <g id="duck-eyes">
          {isSleeping ? (
            <>
              {/* Sleeping Peaceful Curves ‿ ‿ */}
              <path d="M 33 60 Q 37 63 41 60" stroke="#3C2415" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M 59 60 Q 63 63 67 60" stroke="#3C2415" strokeWidth="2.4" strokeLinecap="round" />
            </>
          ) : isBlinking || isListening ? (
            <>
              {/* Arched Closed Curves ⌒ ⌒ */}
              <path d="M 33 40 Q 37 36 41 40" stroke="#3C2415" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M 59 40 Q 63 36 67 40" stroke="#3C2415" strokeWidth="2.4" strokeLinecap="round" />
            </>
          ) : (
            <>
              {/* Beady Dark Brown Dots • • */}
              <circle cx="37" cy="40" r="3" fill="#3C2415" />
              <circle cx="63" cy="40" r="3" fill="#3C2415" />
            </>
          )}
        </g>

        {/* Rosy Pink Cheeks */}
        <ellipse cx="28" cy={isSleeping ? "68" : "48"} rx="4.5" ry="3.5" fill="#F43F5E" fillOpacity="0.4" />
        <ellipse cx="72" cy={isSleeping ? "68" : "48"} rx="4.5" ry="3.5" fill="#F43F5E" fillOpacity="0.4" />
      </svg>
    </div>
  );
};
