/**
 * ArmorIQ invoke() - the only path from an agent to a tool.
 *
 * The agent runtime never holds a tool handle. It hands the gateway an action
 * and its arguments; the gateway authorizes against the signed plan and only
 * then touches the tool surface. A held action never reaches the surface, which
 * is why the sandbox outbox stays empty until a human approves.
 */
import { authorize } from './engine.js';
import { amendPlan, consumeAmendment, requirePlan } from './plan.js';
import type { Grant } from './capabilities.js';
import { requireTool } from '../tools/registry.js';
import type { ToolContext } from '../tools/registry.js';
import {
  appendAudit,
  db,
  emit,
  nextApprovalId,
  nextExecutionId,
  recordExecution,
  summariseAuthorization,
  updateAgent,
  updateExecution,
  upsertApproval,
} from '../store/state.js';
import type {
  ApprovalRequest,
  AuthorizationDecision,
  ExecutionRecord,
} from '../types.js';

export interface InvokeInput {
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
  origin: 'planned' | 'injected' | 'operator';
  originNote?: string;
  /** Human-facing label for the approval card, e.g. "External data transfer". */
  approvalTitle?: string;
}

export interface InvokeOutcome {
  execution: ExecutionRecord;
  authorization: AuthorizationDecision;
  approval?: ApprovalRequest;
  /** Resolves when a human decides on a held action. */
  resolution?: Promise<ApprovalOutcome>;
}

export interface ApprovalOutcome {
  status: 'APPROVED' | 'REJECTED' | 'EXPIRED';
  execution: ExecutionRecord;
  authorization?: AuthorizationDecision;
}

