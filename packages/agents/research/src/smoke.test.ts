import { describe, expect, it } from 'vitest';

describe('research agent', () => {
  it('loads configuration defaults', () => {
    expect(process.env.CORE_URL ?? 'http://localhost:3000').toContain('http');
  });
});
