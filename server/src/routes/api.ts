import { Router } from 'express';
import { decideApproval } from '../armoriq/gateway.js';
import {
  getPlan,
  listPlans,
  restorePlan,
  revokePlan,
  tamperPlan,
  untamperPlan,
  verifyPlan,
} from '../armoriq/plan.js';
import { EFFECTS, RESOURCE_CLASSES } from '../armoriq/capabilities.js';
import { ALGORITHM, KEY_CUSTODY, KEY_ID, fingerprint } from '../armoriq/signing.js';
import {
  probeAction,
  startInvoiceRun,
  startRefundRun,
  startRun,
  isRunning,
  releaseRun,
} from '../agent/runner.js';
import { listTools, toolCatalogue } from '../tools/registry.js';
import { snapshot as sandboxSnapshot, resetSandbox, getInvoice } from '../tools/sandbox.js';
import { buildGraph } from '../store/graph.js';
import { invalidateSdkCache, runSdkSelfTest, sdkStatus } from '../armoriq/sdk.js';
import {
  clearCredential,
  credentialStatus,
  setCredential,
  type ProviderId,
} from '../store/credentials.js';
import {
  auditChainIntact,
  db,
  kpis,
  latestRun,
  subscribe,
  updateAgent,
  type StreamEvent,
} from '../store/state.js';
import { bootstrapControlPlane } from '../store/bootstrap.js';
import { DEMO_INVOICE_ID } from '../store/seed.js';
import type { ExecutionRecord } from '../types.js';

export const api = Router();

/** Table/stream projection: drops the decision trace, keeps the decision facts. */
function lite(execution: ExecutionRecord) {
  const { authorization, resumeAuthorization, ...rest } = execution;
  return {
    ...rest,
    authorization: {
      decision: authorization.decision,
      verification: authorization.verification,
      reason: authorization.reason,
      planId: authorization.planId,
      planVersion: authorization.planVersion,
      riskTier: authorization.riskTier,
      amendmentUsed: authorization.amendmentUsed,
      required: authorization.requirements.map((r) => ({
        effect: r.effect,
        resource: r.resource,
      })),
      uncovered: authorization.unsatisfied.map((c) => ({
        effect: c.requirement.effect,
        resource: c.requirement.resource,
        failure: c.failure,
      })),
    },
    resumed: Boolean(resumeAuthorization),
  };
}

function planView(planId: string) {
  const plan = getPlan(planId);
  if (!plan) return null;
  const integrity = verifyPlan(plan);
  return {
    planId: plan.document.planId,
    agentId: plan.document.agentId,
    agentName: db.agents.find((a) => a.id === plan.document.agentId)?.name ?? plan.document.agentId,
    intent: plan.document.intent,
    version: plan.document.version,
    issuedAt: plan.document.issuedAt,
    expiresAt: plan.document.expiresAt,
    grants: plan.document.grants,
    declaredSteps: plan.document.declaredSteps,
    amendment: plan.document.amendment ?? null,
    previousDigest: plan.document.previousDigest,
    digest: plan.digest,
    digestShort: fingerprint(plan.digest),
    signature: plan.signature,
    signatureShort: fingerprint(plan.signature),
    keyId: plan.keyId,
    algorithm: plan.algorithm,
    keyCustody: KEY_CUSTODY,
    signatureValid: integrity.signatureValid,
    digestMatches: integrity.digestMatches,
    tampered: Boolean(plan.tampered),
    revokedAt: plan.revokedAt ?? null,
    expired: new Date(plan.document.expiresAt).getTime() <= Date.now(),
    status: plan.revokedAt
      ? 'REVOKED'
      : !integrity.signatureValid || !integrity.digestMatches
        ? 'INTEGRITY FAILED'
        : new Date(plan.document.expiresAt).getTime() <= Date.now()
          ? 'EXPIRED'
          : 'VERIFIED',
  };
}

api.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