interface PendingHold {
  approval: ApprovalRequest;
  input: InvokeInput;
  executionId: string;
  settle: (outcome: ApprovalOutcome) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingHold>();

const HOLD_TIMEOUT_MS = 15 * 60_000;

export function pendingHoldCount(): number {
  return pending.size;
}

/** ArmorIQ SDK surface: invoke(). */
export async function invoke(input: InvokeInput): Promise<InvokeOutcome> {
  const agent = db.agents.find((a) => a.id === input.agentId);
  if (!agent) throw new Error(`Unknown agent ${input.agentId}`);
  if (!agent.planId) throw new Error(`Agent ${agent.id} has no captured plan`);

  const descriptor = requireTool(input.tool);
  const plan = requirePlan(agent.planId);
  const ctx: ToolContext = {
    ...input.ctx,
    planId: plan.document.planId,
    planVersion: plan.document.version,
  };

  const requirements = descriptor.requirements(input.args, ctx);
  const authorization = authorize({
    plan,
    agentId: agent.id,
    tool: input.tool,
    requirements,
    riskTier: descriptor.riskTier,
  });

  const startedAt = new Date();
  const execution: ExecutionRecord = {
    id: nextExecutionId(),
    runId: ctx.runId,
    stepIndex: db.executions.filter((e) => e.runId === ctx.runId).length,
    agentId: agent.id,
    agentName: agent.name,
    tool: input.tool,
    title: descriptor.title,
    resource: descriptor.resource(input.args, ctx),
    surface: descriptor.surface,
    args: input.args,
    decision: authorization.decision,
    verification: authorization.verification,
    result: authorization.decision === 'ALLOWED' ? 'PENDING' : 'NOT_EXECUTED',
    planId: plan.document.planId,
    planVersion: plan.document.version,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    authorizationMs: Number(authorization.durationMs.toFixed(3)),
    authorization,
    origin: input.origin,
    originNote: input.originNote,
  };
  recordExecution(execution);

  updateAgent(agent.id, {
    actionsToday: agent.actionsToday + 1,
    heldToday: agent.heldToday + (authorization.decision === 'HELD' ? 1 : 0),
    blockedToday: agent.blockedToday + (authorization.decision === 'BLOCKED' ? 1 : 0),
    lastExecutionAt: execution.startedAt,
    status: authorization.decision === 'HELD' ? 'HOLDING' : agent.status,
  });

  writeAudit(execution, authorization, authorization.decision === 'HELD' ? 'Pending' : 'Not required');

  if (authorization.decision === 'ALLOWED') {
    const finished = await runTool(execution, input, ctx);
    return { execution: finished, authorization };
  }

  if (authorization.decision === 'BLOCKED') {
    appendAudit({
      at: new Date().toISOString(),
      category: 'execution',
      agentId: agent.id,
      agentName: agent.name,
      tool: input.tool,
      planId: plan.document.planId,
      decision: 'BLOCKED',
      verification: authorization.verification,
      execution: 'NOT_EXECUTED',
      summary: `${input.tool} blocked before execution - not forwarded to ${descriptor.surface}`,
      executionId: execution.id,
      detail: summariseAuthorization(authorization),
    });
    return { execution, authorization };
  }

  // HELD - park the call and wait for a human.
  const approval = createApproval(execution, authorization, input, descriptor.title);
  let settle!: (outcome: ApprovalOutcome) => void;
  const resolution = new Promise<ApprovalOutcome>((resolve) => {
    settle = resolve;
  });

  const timer = setTimeout(() => expire(approval.id), HOLD_TIMEOUT_MS);
  timer.unref?.();
  pending.set(approval.id, {
    approval,
    input: { ...input, ctx },
    executionId: execution.id,
    settle,
    timer,
  });

  return { execution, authorization, approval, resolution };
}

function createApproval(
  execution: ExecutionRecord,
  authorization: AuthorizationDecision,
  input: InvokeInput,
  toolTitle: string,
): ApprovalRequest {
  const target =
    (input.args.to as string | undefined) ??
    (input.args.principal as string | undefined) ??
    execution.resource;

  const approval: ApprovalRequest = {
    id: nextApprovalId(),
    executionId: execution.id,
    runId: execution.runId,
    agentId: execution.agentId,
    agentName: execution.agentName,
    tool: execution.tool,
    title: input.approvalTitle ?? toolTitle,
    target,
    planId: execution.planId,
    requestedAt: new Date().toISOString(),
    status: 'PENDING',
    unsatisfied: authorization.unsatisfied,
    reason: authorization.reason,
    authorization,
    contextPreview: {
      action: execution.tool,
      resource: execution.resource,
      origin: input.origin,
      originNote: input.originNote,
      arguments: input.args,
      dataClasses: authorization.requirements.map((r) => r.resource),
    },
  };
  upsertApproval(approval);
  updateExecution(execution.id, { approvalId: approval.id });

  appendAudit({
    at: approval.requestedAt,
    category: 'approval',
    agentId: execution.agentId,
    agentName: execution.agentName,
    tool: execution.tool,
    planId: execution.planId,
    decision: 'HELD',
    verification: authorization.verification,
    execution: 'NOT_EXECUTED',
    humanDecision: 'Requested',
    summary: `Human approval requested for ${execution.tool} -> ${target}`,
    executionId: execution.id,
    approvalId: approval.id,
    detail: summariseAuthorization(authorization),
  });

  return approval;
}

/**
 * A human decision does not bypass the engine. Approval mints a narrowly scoped,
 * single-use grant for exactly the tuples that were uncovered, appends it to the
 * plan, re-signs, and the action is authorized again from scratch.
 */
export async function decideApproval(
  approvalId: string,
  verdict: 'APPROVE' | 'REJECT',
  approver: string,
): Promise<ApprovalOutcome> {
  const held = pending.get(approvalId);
  const stored = db.approvals.find((a) => a.id === approvalId);
  if (!stored) throw new Error(`Unknown approval ${approvalId}`);
  if (!held) {
    // Seeded or already-resolved approvals are decided in place.
    const execution = db.executions.find((e) => e.id === stored.executionId)!;
    upsertApproval({
      ...stored,
      status: verdict === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      resolvedAt: new Date().toISOString(),
      decidedBy: approver,
    });
    return { status: verdict === 'APPROVE' ? 'APPROVED' : 'REJECTED', execution };
  }

  clearTimeout(held.timer);
  pending.delete(approvalId);
  const execution = db.executions.find((e) => e.id === held.executionId)!;

  if (verdict === 'REJECT') {
    const resolved: ApprovalRequest = {
      ...stored,
      status: 'REJECTED',
      resolvedAt: new Date().toISOString(),
      decidedBy: approver,
    };
    upsertApproval(resolved);
    const updated =
      updateExecution(execution.id, { result: 'NOT_EXECUTED', completedAt: resolved.resolvedAt }) ??
      execution;
    appendAudit({
      at: resolved.resolvedAt!,
      category: 'approval',
      agentId: execution.agentId,
      agentName: execution.agentName,
      tool: execution.tool,
      planId: execution.planId,
      decision: 'HELD',
      verification: execution.verification,
      execution: 'NOT_EXECUTED',
      humanDecision: `Rejected by ${approver}`,
      summary: `${execution.tool} rejected by ${approver} - execution terminated safely`,
      executionId: execution.id,
      approvalId,
      detail: { plan: execution.planId, target: stored.target },
    });
    restoreAgentStatus(execution.agentId);
    const outcome: ApprovalOutcome = { status: 'REJECTED', execution: updated };
    held.settle(outcome);
    return outcome;
  }

  // APPROVE - mint exactly the grants that were missing, nothing wider.
  const grants: Grant[] = stored.unsatisfied.map((c) => ({
    effect: c.requirement.effect,
    resource: c.requirement.resource,
    constraints: c.requirement.attributes
      ? Object.fromEntries(
          Object.entries(c.requirement.attributes).map(([key, values]) => [key, [...values]]),
        )
      : undefined,
  }));

  const amended = amendPlan(execution.planId, {
    grants,
    reason: `Single-use exception approved for ${execution.tool}`,
    approvalId,
    approver,
    singleUse: true,
  });
  emit({ type: 'plan', planId: amended.document.planId });

  const resolvedAt = new Date().toISOString();
  const resolved: ApprovalRequest = {
    ...stored,
    status: 'APPROVED',
    resolvedAt,
    decidedBy: approver,
  };
  upsertApproval(resolved);

  appendAudit({
    at: resolvedAt,
    category: 'plan',
    agentId: execution.agentId,
    agentName: execution.agentName,
    tool: execution.tool,
    planId: execution.planId,
    humanDecision: `Approved once by ${approver}`,
    summary: `${execution.planId} amended to v${amended.document.version}: single-use grant ${grants
      .map((g) => `${g.effect} : ${g.resource}`)
      .join(', ')}`,
    executionId: execution.id,
    approvalId,
    detail: {
      grants,
      previousDigest: amended.document.previousDigest,
      digest: amended.digest,
      singleUse: true,
    },
  });

  // Re-enter the same authorization path under the amended plan.
  const ctx: ToolContext = {
    ...held.input.ctx,
    planId: amended.document.planId,
    planVersion: amended.document.version,
    approvalId,
  };
  const descriptor = requireTool(held.input.tool);
  const reAuthorization = authorize({
    plan: amended,
    agentId: execution.agentId,
    tool: held.input.tool,
    requirements: descriptor.requirements(held.input.args, ctx),
    riskTier: descriptor.riskTier,
  });

  updateExecution(execution.id, {
    resumeAuthorization: reAuthorization,
    resumedAt: resolvedAt,
    planVersion: amended.document.version,
    verification: reAuthorization.verification,
    result: reAuthorization.decision === 'ALLOWED' ? 'PENDING' : 'NOT_EXECUTED',
  });

  let finalExecution = db.executions.find((e) => e.id === execution.id)!;
  if (reAuthorization.decision === 'ALLOWED') {
    finalExecution = await runTool(finalExecution, { ...held.input, ctx }, ctx, {
      approvalId,
      resumed: true,
    });
  }

  const spent = consumeAmendment(execution.planId);
  if (spent) {
    emit({ type: 'plan', planId: spent.document.planId });
    appendAudit({
      at: new Date().toISOString(),
      category: 'plan',
      agentId: execution.agentId,
      agentName: execution.agentName,
      planId: execution.planId,
      summary: `Single-use grant consumed. ${execution.planId} re-signed at v${spent.document.version} without the exception.`,
      executionId: execution.id,
      approvalId,
      detail: { digest: spent.digest, grants: spent.document.grants.length },
    });
  }

  restoreAgentStatus(execution.agentId);
  const outcome: ApprovalOutcome = {
    status: 'APPROVED',
    execution: finalExecution,
    authorization: reAuthorization,
  };
  held.settle(outcome);
  return outcome;
}

function expire(approvalId: string): void {
  const held = pending.get(approvalId);
  if (!held) return;
  pending.delete(approvalId);
  const stored = db.approvals.find((a) => a.id === approvalId);
  const execution = db.executions.find((e) => e.id === held.executionId)!;
  if (stored) {
    upsertApproval({ ...stored, status: 'EXPIRED', resolvedAt: new Date().toISOString() });
  }
  appendAudit({
    at: new Date().toISOString(),
    category: 'approval',
    agentId: execution.agentId,
    agentName: execution.agentName,
    tool: execution.tool,
    planId: execution.planId,
    decision: 'HELD',
    execution: 'NOT_EXECUTED',
    humanDecision: 'Expired',
    summary: `Approval window elapsed for ${execution.tool} - action discarded, never executed`,
    executionId: execution.id,
    approvalId,
  });
  restoreAgentStatus(execution.agentId);
  held.settle({ status: 'EXPIRED', execution });
}

async function runTool(
  execution: ExecutionRecord,
  input: InvokeInput,
  ctx: ToolContext,
  options: { approvalId?: string; resumed?: boolean } = {},
): Promise<ExecutionRecord> {
  const descriptor = requireTool(input.tool);
  const started = Date.now();
  try {
    const result = await descriptor.execute(input.args, ctx);
    const completedAt = new Date().toISOString();
    const updated =
      updateExecution(execution.id, {
        result: 'SUCCESS',
        output: result.output,
        completedAt,
        durationMs: Date.now() - started,
        approvalId: options.approvalId ?? execution.approvalId,
      }) ?? execution;

    appendAudit({
      at: completedAt,
      category: 'execution',
      agentId: execution.agentId,
      agentName: execution.agentName,
      tool: execution.tool,
      planId: execution.planId,
      decision: options.resumed ? 'HELD' : 'ALLOWED',
      verification: 'VERIFIED',
      execution: 'SUCCESS',
      humanDecision: options.resumed ? 'Approved once' : 'Not required',
      summary: options.resumed
        ? `${execution.tool} executed on ${descriptor.surface} after human approval`
        : `${execution.tool} executed on ${descriptor.surface}`,
      executionId: execution.id,
      approvalId: options.approvalId,
      detail: { output: result.output, durationMs: Date.now() - started },
    });

    if (result.plannerDirectives?.length) {
      appendAudit({
        at: completedAt,
        category: 'system',
        agentId: execution.agentId,
        agentName: execution.agentName,
        tool: execution.tool,
        planId: execution.planId,
        summary: `Untrusted instruction detected in tool output (${result.plannerDirectives[0].source}). Recorded as content, never as authority.`,
        executionId: execution.id,
        detail: { directives: result.plannerDirectives },
      });
    }

    return updated;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    const updated =
      updateExecution(execution.id, {
        result: 'FAILED',
        error: message,
        completedAt,
        durationMs: Date.now() - started,
      }) ?? execution;
    appendAudit({
      at: completedAt,
      category: 'execution',
      agentId: execution.agentId,
      agentName: execution.agentName,
      tool: execution.tool,
      planId: execution.planId,
      decision: 'ALLOWED',
      execution: 'FAILED',
      summary: `${execution.tool} failed on ${descriptor.surface}: ${message}`,
      executionId: execution.id,
    });
    return updated;
  }
}

function writeAudit(
  execution: ExecutionRecord,
  authorization: AuthorizationDecision,
  humanDecision: string,
): void {
  const agent = db.agents.find((a) => a.id === execution.agentId);
  appendAudit({
    at: execution.startedAt,
    category: 'authorization',
    agentId: execution.agentId,
    agentName: execution.agentName,
    tool: execution.tool,
    planId: execution.planId,
    decision: authorization.decision,
    verification: authorization.verification,
    execution: authorization.decision === 'ALLOWED' ? 'PENDING' : 'NOT_EXECUTED',
    humanDecision,
    summary: `${execution.tool} ${authorization.decision.toLowerCase()} - ${authorization.reason}`,
    executionId: execution.id,
    chain: {
      userIntent: agent?.intent ?? '',
      declaredPlan: execution.planId,
      agent: `${execution.agentName} (${execution.agentId})`,
      requestedAction: `${execution.tool} -> ${execution.resource}`,
      verification: authorization.verification,
      decision: authorization.decision,
      executionResult: authorization.decision === 'ALLOWED' ? 'FORWARDED' : 'NOT FORWARDED',
      humanDecision,
    },
    detail: summariseAuthorization(authorization),
  });
}

function restoreAgentStatus(agentId: string): void {
  const agent = db.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const stillHolding = [...pending.values()].some((p) => p.approval.agentId === agentId);
  if (!stillHolding && agent.status === 'HOLDING') {
    updateAgent(agentId, { status: 'ACTIVE' });
  }
}
