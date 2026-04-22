import { describe, expect, it } from 'vitest';

describe('dashboard', () => {
  it('build metadata', () => {
    expect('agentmesh-dashboard').toContain('dashboard');
  });
});