api.get('/bootstrap', (_req, res) => {
  const run = latestRun();
  res.json({
    meta: {
      product: 'SENTINEL',
      tagline: 'Autonomous Operations Control Plane',
      environment: 'Demo',
      dataNotice:
        'Historical rows are generated demo data evaluated by the live authorization engine. ' +
        'Runs, probes and approvals in this session are real: they execute against sandbox tool surfaces.',
      signing: { keyId: KEY_ID, algorithm: ALGORITHM, custody: KEY_CUSTODY },
      serverTime: new Date().toISOString(),
    },
    kpis: kpis(),
    agents: db.agents,
    integrations: db.integrations,
    policies: db.policies,
    plans: listPlans().map((p) => planView(p.document.planId)),
    tools: toolCatalogue(),
    capabilities: {
      effects: Object.entries(EFFECTS).map(([id, meta]) => ({ id, ...meta })),
      resources: Object.entries(RESOURCE_CLASSES).map(([id, description]) => ({ id, description })),
    },
    run: run ?? null,
    running: isRunning(),
    audit: auditChainIntact(),
    sandbox: sandboxSnapshot(),
    sourceDocument: getInvoice(DEMO_INVOICE_ID) ?? null,
  });
});

api.get('/kpis', (_req, res) => res.json(kpis()));

api.get('/agents', (_req, res) => res.json(db.agents));

api.get('/agents/:id', (req, res) => {
  const agent = db.agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Unknown agent' });
  const executions = db.executions
    .filter((e) => e.agentId === agent.id)
    .slice(-40)
    .reverse()
    .map(lite);
  return res.json({
    agent,
    plan: agent.planId ? planView(agent.planId) : null,
    executions,
    tools: listTools()
      .filter((t) => agent.tools.includes(t.id))
      .map(({ id, title, surface, riskTier, testMode, description }) => ({
        id,
        title,
        surface,
        riskTier,
        testMode,
        description,
      })),
    restricted: listTools()
      .filter((t) => agent.restricted.includes(t.id))
      .map(({ id, title, riskTier, description }) => ({ id, title, riskTier, description })),
    run: latestRun()?.agentId === agent.id ? latestRun() : null,
  });
});

api.post('/agents/:id/status', (req, res) => {
  const { status } = req.body as { status: 'ACTIVE' | 'PAUSED' | 'REVOKED' };
  const agent = db.agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Unknown agent' });
  if (status === 'REVOKED' && agent.planId) revokePlan(agent.planId);
  if (status === 'ACTIVE' && agent.planId) restorePlan(agent.planId);
  const updated = updateAgent(agent.id, { status });
  return res.json(updated);
});

api.get('/executions', (req, res) => {
  const filter = String(req.query.filter ?? 'all').toLowerCase();
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  let rows = [...db.executions].reverse();
  if (filter === 'allowed') rows = rows.filter((e) => e.decision === 'ALLOWED');
  else if (filter === 'held') rows = rows.filter((e) => e.decision === 'HELD');
  else if (filter === 'blocked') rows = rows.filter((e) => e.decision === 'BLOCKED');
  else if (filter === 'failed') rows = rows.filter((e) => e.result === 'FAILED');
  res.json({ total: db.executions.length, rows: rows.slice(0, limit).map(lite) });
});

api.get('/executions/:id', (req, res) => {
  const execution = db.executions.find((e) => e.id === req.params.id);
  if (!execution) return res.status(404).json({ error: 'Unknown execution' });
  return res.json(execution);
});

api.get('/approvals', (_req, res) => {
  res.json(
    [...db.approvals].reverse().map((a) => ({
      ...a,
      authorization: {
        decision: a.authorization.decision,
        verification: a.authorization.verification,
        reason: a.authorization.reason,
        trace: a.authorization.trace,
        planId: a.authorization.planId,
        planVersion: a.authorization.planVersion,
        required: a.authorization.requirements,
        uncovered: a.authorization.unsatisfied,
      },
    })),
  );
});

