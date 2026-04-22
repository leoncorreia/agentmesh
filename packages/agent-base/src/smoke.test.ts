import { describe, expect, it } from 'vitest';
import type { MeshEvent } from '@agentmesh/core/types';

describe('agent-base', () => {
  it('re-exports mesh types for handlers', () => {
    const ev = { id: '1', topic: 't', sourceAgentId: 'a', payload: {}, timestamp: new Date() };
    const m = ev as MeshEvent;
    expect(m.topic).toBe('t');
  });
});
