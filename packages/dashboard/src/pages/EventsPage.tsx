import { useEffect, useState } from 'react';
import { fetchMeshState } from '../lib/meshClient';

type MeshEvent = {
  id: string;
  topic: string;
  sourceAgentId: string;
  timestamp: string;
};

export function EventsPage() {
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [topic, setTopic] = useState('');
  const [agent, setAgent] = useState('');

  useEffect(() => {
    const load = async () => {
      const s = await fetchMeshState();
      setEvents((s.recentEvents as MeshEvent[]) ?? []);
    };
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, []);

  const filtered = events.filter(
    (e) =>
      (!topic || e.topic.includes(topic)) &&
      (!agent || e.sourceAgentId.includes(agent)),
  );

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Events</h1>
      <div className="flex gap-3">
        <input
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex-1"
          placeholder="Filter topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <input
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex-1"
          placeholder="Filter agent id"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        />
      </div>
      <ul className="space-y-2 font-mono text-xs">
        {filtered.map((e) => (
          <li
            key={e.id}
            className="border border-white/10 rounded-lg p-3 flex justify-between gap-4"
          >
            <span className="text-mesh-accent">{e.topic}</span>
            <span className="text-slate-400">{e.sourceAgentId}</span>
            <span className="text-slate-500">
              {new Date(e.timestamp).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
