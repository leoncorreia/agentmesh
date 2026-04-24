export interface MonetizationRequest {
  summary: string;
  amountUsd: number;
  metadata: Record<string, unknown>;
}

export interface MonetizationResult {
  rail: 'x402' | 'mpp' | 'cdp' | 'agentic.market';
  ok: boolean;
  status?: number;
  responsePreview: string;
}

type RailConfig = {
  rail: MonetizationResult['rail'];
  endpoint?: string;
  apiKey?: string;
};

function configuredRails(): RailConfig[] {
  const rails: RailConfig[] = [
    {
      rail: 'x402',
      endpoint: process.env.X402_ENDPOINT,
      apiKey: process.env.X402_API_KEY,
    },
    {
      rail: 'mpp',
      endpoint: process.env.MPP_ENDPOINT,
      apiKey: process.env.MPP_API_KEY,
    },
    {
      rail: 'cdp',
      endpoint: process.env.CDP_ENDPOINT,
      apiKey: process.env.CDP_API_KEY,
    },
    {
      rail: 'agentic.market',
      endpoint: process.env.AGENTIC_MARKET_ENDPOINT,
      apiKey: process.env.AGENTIC_MARKET_API_KEY,
    },
  ];
  return rails.filter(
    (x) => Boolean(x.endpoint) && !x.endpoint!.startsWith('PLACEHOLDER'),
  );
}

export async function executeMonetization(
  request: MonetizationRequest,
): Promise<MonetizationResult[]> {
  const rails = configuredRails();
  const results: MonetizationResult[] = [];
  for (const rail of rails) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (rail.apiKey && !rail.apiKey.startsWith('PLACEHOLDER')) {
        headers.Authorization = `Bearer ${rail.apiKey}`;
      }
      const res = await fetch(rail.endpoint!, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          summary: request.summary,
          amountUsd: request.amountUsd,
          metadata: request.metadata,
          timestamp: new Date().toISOString(),
        }),
      });
      const text = await res.text();
      results.push({
        rail: rail.rail,
        ok: res.ok,
        status: res.status,
        responsePreview: text.slice(0, 300),
      });
    } catch (e) {
      results.push({
        rail: rail.rail,
        ok: false,
        responsePreview: e instanceof Error ? e.message : 'unknown error',
      });
    }
  }
  return results;
}
