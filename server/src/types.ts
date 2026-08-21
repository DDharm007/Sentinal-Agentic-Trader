import type { Effect, Grant, Requirement, RiskTier, CoverageResult } from './armoriq/capabilities.js';

export type Decision = 'ALLOWED' | 'HELD' | 'BLOCKED';
export type VerificationState = 'VERIFIED' | 'OUT_OF_SCOPE' | 'INTEGRITY_FAILED' | 'EXPIRED' | 'REVOKED';
export type ExecutionResult = 'SUCCESS' | 'NOT_EXECUTED' | 'FAILED' | 'PENDING';

export interface PlanDocument {
  planId: string;
  agentId: string;
  intent: string;
  grants: Grant[];
  /** Declared step sequence the agent proposed at plan time. */
  declaredSteps: { tool: string; summary: string }[];
  issuedAt: string;
  expiresAt: string;
  version: number;
  /** Digest of the plan this document supersedes - forms the plan chain. */
  previousDigest: string | null;
  amendment?: {
    reason: string;
    approvalId: string;
    grants: Grant[];
    singleUse: boolean;
    approver: string;
  };
}

export interface SignedPlan {
  document: PlanDocument;
  digest: string;
  signature: string;
  keyId: string;
  algorithm: string;
  /** Set when an operator deliberately tampers with the plan in the console. */
  tampered?: boolean;
  revokedAt?: string | null;
  consumedAmendment?: boolean;
}

export interface DecisionStep {
  key: string;
  label: string;
  detail: string;
  status: 'pass' | 'fail' | 'info';
}

export interface AuthorizationDecision {
  decision: Decision;
  verification: VerificationState;
  reason: string;
  requirements: Requirement[];
  coverage: CoverageResult[];
  unsatisfied: CoverageResult[];
  trace: DecisionStep[];
  planId: string;
  planVersion: number;
  planDigest: string;
  signatureValid: boolean;
  riskTier: RiskTier;
  amendmentUsed?: boolean;
  evaluatedAt: string;
  durationMs: number;
}

export interface ExecutionRecord {
  id: string;
  runId: string;
  stepIndex: number;
  agentId: string;
  agentName: string;
  tool: string;
  title: string;
  resource: string;
  surface: string;
  args: Record<string, unknown>;
  decision: Decision;
  verification: VerificationState;
  result: ExecutionResult;
  planId: string;
  planVersion: number;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  authorizationMs: number;
  output?: unknown;
  error?: string;
  approvalId?: string;
  authorization: AuthorizationDecision;
  /** Second evaluation performed after a human approval amended the plan. */
  resumeAuthorization?: AuthorizationDecision;
  resumedAt?: string;
  origin: 'planned' | 'injected' | 'operator';
  originNote?: string;
  /** True for generated history that predates this process. */
  seeded?: boolean;
}

export interface ApprovalRequest {
  id: string;
  executionId: string;
  runId: string;
  agentId: string;
  agentName: string;
  tool: string;
  title: string;
  target: string;
  planId: string;
  requestedAt: string;
  resolvedAt?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  decidedBy?: string;
  unsatisfied: CoverageResult[];
  reason: string;
  authorization: AuthorizationDecision;
  contextPreview: Record<string, unknown>;
  seeded?: boolean;
}

export interface AuditEvent {
  id: string;
  seq: number;
  at: string;
  category: 'authorization' | 'execution' | 'approval' | 'plan' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  tool?: string;
  planId?: string;
  decision?: Decision;
  verification?: VerificationState;
  execution?: ExecutionResult;
  humanDecision?: string;
  summary: string;
  chain?: {
    userIntent: string;
    declaredPlan: string;
    agent: string;
    requestedAction: string;
    verification: string;
    decision: string;
    executionResult: string;
    humanDecision: string;
  };
  detail?: Record<string, unknown>;
  executionId?: string;
  approvalId?: string;
  /** Hash-linked audit chain: sha256(previousEntryDigest + canonical(entry)). */
  entryDigest: string;
  previousDigest: string | null;
  seeded?: boolean;
}

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  runtime: string;
  owner: string;
  environment: string;
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'HOLDING';
  intent: string;
  planId: string | null;
  tools: string[];
  restricted: string[];
  registeredAt: string;
  lastExecutionAt: string | null;
  actionsToday: number;
  heldToday: number;
  blockedToday: number;
}

export interface IntegrationRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  status: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  mode: 'live' | 'sandbox' | 'simulated';
  detail: string;
  lastCheckedAt: string;
}

export interface PolicyRecord {
  id: string;
  name: string;
  scope: string;
  updatedAt: string;
  version: string;
  statements: {
    disposition: 'ALLOW' | 'APPROVAL' | 'BLOCK';
    title: string;
    description: string;
    tuples: { effect: Effect; resource: string }[];
  }[];
}
