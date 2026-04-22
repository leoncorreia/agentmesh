export async function transformPayload(
  payload: Record<string, unknown>,
  sourceAgentId: string,
  targetAgentId: string,
): Promise<Record<string, unknown>> {
  const key = process.env.NEXLA_API_KEY;
  const base = process.env.NEXLA_API_URL;
  const flow = process.env.NEXLA_FLOW_ID;
  if (
    !key ||
    key.startsWith('PLACEHOLDER') ||
    !base ||
    base.startsWith('PLACEHOLDER') ||
    !flow ||
    flow.startsWith('PLACEHOLDER')
  ) {
    console.warn(
      '[transformer] Nexla not configured; passing payload through unchanged',
    );
    return payload;
  }
  try {
    const url = `${base.replace(/\/$/, '')}/flows/${flow}/transform`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ payload, sourceAgentId, targetAgentId }),
    });
    if (!res.ok) {
      console.warn('[transformer] Nexla transform failed, passing through');
      return payload;
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (body && typeof body === 'object' && 'data' in body) {
      return body.data as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch (e) {
    console.warn('[transformer] Nexla request error, passing through', e);
    return payload;
  }
}
