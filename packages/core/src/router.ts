import type { MeshEvent } from './types.js';
import { subscribePattern, setRoutedMarker } from './bus.js';
import { findAgentsSubscribedToTopic } from './registry.js';
import { transformPayload } from './transformer.js';

let started = false;

function topicFromChannel(channel: string, fallbackTopic: string): string {
  const prefix = 'mesh:events:';
  return channel.startsWith(prefix)
    ? channel.slice(prefix.length)
    : fallbackTopic;
}

async function persistGhostEvent(event: MeshEvent, topic: string): Promise<void> {
  const base = process.env.GHOST_API_URL;
  const key = process.env.GHOST_CONTENT_API_KEY;
  if (
    !base ||
    base.startsWith('PLACEHOLDER') ||
    !key ||
    key.startsWith('PLACEHOLDER')
  ) {
    return;
  }
  try {
    const url = `${base.replace(/\/$/, '')}/ghost/api/admin/posts`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Ghost ${key}`,
      },
      body: JSON.stringify({
        posts: [
          {
            title: `Mesh event: ${topic}`,
            tags: [{ name: 'mesh-events', slug: 'mesh-events' }],
            mobiledoc: JSON.stringify({
              version: '1.0',
              atoms: [],
              cards: [],
              markups: [],
              sections: [[1, 'p', [[0, [], 0, JSON.stringify(event)]]]],
            }),
            status: 'published',
          },
        ],
      }),
    });
  } catch {
    /* storage failure must not block routing */
  }
}

export function startRouter(): void {
  if (started) return;
  started = true;
  subscribePattern('mesh:events:*', (event, channel) => {
    void routeEvent(event, topicFromChannel(channel, event.topic));
  });
}

async function routeEvent(event: MeshEvent, topic: string): Promise<void> {
  void persistGhostEvent(event, topic);
  const agents = await findAgentsSubscribedToTopic(topic);
  const online = agents.filter((a) => a.status === 'online');
  for (const agent of online) {
    try {
      const transformed = await transformPayload(
        event.payload,
        event.sourceAgentId,
        agent.id,
      );
      const outgoing: MeshEvent = { ...event, payload: transformed };
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      await fetch(`${agent.endpoint.replace(/\/$/, '')}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outgoing),
        signal: ac.signal,
      });
      clearTimeout(t);
    } catch {
      /* delivery errors are non-fatal for mesh continuity */
    }
  }
  try {
    await setRoutedMarker(event.id);
  } catch {
    /* */
  }
}

export function stopRouter(): void {
  started = false;
}
