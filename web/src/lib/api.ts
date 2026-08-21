import type {
  Approval,
  AuditEvent,
  Bootstrap,
  ExecutionRow,
  IntentGraph,
  Kpis,
  PlanView,
  SandboxSnapshot,
} from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  kpis: () => request<Kpis>('/kpis'),
  graph: () => request<IntentGraph>('/graph'),
  executions: (filter = 'all', limit = 200) =>
    request<{ total: number; rows: ExecutionRow[] }>(`/executions?filter=${filter}&limit=${limit}`),
  execution: (id: string) => request<ExecutionRow>(`/executions/${id}`),
  approvals: () => request<Approval[]>('/approvals'),
  decide: (id: string, verdict: 'APPROVE' | 'REJECT', approver: string) =>
    request<{
      status: string;
      execution: ExecutionRow;
      authorization: unknown;
      sandbox: SandboxSnapshot;
    }>(`/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ verdict, approver }),
    }),
  agent: (id: string) =>
    request<{
      agent: import('./types').Agent;
      plan: PlanView | null;
      executions: ExecutionRow[];
      tools: import('./types').ToolInfo[];
      restricted: import('./types').ToolInfo[];
      run: import('./types').RunState | null;
    }>(`/agents/${id}`),
  plans: () => request<PlanView[]>('/plans'),
  plan: (id: string) => request<PlanView>(`/plans/${id}`),
  planIntegrity: (id: string, action: 'tamper' | 'restore') =>
    request<PlanView>(`/plans/${id}/integrity`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  audit: (category = 'all', limit = 150) =>
    request<{
      chain: { intact: boolean; length: number; head: string | null };
      total: number;
      rows: AuditEvent[];
    }>(`/audit?category=${category}&limit=${limit}`),
  auditEvent: (id: string) =>
    request<{ event: AuditEvent; execution: ExecutionRow | null }>(`/audit/${id}`),
  sandbox: () => request<SandboxSnapshot>('/sandbox'),
  runDemo: (scenario: 'refund' | 'invoice' = 'refund', stepDelayMs = 1100) =>
    request<{ runId: string; planId: string }>('/demo/run', {
      method: 'POST',
      body: JSON.stringify({ scenario, stepDelayMs }),
    }),
  reset: () => request<{ ok: boolean; kpis: Kpis }>('/demo/reset', { method: 'POST', body: '{}' }),
  probe: (input: {
    tool: string;
    to?: string;
    attach?: 'extracted' | 'status' | 'none';
    agentId?: string;
    amount?: number;
    orderId?: string;
    customerId?: string;
    invoiceId?: string;
  }) =>
    request<{
      execution: ExecutionRow;
      authorization: import('./types').Authorization;
      approvalId: string | null;
      sandbox: SandboxSnapshot;
    }>('/probe', { method: 'POST', body: JSON.stringify(input) }),
  agentStatus: (id: string, status: 'ACTIVE' | 'PAUSED' | 'REVOKED') =>
    request<unknown>(`/agents/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  sdk: () => request<import('./types').SdkReport>('/sdk'),
  credentials: () => request<import('./types').CredentialStatus[]>('/credentials'),
  setCredential: (provider: import('./types').ProviderId, apiKey: string) =>
    request<import('./types').CredentialStatus[]>('/credentials', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    }),
  clearCredential: (provider: import('./types').ProviderId) =>
    request<import('./types').CredentialStatus[]>(`/credentials/${provider}`, {
      method: 'DELETE',
    }),
  sdkSelfTest: () =>
    request<import('./types').SdkReport>('/sdk/selftest', { method: 'POST', body: '{}' }),
};
