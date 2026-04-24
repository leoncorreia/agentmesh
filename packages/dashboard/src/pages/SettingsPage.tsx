import { useEffect, useState } from 'react';
import { coreUrl, fetchMeshState } from '../lib/meshClient';

export function SettingsPage() {
  const [json, setJson] = useState('');
  const [autonomy, setAutonomy] = useState('{}');
  const [enabled, setEnabled] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState('180');
  const [briefingPhone, setBriefingPhone] = useState('');
  const [sources, setSources] = useState('');
  const [note, setNote] = useState('');

  async function refreshAutonomy(): Promise<void> {
    try {
      const statusRes = await fetch(coreUrl('/autonomy/status'));
      const status = (await statusRes.json()) as Record<string, unknown>;
      setAutonomy(JSON.stringify(status, null, 2));
      const configRes = await fetch(coreUrl('/autonomy/config'));
      const config = (await configRes.json()) as {
        enabled?: boolean;
        intervalSeconds?: number;
        briefingPhone?: string;
        sources?: string[];
      };
      setEnabled(Boolean(config.enabled));
      setIntervalSeconds(String(config.intervalSeconds ?? 180));
      setBriefingPhone(config.briefingPhone ?? '');
      setSources((config.sources ?? []).join('\n'));
    } catch {
      setAutonomy('{}');
    }
  }

  useEffect(() => {
    void fetchMeshState()
      .then((s) => setJson(JSON.stringify(s, null, 2)))
      .catch(() => setJson('{}'));
    void refreshAutonomy();
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
        Autonomy controls
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable autonomous loop
        </label>
        <label className="flex flex-col gap-1">
          Interval seconds
          <input
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Briefing phone (E.164)
        <input
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-2"
          value={briefingPhone}
          onChange={(e) => setBriefingPhone(e.target.value)}
          placeholder="+14085551234"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Source URLs (one per line)
        <textarea
          className="h-28 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs"
          value={sources}
          onChange={(e) => setSources(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-mesh-accent text-mesh-bg text-sm font-semibold"
          onClick={async () => {
            setNote('Saving...');
            try {
              const payload = {
                enabled,
                intervalSeconds: Number(intervalSeconds),
                briefingPhone,
                sources: sources
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              };
              await fetch(coreUrl('/autonomy/config'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              await refreshAutonomy();
              setNote('Saved autonomy config');
            } catch {
              setNote('Failed to save config');
            }
          }}
        >
          Save config
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold"
          onClick={async () => {
            setNote('Triggering run...');
            try {
              await fetch(coreUrl('/autonomy/run-now'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              });
              await refreshAutonomy();
              setNote('Manual run triggered');
            } catch {
              setNote('Failed to trigger run');
            }
          }}
        >
          Run now
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold"
          onClick={() => void refreshAutonomy()}
        >
          Refresh
        </button>
      </div>
      {note ? <p className="text-xs text-slate-300">{note}</p> : null}
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
