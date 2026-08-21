/**
 * In-memory control-plane state plus the hash-linked audit log.
 *
 * Historical rows (everything before the first live run in this process) are
 * generated demo data and carry `seeded: true`. Everything produced by a run,
 * a scope-violation probe or an approval is real: it went through
 * armoriq/engine.ts and, when allowed, through a real sandbox tool surface.
 */
import { digest } from '../armoriq/signing.js';
import type {
  AgentRecord,
  ApprovalRequest,
  AuditEvent,
  AuthorizationDecision,
  Decision,
  ExecutionRecord,
  IntegrationRecord,
  PolicyRecord,
} from '../types.js';

export type StreamEvent =
  | { type: 'execution'; execution: ExecutionRecord }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'audit'; event: AuditEvent }
  | { type: 'agent'; agent: AgentRecord }
  | { type: 'plan'; planId: string }
  | { type: 'run'; runId: string; status: RunStatus; step?: number; note?: string }
  | { type: 'reset' };

export type RunStatus = 'idle' | 'running' | 'waiting-approval' | 'completed' | 'terminated' | 'failed';

type Listener = (event: StreamEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: StreamEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a broken client must not break the control plane */
    }
  }
}

export interface RunState {
  runId: string;
  agentId: string;
  planId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  currentStep: number;
  totalSteps: number;
  note?: string;
  scenario: string;
}

export const db = {
  agents: [] as AgentRecord[],
  executions: [] as ExecutionRecord[],
  approvals: [] as ApprovalRequest[],
  audit: [] as AuditEvent[],
  integrations: [] as IntegrationRecord[],
  policies: [] as PolicyRecord[],
  runs: new Map<string, RunState>(),
};

let auditSeq = 0;
let executionSeq = 0;
let runSeq = 0;

export function nextExecutionId(): string {
  executionSeq += 1;
  return `exe_${executionSeq.toString(36).padStart(5, '0')}`;
}

export function nextRunId(): string {
  runSeq += 1;
  return `run_${Date.now().toString(36)}${runSeq.toString(36)}`;
}

export function nextApprovalId(): string {
  return `apr_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export interface AuditInput extends Omit<AuditEvent, 'id' | 'seq' | 'entryDigest' | 'previousDigest'> {}

export function appendAudit(input: AuditInput): AuditEvent {
  auditSeq += 1;
  const previousDigest = db.audit.length ? db.audit[db.audit.length - 1].entryDigest : null;
  const body = { ...input, seq: auditSeq, previousDigest };
  const event: AuditEvent = {
    ...input,
    id: `aud_${auditSeq.toString(36).padStart(5, '0')}`,
    seq: auditSeq,
    previousDigest,
    entryDigest: digest(body),
  };
  db.audit.push(event);
  emit({ type: 'audit', event });
  return event;
}

export function recordExecution(execution: ExecutionRecord): ExecutionRecord {
  db.executions.push(execution);
  emit({ type: 'execution', execution });
  return execution;
}

export function updateExecution(id: string, patch: Partial<ExecutionRecord>): ExecutionRecord | undefined {
  const index = db.executions.findIndex((e) => e.id === id);
  if (index === -1) return undefined;
  const next = { ...db.executions[index], ...patch };
  db.executions[index] = next;
  emit({ type: 'execution', execution: next });
  return next;
}

export function upsertApproval(approval: ApprovalRequest): ApprovalRequest {
  const index = db.approvals.findIndex((a) => a.id === approval.id);
  if (index === -1) db.approvals.push(approval);
  else db.approvals[index] = approval;
  emit({ type: 'approval', approval });
  return approval;
}

export function updateAgent(agentId: string, patch: Partial<AgentRecord>): AgentRecord | undefined {
  const index = db.agents.findIndex((a) => a.id === agentId);
  if (index === -1) return undefined;
  const next = { ...db.agents[index], ...patch };
  db.agents[index] = next;
  emit({ type: 'agent', agent: next });
  return next;
}

export function setRun(run: RunState): RunState {
  db.runs.set(run.runId, run);
  emit({ type: 'run', runId: run.runId, status: run.status, step: run.currentStep, note: run.note });
  return run;
}

export function getRun(runId: string): RunState | undefined {
  return db.runs.get(runId);
}

export function latestRun(): RunState | undefined {
  return [...db.runs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

export interface Kpis {
  activeAgents: number;
  actionsToday: number;
  allowed: number;
  held: number;
  blocked: number;
  approvedHolds: number;
  pendingApprovals: number;
  approvalRate: number;
  medianAuthorizationMs: number;
}

export function kpis(): Kpis {
  const today = new Date().toISOString().slice(0, 10);
  const todays = db.executions.filter((e) => e.startedAt.slice(0, 10) === today);
  const count = (decision: Decision) => todays.filter((e) => e.decision === decision).length;
  const approvedHolds = todays.filter(
    (e) => e.decision === 'HELD' && e.result === 'SUCCESS',
  ).length;
  const allowed = count('ALLOWED');
  const authorizationTimes = todays
    .map((e) => e.authorizationMs)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return {
    activeAgents: db.agents.filter((a) => a.status === 'ACTIVE' || a.status === 'HOLDING').length,
    actionsToday: todays.length,
    allowed,
    held: count('HELD'),
    blocked: count('BLOCKED'),
    approvedHolds,
    pendingApprovals: db.approvals.filter((a) => a.status === 'PENDING').length,
    approvalRate: todays.length ? ((allowed + approvedHolds) / todays.length) * 100 : 100,
    medianAuthorizationMs: authorizationTimes.length
      ? authorizationTimes[Math.floor(authorizationTimes.length / 2)]
      : 0,
  };
}

export function auditChainIntact(): { intact: boolean; length: number; head: string | null } {
  let previous: string | null = null;
  for (const entry of db.audit) {
    const { id, entryDigest, ...rest } = entry;
    const recomputed = digest({ ...rest, previousDigest: previous });
    if (recomputed !== entryDigest || entry.previousDigest !== previous) {
      return { intact: false, length: db.audit.length, head: previous };
    }
    previous = entry.entryDigest;
  }
  return { intact: true, length: db.audit.length, head: previous };
}

export function summariseAuthorization(a: AuthorizationDecision): Record<string, unknown> {
  return {
    decision: a.decision,
    verification: a.verification,
    reason: a.reason,
    planId: a.planId,
    planVersion: a.planVersion,
    required: a.requirements.map((r) => `${r.effect} : ${r.resource}`),
    uncovered: a.unsatisfied.map((c) => `${c.requirement.effect} : ${c.requirement.resource}`),
    authorizationMs: Number(a.durationMs.toFixed(3)),
  };
}

export function resetCounters(): void {
  auditSeq = 0;
  executionSeq = 0;
  runSeq = 0;
  db.executions.length = 0;
  db.approvals.length = 0;
  db.audit.length = 0;
  db.runs.clear();
}