api.post('/approvals/:id/decide', async (req, res) => {
  const { verdict, approver } = req.body as { verdict: 'APPROVE' | 'REJECT'; approver?: string };
  if (verdict !== 'APPROVE' && verdict !== 'REJECT') {
    return res.status(400).json({ error: 'verdict must be APPROVE or REJECT' });
  }
  try {
    const outcome = await decideApproval(
      req.params.id,
      verdict,
      approver ?? 'operator@acme-internal.example',
    );
    return res.json({
      status: outcome.status,
      execution: lite(outcome.execution),
      authorization: outcome.authorization ?? null,
      sandbox: sandboxSnapshot(),
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.get('/plans', (_req, res) => res.json(listPlans().map((p) => planView(p.document.planId))));

api.get('/plans/:id', (req, res) => {
  const view = planView(req.params.id);
  if (!view) return res.status(404).json({ error: 'Unknown plan' });
  return res.json(view);
});

api.post('/plans/:id/integrity', (req, res) => {
  const { action } = req.body as { action: 'tamper' | 'restore' };
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Unknown plan' });
  if (action === 'tamper') tamperPlan(req.params.id);
  else untamperPlan(req.params.id);
  return res.json(planView(req.params.id));
});

api.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 120), 500);
  const category = req.query.category ? String(req.query.category) : null;
  let rows = [...db.audit].reverse();
  if (category && category !== 'all') rows = rows.filter((e) => e.category === category);
  res.json({ chain: auditChainIntact(), total: db.audit.length, rows: rows.slice(0, limit) });
});

api.get('/audit/:id', (req, res) => {
  const event = db.audit.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Unknown audit event' });
  const execution = event.executionId
    ? db.executions.find((e) => e.id === event.executionId)
    : undefined;
  return res.json({ event, execution: execution ?? null });
});

api.get('/graph', (_req, res) => res.json(buildGraph()));

api.get('/sandbox', (_req, res) => res.json(sandboxSnapshot()));

/**
 * Optional third-party credentials. Responses carry a masked hint only - the
 * secret itself never leaves the gateway.
 */
api.get('/credentials', (_req, res) => res.json(credentialStatus()));

api.post('/credentials', (req, res) => {
  const { provider, apiKey } = req.body as { provider?: ProviderId; apiKey?: string };
  if (!provider || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'provider and apiKey are required' });
  }
  try {
    const status = setCredential(provider, apiKey);
    invalidateSdkCache();
    return res.json(status);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.delete('/credentials/:provider', (req, res) => {
  try {
    const status = clearCredential(req.params.provider as ProviderId);
    invalidateSdkCache();
    return res.json(status);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Whether the real ArmorIQ Python SDK is installed and what it can do here. */
api.get('/sdk', async (_req, res) => res.json(await sdkStatus()));

/** Re-runs the SDK self-test on demand from the console. */
api.post('/sdk/selftest', async (_req, res) => res.json(await runSdkSelfTest()));

api.get('/run', (_req, res) => res.json({ run: latestRun() ?? null, running: isRunning() }));

api.post('/demo/run', (req, res) => {
  const { stepDelayMs, scenario } = req.body as { stepDelayMs?: number; scenario?: 'refund' | 'invoice' };
  try {
    const handle = startRun(scenario ?? 'refund', { stepDelayMs });
    return res.json(handle);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.post('/demo/refund/run', (req, res) => {
  const { stepDelayMs } = req.body as { stepDelayMs?: number };
  try {
    const handle = startRefundRun({ stepDelayMs });
    return res.json(handle);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.post('/demo/invoice/run', (req, res) => {
  const { stepDelayMs } = req.body as { stepDelayMs?: number };
  try {
    const handle = startInvoiceRun({ stepDelayMs });
    return res.json(handle);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.post('/demo/reset', (_req, res) => {
  releaseRun();
  resetSandbox();
  bootstrapControlPlane();
  res.json({ ok: true, kpis: kpis() });
});

api.post('/probe', async (req, res) => {
  const { tool, to, attach, agentId, amount, orderId, customerId, invoiceId } = req.body as {
    tool: string;
    to?: string;
    attach?: 'extracted' | 'status' | 'none';
    agentId?: string;
    amount?: number;
    orderId?: string;
    customerId?: string;
    invoiceId?: string;
  };
  try {
    const outcome = await probeAction({ tool, to, attach, agentId, amount, orderId, customerId, invoiceId });
    return res.json({
      execution: lite(outcome.execution),
      authorization: outcome.authorization,
      approvalId: outcome.approval?.id ?? null,
      sandbox: sandboxSnapshot(),
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

api.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\n\n`);

  const send = (event: StreamEvent) => {
    const payload =
      event.type === 'execution' ? { type: 'execution', execution: lite(event.execution) } : event;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'reset' });
  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});
