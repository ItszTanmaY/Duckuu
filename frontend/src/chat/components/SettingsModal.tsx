import React, { useState, useEffect } from 'react';
import { X, Save, Key, Cpu, Volume2, Gauge, Anchor } from 'lucide-react';
import { AppSettings, UpdateSettingsRequest } from '@/types/api';
import { apiFetch } from '@/config/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('');
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:3b');
  const [llmProvider, setLlmProvider] = useState<AppSettings['llm_provider']>('auto');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [petSpeed, setPetSpeed] = useState(1.0);
  const [autoDock, setAutoDock] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    apiFetch('/api/settings')
      .then((res) => res.json())
      .then((data: AppSettings) => {
        setSettings(data);
        setLlmProvider(data.llm_provider);
        setOllamaModel(data.ollama_model);
        setAudioEnabled(data.audio_enabled);
        setPetSpeed(data.pet_speed);
        setAutoDock(data.auto_dock);
        if (data.elevenlabs_voice_id) setElevenlabsVoiceId(data.elevenlabs_voice_id);
      })
      .catch((err) => console.error(err));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    const payload: UpdateSettingsRequest = {
      llm_provider: llmProvider,
      ollama_model: ollamaModel,
      audio_enabled: audioEnabled,
      pet_speed: petSpeed,
      auto_dock: autoDock
    };

    if (groqKey.trim()) payload.groq_api_key = groqKey.trim();
    if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
    if (openaiKey.trim()) payload.openai_api_key = openaiKey.trim();
    if (elevenlabsKey.trim()) payload.elevenlabs_api_key = elevenlabsKey.trim();
    if (elevenlabsVoiceId.trim()) payload.elevenlabs_voice_id = elevenlabsVoiceId.trim();

    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSaveMessage('Settings saved successfully!');
        setTimeout(() => {
          setSaveMessage('');
          onClose();
        }, 1000);
      } else {
        setSaveMessage('Failed to save settings.');
      }
    } catch {
      setSaveMessage('Network error saving settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4 text-xs">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-100">Duckuu Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {/* Provider Selection */}
          <div className="space-y-1">
            <label className="text-slate-300 font-medium">LLM Router Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value as any)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
            >
              <option value="auto">Auto-Adaptive (Local Ollama with Cloud Fallback)</option>
              <option value="ollama">Force Local Ollama</option>
              <option value="groq">Force Cloud Groq</option>
              <option value="gemini">Force Cloud Google Gemini</option>
              <option value="openai">Force Cloud OpenAI</option>
            </select>
          </div>

          {/* Ollama Model */}
          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Ollama Local Model</label>
            <input
              type="text"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              placeholder="e.g. qwen2.5:3b or llama3.2:3b"
              className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Cloud API Keys */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Cloud Fallback Keys</span>
            </div>

            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder={settings?.groq_api_key_configured ? 'Groq API Key (Configured)' : 'Groq API Key (gsk_...)'}
              className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
            />

            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={settings?.gemini_api_key_configured ? 'Gemini API Key (Configured)' : 'Google Gemini API Key (AIza...)'}
              className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
            />

            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={settings?.openai_api_key_configured ? 'OpenAI API Key (Configured)' : 'OpenAI API Key (sk-...)'}
              className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
            />

            {/* ElevenLabs API Key & Voice ID */}
            <div className="pt-2 border-t border-white/5 space-y-1.5">
              <label className="text-slate-300 font-medium flex items-center justify-between">
                <span>ElevenLabs Studio Voice</span>
                <span className="text-[10px] text-amber-400 font-normal">Optional Hyper-Realistic TTS</span>
              </label>
              <input
                type="password"
                value={elevenlabsKey}
                onChange={(e) => setElevenlabsKey(e.target.value)}
                placeholder={settings?.elevenlabs_api_key_configured ? 'ElevenLabs API Key (Configured)' : 'ElevenLabs API Key (sk_...)'}
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
              />
              <input
                type="text"
                value={elevenlabsVoiceId}
                onChange={(e) => setElevenlabsVoiceId(e.target.value)}
                placeholder="ElevenLabs Voice ID (e.g. 21m00Tcm4TlvDq8ikWAM or custom)"
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>

          {/* Pet Speed & Behavior */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-sky-400" /> Pet Speed ({petSpeed}x)
              </span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={petSpeed}
                onChange={(e) => setPetSpeed(parseFloat(e.target.value))}
                className="w-28 accent-amber-500"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-300 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> Audio Quacks & Sound FX
              </span>
              <input
                type="checkbox"
                checked={audioEnabled}
                onChange={(e) => setAudioEnabled(e.target.checked)}
                className="w-4 h-4 accent-amber-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-300 flex items-center gap-1.5">
                <Anchor className="w-3.5 h-3.5 text-amber-400" /> Auto-dock Chat to Duck
              </span>
              <input
                type="checkbox"
                checked={autoDock}
                onChange={(e) => setAutoDock(e.target.checked)}
                className="w-4 h-4 accent-amber-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-[11px] text-amber-400 font-medium">{saveMessage}</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold transition-all shadow"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
