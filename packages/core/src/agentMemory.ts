export interface MemoryWriteInput {
  text: string;
  userId: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

function baseUrl(): string | null {
  const url = process.env.AGENT_MEMORY_API_URL;
  if (!url || url.startsWith('PLACEHOLDER')) return null;
  return url.replace(/\/$/, '');
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = process.env.AGENT_MEMORY_API_KEY;
    if (apiKey && !apiKey.startsWith('PLACEHOLDER')) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function writeAutonomyMemory(input: MemoryWriteInput): Promise<boolean> {
  const base = baseUrl();
  if (!base) return false;

  const payload = {
    text: input.text,
    user_id: input.userId,
    session_id: input.sessionId,
    memory_type: 'episodic',
    metadata: input.metadata ?? {},
  };

  const candidates = [
    `${base}/long-term-memory`,
    `${base}/v1/long-term-memory`,
    `${base}/memories`,
    `${base}/v1/memories`,
  ];

  for (const endpoint of candidates) {
    const out = await postJson(endpoint, payload);
    if (out) return true;
  }
  return false;
}

export async function searchAutonomyMemory(query: {
  text: string;
  userId: string;
  sessionId: string;
}): Promise<MemorySearchResult[]> {
  const base = baseUrl();
  if (!base) return [];

  const payload = {
    text: query.text,
    user_id: query.userId,
    session_id: query.sessionId,
    limit: Number(process.env.AGENT_MEMORY_LIMIT ?? 5),
  };

  const candidates = [
    `${base}/search`,
    `${base}/v1/search`,
    `${base}/long-term-memory/search`,
    `${base}/v1/long-term-memory/search`,
  ];

  for (const endpoint of candidates) {
    const out = (await postJson(endpoint, payload)) as
      | { results?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
      | null;
    if (!out) continue;
    const rows = Array.isArray(out) ? out : (out.results ?? []);
    return rows.map((r) => ({
      text: String(r.text ?? r.memory ?? ''),
      score: r.score === undefined ? undefined : Number(r.score),
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    }));
  }
  return [];
}
