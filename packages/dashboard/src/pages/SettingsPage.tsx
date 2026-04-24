import { useEffect, useState } from 'react';
import { coreUrl, fetchMeshState } from '../lib/meshClient';

export function SettingsPage() {
  const [json, setJson] = useState('');
  const [autonomy, setAutonomy] = useState('{}');
  useEffect(() => {
    void fetchMeshState()
      .then((s) => setJson(JSON.stringify(s, null, 2)))
      .catch(() => setJson('{}'));
    void fetch(coreUrl('/autonomy/status'))
      .then((r) => r.json())
      .then((s) => setAutonomy(JSON.stringify(s, null, 2)))
      .catch(() => setAutonomy('{}'));
  }, []);

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-xl font-semibold">Settings (demo)</h1>
      <p className="text-slate-400 text-sm">
        Read-only snapshot from <span className="font-mono">/mesh/state</span> for
        demo configuration awareness.
      </p>
      <textarea
        readOnly
        className="w-full h-96 bg-black/40 border border-white/10 rounded-lg p-4 font-mono text-xs"
        value={json}
      />
      <h2 className="text-sm uppercase tracking-wide text-slate-400">
        Autonomy status
      </h2>
      <textarea
        readOnly
        className="w-full h-40 bg-black/40 border border-white/10 rounded-lg p-4 font-mono text-xs"
        value={autonomy}
      />
    </div>
  );
}
