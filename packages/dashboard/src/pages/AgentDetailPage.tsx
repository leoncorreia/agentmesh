import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export function AgentDetailPage() {
  const { id } = useParams();
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void fetch(`/core/agents/${id}`)
      .then((r) => r.json())
      .then(setAgent)
      .catch(() => setAgent(null));
  }, [id]);

  if (!agent) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">{String(agent.name)}</h1>
      <p className="text-slate-300">{String(agent.description ?? '')}</p>
      <div>
        <h2 className="text-sm uppercase text-slate-500">Capabilities</h2>
        <p className="font-mono text-sm">
          {(agent.capabilities as string[] | undefined)?.join(', ')}
        </p>
      </div>
      <div>
        <h2 className="text-sm uppercase text-slate-500">Subscriptions</h2>
        <p className="font-mono text-sm">
          {(agent.subscriptions as string[] | undefined)?.join(', ')}
        </p>
      </div>
    </div>
  );
}
