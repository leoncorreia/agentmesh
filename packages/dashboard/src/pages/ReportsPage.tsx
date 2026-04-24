import { useCallback, useEffect, useState } from 'react';
import { coreUrl, fetchLatestReports, type LatestReportsPayload } from '../lib/meshClient';

export function ReportsPage() {
  const [data, setData] = useState<LatestReportsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchLatestReports();
      setData(r);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit report (cited.md)</h1>
          <p className="text-slate-400 text-sm mt-1">
            Pulled from <span className="font-mono text-mesh-accent">GET /reports/latest</span> on
            your configured core — no manual URL needed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-mesh-accent text-mesh-bg text-sm font-semibold"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <a
            href={coreUrl('/reports/latest')}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold inline-flex items-center"
          >
            Open JSON in new tab
          </a>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="text-xs text-slate-500 font-mono">
            Snapshot: {new Date(data.generatedAt).toLocaleString()} · Autonomy:{' '}
            {JSON.stringify(data.lastAutonomyStatus)}
          </div>
          <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
            <div className="border-b border-white/10 px-4 py-2 text-xs uppercase tracking-wide text-slate-400">
              cited.md
            </div>
            <article className="p-4 max-h-[min(70vh,720px)] overflow-y-auto">
              {data.citedMarkdown?.trim() ? (
                <div className="whitespace-pre-wrap font-mono text-sm text-slate-200 leading-relaxed">
                  {data.citedMarkdown}
                </div>
              ) : (
                <p className="text-slate-400 text-sm">
                  No <span className="font-mono">cited.md</span> content yet. Run autonomy from{' '}
                  <span className="text-mesh-accent">Settings → Run now</span> (or wait for an
                  interval) after core has written at least one cycle.
                </p>
              )}
            </article>
          </div>
          {data.recentEvents?.length ? (
            <details className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
              <summary className="cursor-pointer text-slate-300 font-medium">
                Recent events ({data.recentEvents.length})
              </summary>
              <pre className="mt-3 text-xs text-slate-400 overflow-x-auto max-h-48 overflow-y-auto">
                {JSON.stringify(data.recentEvents, null, 2)}
              </pre>
            </details>
          ) : null}
        </>
      ) : !error && !loading ? (
        <p className="text-slate-400 text-sm">No data.</p>
      ) : null}
    </div>
  );
}
