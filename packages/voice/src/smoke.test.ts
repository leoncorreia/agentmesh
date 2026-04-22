import { describe, expect, it } from 'vitest';

describe('voice', () => {
  it('default voice port', () => {
    expect(Number(process.env.VOICE_PORT ?? 3004)).toBeGreaterThan(0);
  });
});
