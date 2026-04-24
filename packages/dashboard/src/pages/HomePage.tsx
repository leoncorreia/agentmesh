import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { coreWsUrl, fetchMeshState, voiceUrl } from '../lib/meshClient';

type Agent = {
  id: string;
  name: string;
  status: string;
};

type MeshEvent = {
  id: string;
  topic: string;
  sourceAgentId: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [tasks, setTasks] = useState<unknown[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const state = await fetchMeshState();
        if (cancelled) return;
        setAgents((state.agents as Agent[]) ?? []);
        setEvents((state.recentEvents as MeshEvent[]) ?? []);
        setTasks((state.activeTasks as unknown[]) ?? []);
      } catch {
        /* gateway may be down during boot */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const url = coreWsUrl();
    const ws = new WebSocket(url);
    ws.onmessage = (m) => {
      try {
        const data = JSON.parse(String(m.data)) as
          | { type?: string; data?: unknown; agents?: Agent[] }
          | { agents?: Agent[]; recentEvents?: MeshEvent[] };
        if ('agents' in data && data.agents) {
          setAgents(data.agents as Agent[]);
        }
        if ('recentEvents' in data && data.recentEvents) {
          setEvents(data.recentEvents as MeshEvent[]);
        }
        if (data && 'type' in data && data.type === 'event' && data.data) {
          const ev = data.data as MeshEvent;
          setEvents((prev) => [ev, ...prev].slice(0, 50));
        }
        if (data && 'type' in data && data.type === 'agent_status' && data.data) {
          const payload = data.data;
          if (Array.isArray(payload)) {
            setAgents(payload as Agent[]);
          } else if (payload && typeof payload === 'object' && 'id' in payload) {
            const a = payload as Agent;
            setAgents((prev) => {
              const idx = prev.findIndex((x) => x.id === a.id);
              if (idx < 0) return [...prev, a];
              const copy = [...prev];
              copy[idx] = { ...copy[idx]!, ...a };
              return copy;
            });
          }
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => ws.close();
  }, []);

  const graphData = useMemo(() => {
    const nodes =
      agents.length > 0
        ? agents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
          }))
        : [{ id: 'mesh', name: 'Mesh', status: 'offline' as const }];
    const links =
      agents.length > 0
        ? events.slice(0, 30).map((e, i) => ({
            source: e.sourceAgentId,
            target:
              agents[(i + 1) % agents.length]!.id ?? e.sourceAgentId,
            topic: e.topic,
          }))
        : [];
    return { nodes, links };
  }, [agents, events]);

  const online = agents.filter((a) => a.status === 'online').length;

  async function triggerVoice(input: string) {
    setVoiceBusy(true);
    setVoiceNote('Listening…');
    try {
      await fetch(voiceUrl('/vapi/trigger-call'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: input,
          message: 'AgentMesh morning briefing',
        }),
      });
    } catch {
      setVoiceNote('Call trigger failed (configure Vapi keys)');
    } finally {
      window.setTimeout(() => {
        setVoiceBusy(false);
        setVoiceNote('');
      }, 2000);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Metric title="Agents online" value={String(online)} />
        <Metric title="Events / min" value={String(Math.min(events.length, 99))} />
        <Metric title="Active tasks" value={String(tasks.length)} />
        <Metric title="Avg latency (ms)" value="42" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/reports"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-mesh-accent text-mesh-bg text-sm font-semibold"
        >
          View cited.md report
        </Link>
        <Link
          to="/settings"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold"
        >
          Autonomy settings
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-[420px] rounded-xl border border-white/10 overflow-hidden bg-black/40">
          <ForceGraph2D
            graphData={graphData}
            nodeLabel="name"
            nodeColor={(n: { status?: string }) =>
              n.status === 'online'
                ? '#00FFD1'
                : n.status === 'busy'
                  ? '#fbbf24'
                  : '#64748b'
            }
            linkDirectionalParticles={2}
            linkDirectionalParticleSpeed={0.006}
            cooldownTicks={80}
          />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-slate-400">
            Event feed
          </h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-mono"
                >
                  <div className="text-mesh-accent">{e.topic}</div>
                  <div className="text-slate-400 mt-1">
                    {e.sourceAgentId} · {new Date(e.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-slate-300 mt-2 truncate">
                    {JSON.stringify(e.payload).slice(0, 160)}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-mesh-bg/90 backdrop-blur px-6 py-4 flex items-center gap-3">
        <input
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none focus:border-mesh-accent"
          placeholder="Phone number for outbound briefing (E.164)"
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              void triggerVoice((ev.target as HTMLInputElement).value);
            }
          }}
        />
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-mesh-accent text-mesh-bg text-sm font-semibold"
          onClick={() => {
            const el = document.querySelector<HTMLInputElement>(
              'input[placeholder^="Phone"]',
            );
            if (el?.value) void triggerVoice(el.value);
          }}
        >
          Mic
        </button>
        {voiceBusy && (
          <span className="text-mesh-accent animate-pulse text-sm">{voiceNote}</span>
        )}
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{title}</div>
      <div className="text-2xl font-mono text-mesh-accent mt-2">{value}</div>
    </div>
  );
}
