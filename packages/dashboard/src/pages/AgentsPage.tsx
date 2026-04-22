import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAgents } from '../lib/meshClient';

type Agent = {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
};

export function AgentsPage() {
  const [rows, setRows] = useState<Agent[]>([]);
  useEffect(() => {
    void fetchAgents().then((a) => setRows(a as Agent[]));
    const id = window.setInterval(() => {
      void fetchAgents().then((a) => setRows(a as Agent[]));
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Agents</h1>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-400 border-b border-white/10">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Status</th>
              <th className="p-3">Capabilities</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-white/5">
                <td className="p-3">
                  <Link className="text-mesh-accent" to={`/agents/${a.id}`}>
                    {a.name}
                  </Link>
                </td>
                <td className="p-3">
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      a.status === 'online'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : a.status === 'busy'
                          ? 'bg-amber-500/20 text-amber-200'
                          : 'bg-slate-600/40 text-slate-300'
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs text-slate-300">
                  {(a.capabilities ?? []).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
