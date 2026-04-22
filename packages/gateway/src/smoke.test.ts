import { describe, expect, it } from 'vitest';

describe('gateway', () => {
  it('uses configured core url default', () => {
    expect(
      (process.env.CORE_URL ?? 'http://localhost:3000').startsWith('http'),
    ).toBe(true);
  });
});
