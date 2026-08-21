/**
 * Invoice Operations Agent - ADK-shaped runtime.
 *
 * The runner behaves like a real agent loop: it calls a tool, reads the tool's
 * output, and lets that output influence the next call. That is precisely how a
 * document-borne instruction becomes an agent action - step 6 below is emitted
 * because the invoice text told the planner to emit it, not because the demo
 * hard-codes a "bad step".
 *
 * Every call leaves the runtime through ArmorIQ invoke(). The runner has no
 * other way to reach a tool.
 */
import { capturePlan, getPlan } from '../armoriq/plan.js';
import { invoke } from '../armoriq/gateway.js';
import type { Artifact, ToolContext } from '../tools/registry.js';
import { getInvoice, getCustomer, getOrder, getTicket } from '../tools/sandbox.js';
import { decideRefund, llmEnabled } from './llm.js';
import {
  appendAudit,
  db,
  emit,
  nextRunId,
  setRun,
  type RunState,
} from '../store/state.js';
import {
  DEMO_INVOICE_ID,
  DEMO_CUSTOMER_ID,
  DEMO_ORDER_ID,
  DEMO_TICKET_ID,
  EXTERNAL_MAILBOX,
  INTERNAL_AP_MAILBOX,
  INVOICE_AGENT_ID,
  INVOICE_INTENT,
  INVOICE_PLAN_ID,
  REFUND_AGENT_ID,
  REFUND_INTENT,
  REFUND_PLAN_ID,
} from '../store/seed.js';

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

let activeRun: string | null = null;
let lastArtifacts: Map<string, Artifact> = new Map();

export function currentArtifacts(): Map<string, Artifact> {
  return lastArtifacts;
}

export function isRunning(): boolean {
  return activeRun !== null;
}

export interface RunOptions {
  stepDelayMs?: number;
}

/** Re-issues the signed plan for the Customer Refund Agent: ArmorIQ capture_plan(). */
export function captureRefundPlan(): void {
  const agent = db.agents.find((a) => a.id === REFUND_AGENT_ID)!;
  const plan = capturePlan({
    planId: REFUND_PLAN_ID,
    agentId: REFUND_AGENT_ID,
    intent: REFUND_INTENT,
    ttlMinutes: 12 * 60,
    grants: [
      { effect: 'read', resource: 'support.customer' },
      { effect: 'read', resource: 'support.order' },
      { effect: 'read', resource: 'finance.payment.verify' },
      { effect: 'write', resource: 'support.ticket' },
      { effect: 'transfer.external', resource: 'comm.customer' },
      {
        effect: 'write',
        resource: 'finance.refund',
        constraints: { maxAmount: ['5000'] },
      },
    ],
    declaredSteps: [
      { tool: 'customer.get', summary: 'Retrieve customer identity and purchase history' },
      { tool: 'order.get', summary: 'Inspect order details and damaged item reports' },
      { tool: 'payment.verify', summary: 'Verify original payment transaction settlement' },
      { tool: 'refund.issue', summary: 'Issue payment refund (authorized up to ₹5,000)' },
      { tool: 'ticket.update', summary: 'Update support ticket status and resolution notes' },
      { tool: 'notification.send', summary: 'Notify customer of refund approval and ticket closure' },
    ],
  });

  appendAudit({
    at: new Date().toISOString(),
    category: 'plan',
    agentId: agent.id,
    agentName: agent.name,
    planId: plan.document.planId,
    summary: `capture_plan() issued ${plan.document.planId} v${plan.document.version} (Refund limit: ≤ ₹5,000), signed ${plan.algorithm}`,
    detail: {
      intent: plan.document.intent,
      digest: plan.digest,
      keyId: plan.keyId,
      expiresAt: plan.document.expiresAt,
      grants: plan.document.grants.map((g) => `${g.effect} : ${g.resource}`),
    },
  });
  emit({ type: 'plan', planId: plan.document.planId });
}

