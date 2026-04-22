export interface AgentRegistration {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  subscriptions: string[];
  endpoint: string;
  healthEndpoint: string;
  registeredAt: Date;
  lastSeen: Date;
  status: 'online' | 'offline' | 'busy';
}

export interface MeshEvent {
  id: string;
  topic: string;
  sourceAgentId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  ttl?: number;
}

export interface TaskRequest {
  id: string;
  originAgentId: string | 'user';
  targetCapability: string;
  input: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high';
  timeoutMs: number;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  output: Record<string, unknown>;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

export interface MeshState {
  agents: AgentRegistration[];
  recentEvents: MeshEvent[];
  activeTasks: TaskRequest[];
}
