export type Decision = 'ALLOWED' | 'HELD' | 'BLOCKED';
export type Verification =
  | 'VERIFIED'
  | 'OUT_OF_SCOPE'
  | 'INTEGRITY_FAILED'
  | 'EXPIRED'
  | 'REVOKED';
export type ExecResult = 'SUCCESS' | 'NOT_EXECUTED' | 'FAILED' | 'PENDING';

export interface Tuple {
  effect: string;
  resource: string;
  failure?: string;
}

export interface Requirement extends Tuple {
  derivedFrom: string;
  attributes?: Record<string, string[]>;
}

export interface Grant {
  effect: string;
  resource: string;
  constraints?: Record<string, string[]>;
}

export interface Coverage {
  requirement: Requirement;
  covered: boolean;
  grantIndex?: number;
  grant?: Grant;
  failure?: 'no-grant' | 'constraint';
  failedConstraint?: { key: string; allowed: string[]; presented: string[] };
}

export interface TraceStep {
  key: string;
  label: string;
  detail: string;
  status: 'pass' | 'fail' | 'info';
}

export interface Authorization {
  decision: Decision;
  verification: Verification;
  reason: string;
  planId: string;
  planVersion: number;
  planDigest?: string;
  riskTier?: string;
  amendmentUsed?: boolean;
  requirements?: Requirement[];
  coverage?: Coverage[];
  unsatisfied?: Coverage[];
  trace?: TraceStep[];
  required?: Tuple[] | Requirement[];
  uncovered?: Tuple[] | Coverage[];
  durationMs?: number;
}

export interface ExecutionRow {
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
  verification: Verification;
  result: ExecResult;
  planId: string;
  planVersion: number;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  authorizationMs: number;
  output?: unknown;
  error?: string;
  approvalId?: string;
  origin: 'planned' | 'injected' | 'operator';
  originNote?: string;
  seeded?: boolean;
  resumed?: boolean;
  authorization: Authorization;
}

export interface Approval {
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
  unsatisfied: Coverage[];
  reason: string;
  authorization: Authorization;
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
  verification?: Verification;
  execution?: ExecResult;
  humanDecision?: string;
  summary: string;
  chain?: Record<string, string>;
  detail?: Record<string, unknown>;
  executionId?: string;
  approvalId?: string;
  entryDigest: string;
  previousDigest: string | null;
  seeded?: boolean;
}

export interface Agent {
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

export interface PlanView {
  planId: string;
  agentId: string;
  agentName: string;
  intent: string;
  version: number;
  issuedAt: string;
  expiresAt: string;
  grants: Grant[];
  declaredSteps: { tool: string; summary: string }[];
  amendment: {
    reason: string;
    approvalId: string;
    grants: Grant[];
    singleUse: boolean;
    approver: string;
  } | null;
  previousDigest: string | null;
  digest: string;
  digestShort: string;
  signature: string;
  signatureShort: string;
  keyId: string;
  algorithm: string;
  keyCustody: string;
  signatureValid: boolean;
  digestMatches: boolean;
  tampered: boolean;
  revokedAt: string | null;
  expired: boolean;
  status: string;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  status: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  mode: 'live' | 'sandbox' | 'simulated';
  detail: string;
  lastCheckedAt: string;
}

export interface Policy {
  id: string;
  name: string;
  scope: string;
  updatedAt: string;
  version: string;
  statements: {
    disposition: 'ALLOW' | 'APPROVAL' | 'BLOCK';
    title: string;
    description: string;
    tuples: Tuple[];
  }[];
}

export interface RunState {
  runId: string;
  agentId: string;
  planId: string;
  status: 'idle' | 'running' | 'waiting-approval' | 'completed' | 'terminated' | 'failed';
  startedAt: string;
  completedAt?: string;
  currentStep: number;
  totalSteps: number;
  note?: string;
  scenario: string;
}

export interface GraphNode {
  id: string;
  kind: 'intent' | 'plan' | 'action';
  label: string;
  sublabel?: string;
  tool?: string;
  layer: number;
  column: number;
  state: 'idle' | 'running' | 'allowed' | 'held' | 'blocked' | 'approved' | 'skipped';
  authorizationState: string;
  timestamp?: string;
  executionId?: string;
  inPlan: boolean;
  detail?: string;
}

export interface IntentGraph {
  runId: string | null;
  status: string;
  planId: string;
  planVersion: number;
  intent: string;
  nodes: GraphNode[];
  edges: { from: string; to: string; state: 'idle' | 'active' | 'traversed' | 'severed' }[];
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

export interface SandboxSnapshot {
  ledger: {
    id: string;
    invoiceId: string;
    vendor: string;
    amount: number;
    currency: string;
    status: string;
    postedAt: string;
    postedBy: string;
  }[];
  archive: { invoiceId: string; archivedAt: string; archivedBy: string; retention: string }[];
  outbox: {
    id: string;
    to: string;
    subject: string;
    body: string;
    attachments: { artifactId: string; dataClass: string; summary: string }[];
    sentAt: string;
    transport: string;
    authorizedBy: { planId: string; planVersion: number; approvalId?: string };
  }[];
  invoices: SourceDocument[];
}

export interface SourceDocument {
  id: string;
  vendorName: string;
  vendorTaxId: string;
  amount: number;
  currency: string;
  issuedAt: string;
  dueAt: string;
  poNumber: string;
  bankAccount: string;
  lineItems: { description: string; qty: number; unitPrice: number }[];
  notes: string;
}

export interface ToolInfo {
  id: string;
  title: string;
  surface: string;
  riskTier: string;
  testMode: boolean;
  description: string;
}

export interface Bootstrap {
  meta: {
    product: string;
    tagline: string;
    environment: string;
    dataNotice: string;
    signing: { keyId: string; algorithm: string; custody: string };
    serverTime: string;
  };
  kpis: Kpis;
  agents: Agent[];
  integrations: Integration[];
  policies: Policy[];
  plans: PlanView[];
  tools: ToolInfo[];
  capabilities: {
    effects: {
      id: string;
      label: string;
      implies: string[];
      reversible: boolean;
      unsatisfiedDisposition: 'hold' | 'block';
      rationale: string;
    }[];
    resources: { id: string; description: string }[];
  };
  run: RunState | null;
  running: boolean;
  audit: { intact: boolean; length: number; head: string | null };
  sandbox: SandboxSnapshot;
  sourceDocument: SourceDocument | null;
}

export type ProviderId = 'armoriq' | 'google';

export interface CredentialStatus {
  id: ProviderId;
  label: string;
  purpose: string;
  docsUrl: string;
  envVars: string[];
  configured: boolean;
  source: 'env' | 'console' | null;
  hint: string | null;
  updatedAt: string | null;
  lockedByEnv: boolean;
}

export interface SdkCheck {
  name: string;
  scope: 'local' | 'cloud';
  provider?: ProviderId | null;
  status: 'PASS' | 'FAIL' | 'NOT_CONFIGURED';
  detail: string;
  durationMs: number;
  evidence?: unknown;
}

export interface SdkReport {
  ok: boolean;
  detected: boolean;
  sdkVersion: string | null;
  packageName: string;
  checkedAt: string;
  interpreter: { executable: string; python: string; platform: string } | null;
  summary: {
    localPassed: number;
    localTotal: number;
    cloudConfigured: boolean;
    providers?: Record<ProviderId, 'PASS' | 'FAIL' | 'NOT_CONFIGURED'>;
  };
  checks: SdkCheck[];
  error?: string;
  hint?: string;
}
