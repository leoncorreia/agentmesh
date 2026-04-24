type SponsorState = 'configured' | 'missing' | 'degraded';

export type SponsorStatus = {
  redis: SponsorState;
  tinyfish: SponsorState;
  bedrock: SponsorState;
  nexla: SponsorState;
  ghost: SponsorState;
  wundergraph: SponsorState;
};

function ok(v?: string): boolean {
  return Boolean(v) && !String(v).startsWith('PLACEHOLDER');
}

export function getSponsorStatus(): SponsorStatus {
  return {
    redis: ok(process.env.REDIS_URL) ? 'configured' : 'missing',
    tinyfish: ok(process.env.TINYFISH_API_KEY) ? 'configured' : 'missing',
    bedrock:
      ok(process.env.AWS_ACCESS_KEY_ID) && ok(process.env.AWS_SECRET_ACCESS_KEY)
        ? 'configured'
        : 'missing',
    nexla:
      ok(process.env.NEXLA_API_URL) &&
      ok(process.env.NEXLA_API_KEY) &&
      ok(process.env.NEXLA_FLOW_ID)
        ? 'configured'
        : 'missing',
    ghost:
      ok(process.env.GHOST_API_URL) && ok(process.env.GHOST_CONTENT_API_KEY)
        ? 'configured'
        : 'missing',
    wundergraph:
      ok(process.env.WUNDERGRAPH_API_URL) && ok(process.env.WUNDERGRAPH_API_KEY)
        ? 'configured'
        : 'missing',
  };
}

export async function fetchWundergraphSignals(
  sources: string[],
): Promise<string[]> {
  const url = process.env.WUNDERGRAPH_API_URL;
  const key = process.env.WUNDERGRAPH_API_KEY;
  if (!ok(url) || !ok(key)) return [];

  const endpoint = String(url).replace(/\/$/, '');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: `
          query SponsorSignals($sources: [String!]!) {
            sponsorSignals(sources: $sources)
          }
        `,
        variables: { sources },
      }),
      signal: ac.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { sponsorSignals?: unknown };
    };
    const raw = body.data?.sponsorSignals;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    return [String(raw)];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}