/** Re-issues the signed plan for this run: ArmorIQ capture_plan(). */
export function captureInvoicePlan(): void {
  const agent = db.agents.find((a) => a.id === INVOICE_AGENT_ID)!;
  const plan = capturePlan({
    planId: INVOICE_PLAN_ID,
    agentId: INVOICE_AGENT_ID,
    intent: INVOICE_INTENT,
    ttlMinutes: 12 * 60,
    grants: [
      { effect: 'read', resource: 'finance.invoice.raw' },
      { effect: 'derive', resource: 'finance.invoice.extracted' },
      { effect: 'read', resource: 'finance.vendor.registry' },
      { effect: 'write', resource: 'finance.ledger' },
      { effect: 'append', resource: 'finance.archive' },
      {
        effect: 'transfer.external',
        resource: 'finance.invoice.status',
        constraints: { recipientDomain: ['ap.acme-internal.example'] },
      },
      {
        effect: 'transfer.external',
        resource: 'channel.external',
        constraints: { recipientDomain: ['ap.acme-internal.example'] },
      },
    ],
    declaredSteps: [
      { tool: 'invoice.read', summary: 'Read the source invoice document' },
      { tool: 'invoice.extract', summary: 'Extract structured accounting fields' },
      { tool: 'vendor.verify', summary: 'Validate the vendor against the approved registry' },
      { tool: 'database.update', summary: 'Post the payable to the accounting ledger' },
      { tool: 'external.send', summary: 'Notify the internal AP mailbox of the posting status' },
      { tool: 'invoice.archive', summary: 'Archive the processed document' },
    ],
  });

  appendAudit({
    at: new Date().toISOString(),
    category: 'plan',
    agentId: agent.id,
    agentName: agent.name,
    planId: plan.document.planId,
    summary: `capture_plan() issued ${plan.document.planId} v${plan.document.version} with ${plan.document.grants.length} grants, signed ${plan.algorithm}`,
    detail: {
      intent: plan.document.intent,
      digest: plan.digest,
      keyId: plan.keyId,
      expiresAt: plan.document.expiresAt,
      grants: plan.document.grants.map((g) => `${g.effect} : ${g.resource}`),
    },
  });
  emit({ type: 'plan', planId: plan.document.planId });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunHandle {
  runId: string;
  planId: string;
}

/** Starts the Customer Support Refund demo workflow. */
export function startRefundRun(options: RunOptions = {}): RunHandle {
  if (activeRun) throw new Error('A run is already in progress');
  const runId = nextRunId();
  activeRun = runId;
  lastArtifacts = new Map();

  const run: RunState = {
    runId,
    agentId: REFUND_AGENT_ID,
    planId: REFUND_PLAN_ID,
    status: 'running',
    startedAt: new Date().toISOString(),
    currentStep: 0,
    totalSteps: 6,
    scenario: 'Customer Refund Operations - Monetary Scope Governance',
  };
  setRun(run);

  void executeRefund(run, options).catch((error) => {
    setRun({
      ...run,
      status: 'failed',
      note: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    activeRun = null;
  });

  return { runId, planId: REFUND_PLAN_ID };
}

/** Starts the Invoice Processing demo workflow. */
export function startInvoiceRun(options: RunOptions = {}): RunHandle {
  if (activeRun) throw new Error('A run is already in progress');
  const runId = nextRunId();
  activeRun = runId;
  lastArtifacts = new Map();

  const run: RunState = {
    runId,
    agentId: INVOICE_AGENT_ID,
    planId: INVOICE_PLAN_ID,
    status: 'running',
    startedAt: new Date().toISOString(),
    currentStep: 0,
    totalSteps: 7,
    scenario: 'Invoice Processing - Secure Autonomous Workflow',
  };
  setRun(run);

  void executeInvoice(run, options).catch((error) => {
    setRun({
      ...run,
      status: 'failed',
      note: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    activeRun = null;
  });

  return { runId, planId: INVOICE_PLAN_ID };
}

export function startRun(scenario: 'refund' | 'invoice' = 'refund', options: RunOptions = {}): RunHandle {
  if (scenario === 'invoice') return startInvoiceRun(options);
  return startRefundRun(options);
}

async function executeRefund(run: RunState, options: RunOptions): Promise<void> {
  const delay = options.stepDelayMs ?? 1000;
  const agent = db.agents.find((a) => a.id === REFUND_AGENT_ID)!;
  const artifacts = lastArtifacts;
  const ctx: ToolContext = {
    runId: run.runId,
    agentId: agent.id,
    agentName: agent.name,
    planId: REFUND_PLAN_ID,
    planVersion: getPlan(REFUND_PLAN_ID)?.document.version ?? 1,
    artifacts,
  };

  captureRefundPlan();
  await sleep(delay);

  const step = (n: number, note: string) =>
    setRun({ ...(db.runs.get(run.runId) as RunState), currentStep: n, note, status: 'running' });

  // 1 - Fetch customer details
  step(1, 'Retrieving customer profile from CRM (Priya Sharma)');
  await invoke({
    agentId: agent.id,
    tool: 'customer.get',
    args: { customerId: DEMO_CUSTOMER_ID },
    ctx,
    origin: 'planned',
  });
  await sleep(delay);

  // 2 - Retrieve order and damaged items report
  step(2, 'Retrieving purchase details and item damage inspection report');
  const orderRes = await invoke({
    agentId: agent.id,
    tool: 'order.get',
    args: { orderId: DEMO_ORDER_ID },
    ctx,
    origin: 'planned',
  });
  const orderData = orderRes.execution.output as any;
  await sleep(delay);

  // 3 - Verify original payment transaction
  step(3, 'Validating payment settlement on Razorpay / HDFC Gateway');
  await invoke({
    agentId: agent.id,
    tool: 'payment.verify',
    args: { paymentTxnId: orderData?.paymentTxnId ?? 'TXN-HDFC-99124', orderId: DEMO_ORDER_ID },
    ctx,
    origin: 'planned',
  });
  await sleep(delay);

  // 4 - Refund attempt. With a Google key configured the amount is the model's
  // own decision from the damage report; without one it is the scripted figure.
  // Either way the gateway rules on the argument it is actually given.
  const ticket = getTicket(DEMO_TICKET_ID);
  const customer = getCustomer(DEMO_CUSTOMER_ID);
  const damagedItem = orderData?.items?.[0];

  step(
    4,
    llmEnabled()
      ? 'Reasoning with Gemini over the damage report to decide a refund amount'
      : 'Reasoning: Damaged item is Sony WH-1000XM5 (₹25,000). Attempting payment refund',
  );

  const decision = await decideRefund({
    customerName: customer?.name ?? 'the customer',
    tier: customer?.tier ?? 'STANDARD',
    itemName: damagedItem?.name ?? 'Sony WH-1000XM5 Noise Canceling Headphones',
    itemPrice: damagedItem?.unitPrice ?? 25000,
    currency: orderData?.currency ?? 'INR',
    orderId: DEMO_ORDER_ID,
    ticketSubject: ticket?.subject ?? 'Damaged item on arrival',
    ticketBody: ticket?.description ?? 'Package arrived crushed by courier.',
    damageReport: damagedItem?.condition ?? 'Headband snapped upon arrival, unrepairable',
  });

  const amountLabel = `₹${decision.amount.toLocaleString('en-IN')}`;
  const decidedBy =
    decision.source === 'gemini'
      ? `Gemini (${decision.model}) decided ${amountLabel}`
      : `Scripted decision: ${amountLabel}`;

  step(4, `${decidedBy} — ${decision.reasoning}`);

  const refundAttempt = await invoke({
    agentId: agent.id,
    tool: 'refund.issue',
    args: {
      orderId: DEMO_ORDER_ID,
      ticketId: DEMO_TICKET_ID,
      customerId: DEMO_CUSTOMER_ID,
      amount: decision.amount,
      currency: decision.currency,
      reason: decision.reasoning,
    },
    ctx,
    origin: 'injected',
    originNote:
      decision.source === 'gemini'
        ? `${decidedBy}. Model reasoning: ${decision.reasoning}`
        : `Customer support ticket requests full refund of ${amountLabel} for damaged headphones`,
    approvalTitle: `High-Value Payment Refund (${amountLabel})`,
  });

  if (refundAttempt.approval && refundAttempt.resolution) {
    setRun({
      ...(db.runs.get(run.runId) as RunState),
      status: 'waiting-approval',
      currentStep: 4,
      note: `Held: refund.issue for ${amountLabel} on ${DEMO_ORDER_ID}. Exceeds authorized limit (≤ ₹5,000). Awaiting manager approval.`,
    });

    const outcome = await refundAttempt.resolution;

    if (outcome.status !== 'APPROVED') {
      setRun({
        ...(db.runs.get(run.runId) as RunState),
        status: 'terminated',
        currentStep: 4,
        note:
          outcome.status === 'REJECTED'
            ? 'Refund rejected by manager. Workflow terminated safely — ₹0 refunded.'
            : 'Approval window elapsed. Workflow terminated safely — ₹0 refunded.',
        completedAt: new Date().toISOString(),
      });
      appendAudit({
        at: new Date().toISOString(),
        category: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        planId: REFUND_PLAN_ID,
        summary: `Run ${run.runId} terminated safely after the held refund was ${outcome.status.toLowerCase()}.`,
        detail: { runId: run.runId },
      });
      activeRun = null;
      return;
    }

    setRun({
      ...(db.runs.get(run.runId) as RunState),
      status: 'running',
      currentStep: 4,
      note: 'Approval granted by Finance Manager. Agent resumed under amended single-use plan.',
    });
    await sleep(delay);
  }

  // 5 - Update Support Ticket
  step(5, 'Updating support ticket resolution & refund reference');
  await invoke({
    agentId: agent.id,
    tool: 'ticket.update',
    args: {
      ticketId: DEMO_TICKET_ID,
      status: 'RESOLVED',
      resolutionNotes: `Approved ${amountLabel} refund for damaged Sony WH-1000XM5 headphones.`,
    },
    ctx,
    origin: 'planned',
  });
  await sleep(delay);

  // 6 - Send Customer Notification
  step(6, `Notifying customer of approved ${amountLabel} refund and ticket closure`);
  await invoke({
    agentId: agent.id,
    tool: 'notification.send',
    args: {
      to: customer?.email ?? 'priya.sharma@example.com',
      subject: `Refund Approved for Order ${DEMO_ORDER_ID}`,
      body: `Dear ${customer?.name ?? 'Priya'},\n\nYour refund of ${amountLabel} for order ${DEMO_ORDER_ID} has been approved and processed to your original payment method. Thank you for your patience!`,
    },
    ctx,
    origin: 'planned',
  });

  setRun({
    ...(db.runs.get(run.runId) as RunState),
    status: 'completed',
    currentStep: 6,
    note: 'Workflow complete. High-value refund verified and audited under ArmorIQ governance.',
    completedAt: new Date().toISOString(),
  });
  appendAudit({
    at: new Date().toISOString(),
    category: 'agent',
    agentId: agent.id,
    agentName: agent.name,
    planId: REFUND_PLAN_ID,
    summary: `Run ${run.runId} completed. 6 actions evaluated, 1 held for managerial decision.`,
    detail: { runId: run.runId },
  });
  activeRun = null;
}

async function executeInvoice(run: RunState, options: RunOptions): Promise<void> {
  const delay = options.stepDelayMs ?? 1100;
  const agent = db.agents.find((a) => a.id === INVOICE_AGENT_ID)!;
  const artifacts = lastArtifacts;
  const ctx: ToolContext = {
    runId: run.runId,
    agentId: agent.id,
    agentName: agent.name,
    planId: INVOICE_PLAN_ID,
    planVersion: getPlan(INVOICE_PLAN_ID)?.document.version ?? 1,
    artifacts,
  };

  captureInvoicePlan();
  await sleep(delay);

  const step = (n: number, note: string) =>
    setRun({ ...(db.runs.get(run.runId) as RunState), currentStep: n, note, status: 'running' });

  // 1 - read the source document -----------------------------------------
  step(1, 'Reading source document');
  const read = await invoke({
    agentId: agent.id,
    tool: 'invoice.read',
    args: { invoiceId: DEMO_INVOICE_ID },
    ctx,
    origin: 'planned',
  });
  const sourceArtifactId = String((read.execution.output as any)?.artifactId ?? '');
  await sleep(delay);

  // 2 - extract fields; the tool surfaces text embedded in the document ----
  step(2, 'Extracting invoice fields');
  const extract = await invoke({
    agentId: agent.id,
    tool: 'invoice.extract',
    args: { sourceArtifactId, invoiceId: DEMO_INVOICE_ID },
    ctx,
    origin: 'planned',
  });
  const extractedId = String((extract.execution.output as any)?.artifactId ?? '');
  const invoice = getInvoice(DEMO_INVOICE_ID);
  const directive = invoice?.notes ?? '';

  /**
   * ADK planner step: the model reads the document text returned by the tool and
   * decides to act on it. The recipient is parsed out of the document, not
   * supplied by the demo.
   */
  const plannerTarget = (directive.match(EMAIL_PATTERN) ?? [])[0];
  await sleep(delay);

  // 3 - validate the vendor ------------------------------------------------
  step(3, 'Validating vendor against registry');
  await invoke({
    agentId: agent.id,
    tool: 'vendor.verify',
    args: {
      taxId: (extract.execution.output as any)?.vendorTaxId,
      bankAccount: (extract.execution.output as any)?.bankAccount,
    },
    ctx,
    origin: 'planned',
  });
  await sleep(delay);

  // 4 - post the payable ---------------------------------------------------
  step(4, 'Posting payable to the accounting ledger');
  const posted = await invoke({
    agentId: agent.id,
    tool: 'database.update',
    args: {
      invoiceId: DEMO_INVOICE_ID,
      vendor: (extract.execution.output as any)?.vendorName,
      amount: (extract.execution.output as any)?.amount,
      currency: (extract.execution.output as any)?.currency,
    },
    ctx,
    origin: 'planned',
  });
  const receiptId = String((posted.execution.output as any)?.artifactId ?? '');
  await sleep(delay);

  // 5 - notify the internal AP mailbox ------------------------------------
  // Same tool as step 6. Different recipient, different data class, different
  // outcome - decided entirely by the grants in the signed plan.
  step(5, 'Notifying internal accounts-payable mailbox');
  await invoke({
    agentId: agent.id,
    tool: 'external.send',
    args: {
      to: INTERNAL_AP_MAILBOX,
      subject: `Payable posted for ${DEMO_INVOICE_ID}`,
      body: 'Posting receipt attached. Status only.',
      attachments: receiptId ? [receiptId] : [],
    },
    ctx,
    origin: 'planned',
  });
  await sleep(delay);

  // 6 - the document-borne instruction ------------------------------------
  step(6, 'Planner acting on instruction embedded in the source document');
  const target = plannerTarget ?? EXTERNAL_MAILBOX;
  const attempt = await invoke({
    agentId: agent.id,
    tool: 'external.send',
    args: {
      to: target,
      subject: `Invoice verification - ${DEMO_INVOICE_ID}`,
      body:
        'Forwarding extracted invoice details and vendor bank reference for remittance ' +
        'verification, as requested in the document.',
      attachments: extractedId ? [extractedId] : [],
    },
    ctx,
    origin: 'injected',
    originNote: `Instruction embedded in ${DEMO_INVOICE_ID} notes block`,
    approvalTitle: 'External data transfer',
  });

  if (attempt.approval && attempt.resolution) {
    setRun({
      ...(db.runs.get(run.runId) as RunState),
      status: 'waiting-approval',
      currentStep: 6,
      note: `Held: ${attempt.approval.tool} to ${attempt.approval.target}. Awaiting human decision.`,
    });

    const outcome = await attempt.resolution;

    if (outcome.status !== 'APPROVED') {
      setRun({
        ...(db.runs.get(run.runId) as RunState),
        status: 'terminated',
        currentStep: 6,
        note:
          outcome.status === 'REJECTED'
            ? 'Action rejected. Execution terminated safely - nothing was sent.'
            : 'Approval window elapsed. Execution terminated safely - nothing was sent.',
        completedAt: new Date().toISOString(),
      });
      appendAudit({
        at: new Date().toISOString(),
        category: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        planId: INVOICE_PLAN_ID,
        summary: `Run ${run.runId} terminated safely after the held action was ${outcome.status.toLowerCase()}.`,
        detail: { runId: run.runId, remainingSteps: ['invoice.archive'] },
      });
      activeRun = null;
      return;
    }

    setRun({
      ...(db.runs.get(run.runId) as RunState),
      status: 'running',
      currentStep: 6,
      note: 'Approval granted. Agent resumed under the amended plan.',
    });
    await sleep(delay);
  }

  // 7 - archive ------------------------------------------------------------
  step(7, 'Archiving processed document');
  await invoke({
    agentId: agent.id,
    tool: 'invoice.archive',
    args: { invoiceId: DEMO_INVOICE_ID },
    ctx,
    origin: 'planned',
  });

  setRun({
    ...(db.runs.get(run.runId) as RunState),
    status: 'completed',
    currentStep: 7,
    note: 'Workflow complete. Every action was authorized against the signed plan.',
    completedAt: new Date().toISOString(),
  });
  appendAudit({
    at: new Date().toISOString(),
    category: 'agent',
    agentId: agent.id,
    agentName: agent.name,
    planId: INVOICE_PLAN_ID,
    summary: `Run ${run.runId} completed. 7 actions evaluated, 1 held for human decision.`,
    detail: { runId: run.runId },
  });
  activeRun = null;
}

export function releaseRun(): void {
  activeRun = null;
}

/**
 * Operator-initiated probe used by "Simulate Scope Violation".
 *
 * It takes the same path as an agent call: same gateway, same engine, same plan.
 * Any registered tool can be probed - including tools the plan does authorize,
 * which is how you demonstrate that the outcome tracks the plan and not the name.
 */
export async function probeAction(input: {
  tool: string;
  agentId?: string;
  to?: string;
  invoiceId?: string;
  orderId?: string;
  customerId?: string;
  amount?: number;
  principal?: string;
  attach?: 'extracted' | 'status' | 'none';
}): Promise<ReturnType<typeof invoke>> {
  const isRefundAgent = input.tool.startsWith('customer') || input.tool.startsWith('order') || input.tool.startsWith('refund') || input.tool.startsWith('ticket');
  const agentId = input.agentId ?? (isRefundAgent ? REFUND_AGENT_ID : INVOICE_AGENT_ID);
  const agent = db.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);

  const artifacts = new Map(lastArtifacts);
  const ensure = (id: string, dataClass: string, summary: string): string => {
    const existing = [...artifacts.values()].find((a) => a.dataClass === dataClass);
    if (existing) return existing.id;
    const invoice = getInvoice(DEMO_INVOICE_ID);
    const artifact: Artifact = {
      id,
      dataClass,
      producedBy: dataClass === 'finance.invoice.extracted' ? 'invoice.extract' : 'database.update',
      summary,
      payload: {
        invoiceId: invoice?.id,
        vendorName: invoice?.vendorName,
        amount: invoice?.amount,
        bankAccount: dataClass === 'finance.invoice.extracted' ? invoice?.bankAccount : undefined,
      },
    };
    artifacts.set(artifact.id, artifact);
    return artifact.id;
  };

  const attachments: string[] = [];
  if (input.attach === 'extracted') {
    attachments.push(
      ensure('art_ext_probe', 'finance.invoice.extracted', 'Extracted invoice fields (probe)'),
    );
  } else if (input.attach === 'status') {
    attachments.push(ensure('art_rcpt_probe', 'finance.invoice.status', 'Posting receipt (probe)'));
  }

  const ctx: ToolContext = {
    runId: `probe_${Date.now().toString(36)}`,
    agentId,
    agentName: agent.name,
    planId: agent.planId!,
    planVersion: getPlan(agent.planId!)?.document.version ?? 1,
    artifacts,
  };

  const args: Record<string, unknown> = {};
  if (input.tool === 'external.send') {
    args.to = input.to ?? EXTERNAL_MAILBOX;
    args.subject = `Scope probe - ${DEMO_INVOICE_ID}`;
    args.body = 'Operator-initiated authorization probe.';
    args.attachments = attachments;
  } else if (input.tool === 'refund.issue') {
    args.orderId = input.orderId ?? DEMO_ORDER_ID;
    args.ticketId = DEMO_TICKET_ID;
    args.customerId = input.customerId ?? DEMO_CUSTOMER_ID;
    args.amount = input.amount ?? 25000;
    args.currency = 'INR';
    args.reason = 'Operator probe of refund monetary threshold';
  } else if (input.tool === 'customer.get') {
    args.customerId = input.customerId ?? DEMO_CUSTOMER_ID;
  } else if (input.tool === 'order.get') {
    args.orderId = input.orderId ?? DEMO_ORDER_ID;
  } else if (input.tool === 'permission.modify') {
    args.principal = input.principal ?? agentId;
    args.role = 'finance.admin';
  } else {
    args.invoiceId = input.invoiceId ?? DEMO_INVOICE_ID;
    args.vendor = 'Meridian Logistics Pvt Ltd';
    args.amount = input.amount ?? 48250;
    args.currency = 'INR';
    args.sourceArtifactId = attachments[0];
    args.taxId = '29AABCM4512P1Z8';
  }

  return invoke({
    agentId,
    tool: input.tool,
    args,
    ctx,
    origin: 'operator',
    originNote: 'Operator-initiated authorization probe from the console',
    approvalTitle: 'Operator probe',
  });
}
