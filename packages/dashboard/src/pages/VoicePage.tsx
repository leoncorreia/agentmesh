import { useState } from 'react';
import { coreUrl } from '../lib/meshClient';

export function VoicePage() {
  const [transcript, setTranscript] = useState<string | null>(null);
  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <h1 className="text-xl font-semibold">Voice</h1>
      <p className="text-slate-400 text-sm">
        Last saved transcript keys live in Redis as{' '}
        <span className="font-mono text-mesh-accent">mesh:voice:transcript:*</span>.
      </p>
      <button
        type="button"
        className="px-4 py-2 rounded-lg bg-mesh-accent text-mesh-bg text-sm font-semibold"
        onClick={async () => {
          const key = window.prompt('Redis transcript key (call id)');
          if (!key) return;
          const res = await fetch(coreUrl('/health')).catch(() => null);
          setTranscript(
            res
              ? 'Connect Redis CLI to read mesh:voice:transcript:' + key
              : 'Core unreachable',
          );
        }}
      >
        Inspect last call
      </button>
      {transcript && (
        <pre className="text-xs bg-white/5 border border-white/10 rounded-lg p-4 whitespace-pre-wrap">
          {transcript}
        </pre>
      )}
    </div>
  );
}
