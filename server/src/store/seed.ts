/**
 * Control-plane seed.
 *
 * Agents, plans, policies and integrations are registered here. The historical
 * execution rows are DEMO DATA in the sense that they did not run tools - but
 * every one of them was evaluated by the real authorization engine against the
 * real signed plan, so the decisions, the capability tuples and the reasons in
 * the history are produced the same way the live ones are.
 */
import { capturePlan, getPlan } from '../armoriq/plan.js';
import { authorize } from '../armoriq/engine.js';
import { requireTool } from '../tools/registry.js';
import type { Artifact, ToolContext } from '../tools/registry.js';
import type {
  AgentRecord,
  ApprovalRequest,
  Decision,
  ExecutionRecord,
  IntegrationRecord,
  PolicyRecord,
} from '../types.js';
import {
  appendAudit,
  db,
  nextApprovalId,
  nextExecutionId,
  summariseAuthorization,
} from './state.js';

export const INVOICE_AGENT_ID = 'agt_7F92A1';
export const INVOICE_PLAN_ID = 'PLN-92A7';
export const REFUND_AGENT_ID = 'agt_refund_01';
export const REFUND_PLAN_ID = 'PLN-REFUND-01';
export const INTERNAL_AP_MAILBOX = 'accounts-payable@ap.acme-internal.example';
export const EXTERNAL_MAILBOX = 'external-review@example.com';
export const DEMO_INVOICE_ID = 'INV-2026-0841';
export const DEMO_ORDER_ID = 'ORD-9942';
export const DEMO_CUSTOMER_ID = 'CUST-8821';
export const DEMO_TICKET_ID = 'TCK-4401';

export const INVOICE_INTENT =
  'Process incoming supplier invoices for August: read each document, extract its accounting ' +
  'fields, validate the vendor against the approved registry, post the payable to the ledger, ' +
  'notify the internal accounts-payable mailbox of the posting status, and archive the document.';

export const REFUND_INTENT =
  'Process customer refund requests from support queue: inspect customer profile, retrieve order ' +
  'and damage reports, verify payment gateway transaction, issue refunds up to authorized limit ' +
  'of INR 5,000, update support ticket status, and notify the customer of the resolution.';

function at(hour: number, minute: number, second = 0): string {
  const d = new Date();
  d.setHours(hour, minute, second, 0);
  return d.toISOString();
}

export function seedAgents(): AgentRecord[] {
  const agents: AgentRecord[] = [
    {
      id: REFUND_AGENT_ID,
      name: 'Customer Refund Operations Agent',
      description: 'Autonomous customer support & payment refund controller with monetary limits.',
      runtime: 'Google ADK 1.4 / gemini-2.5-flash',
      owner: 'Customer Experience & Finance',
      environment: 'demo',
      status: 'ACTIVE',
      intent: REFUND_INTENT,
      planId: REFUND_PLAN_ID,
      tools: [
        'customer.get',
        'order.get',
        'payment.verify',
        'refund.issue',
        'ticket.update',
        'notification.send',
      ],
      restricted: ['database.delete', 'permission.modify'],
      registeredAt: at(8, 45),
      lastExecutionAt: null,
      actionsToday: 0,
      heldToday: 0,
      blockedToday: 0,
    },
    {
      id: INVOICE_AGENT_ID,
      name: 'Invoice Operations Agent',
      description: 'Accounts-payable document pipeline for the India entity.',
      runtime: 'Google ADK 1.4 / gemini-2.5-flash',
      owner: 'Finance Automation',
      environment: 'demo',
      status: 'ACTIVE',
      intent: INVOICE_INTENT,
      planId: INVOICE_PLAN_ID,
      tools: [
        'invoice.read',
        'invoice.extract',
        'vendor.verify',
        'database.update',
        'external.send',
        'invoice.archive',
      ],
      restricted: ['database.delete', 'permission.modify'],
      registeredAt: at(8, 52),
      lastExecutionAt: null,
      actionsToday: 0,
      heldToday: 0,
      blockedToday: 0,
    },
    {
      id: 'agt_3C41D8',
      name: 'Vendor Reconciliation Agent',
      description: 'Reconciles vendor master data against posted payables.',
      runtime: 'Google ADK 1.4 / gemini-2.5-flash',
      owner: 'Finance Automation',
      environment: 'demo',
      status: 'ACTIVE',
      intent:
        'Reconcile the approved vendor registry against posted ledger entries and flag mismatches ' +
        'for the controller. No writes to the ledger.',
      planId: 'PLN-92A8',
      tools: ['vendor.verify', 'invoice.read'],
      restricted: ['database.update', 'database.delete', 'external.send', 'permission.modify'],
      registeredAt: at(8, 55),
      lastExecutionAt: null,
      actionsToday: 0,
      heldToday: 0,
      blockedToday: 0,
    },
    {
      id: 'agt_B85E20',
      name: 'Ledger Close Agent',
      description: 'Prepares the monthly close pack from posted payables.',
      runtime: 'Google ADK 1.4 / gemini-2.5-pro',
      owner: 'Controllership',
      environment: 'demo',
      status: 'ACTIVE',
      intent:
        'Read posted ledger entries for the current period, post accrual adjustments approved by ' +
        'the controller, and archive the close pack.',
      planId: 'PLN-92A9',
      tools: ['database.update', 'invoice.archive'],
      restricted: ['database.delete', 'external.send', 'permission.modify'],
      registeredAt: at(9, 1),
      lastExecutionAt: null,
      actionsToday: 0,
      heldToday: 0,
      blockedToday: 0,
    },
  ];
  db.agents = agents;
  return agents;
}

export function seedPlans(): void {
  capturePlan({
    planId: REFUND_PLAN_ID,
    agentId: REFUND_AGENT_ID,
    intent: REFUND_INTENT,
    issuedAt: at(9, 10, 0),
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

  capturePlan({
    planId: INVOICE_PLAN_ID,
    agentId: INVOICE_AGENT_ID,
    intent: INVOICE_INTENT,
    issuedAt: at(9, 14, 3),
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

  capturePlan({
    planId: 'PLN-92A8',
    agentId: 'agt_3C41D8',
    intent: db.agents[1].intent,
    issuedAt: at(9, 16, 41),
    ttlMinutes: 12 * 60,
    grants: [
      { effect: 'read', resource: 'finance.vendor.registry' },
      { effect: 'read', resource: 'finance.invoice.raw' },
      { effect: 'read', resource: 'finance.ledger' },
    ],
    declaredSteps: [
      { tool: 'vendor.verify', summary: 'Compare registry record with posted payable' },
      { tool: 'invoice.read', summary: 'Open the source document for mismatched entries' },
    ],
  });

  capturePlan({
    planId: 'PLN-92A9',
    agentId: 'agt_B85E20',
    intent: db.agents[2].intent,
    issuedAt: at(9, 22, 18),
    ttlMinutes: 12 * 60,
    grants: [
      { effect: 'read', resource: 'finance.ledger' },
      { effect: 'write', resource: 'finance.ledger' },
      { effect: 'append', resource: 'finance.archive' },
    ],
    declaredSteps: [
      { tool: 'database.update', summary: 'Post approved accrual adjustments' },
      { tool: 'invoice.archive', summary: 'Archive the close pack' },
    ],
  });
}

export function seedIntegrations(): IntegrationRecord[] {
  const now = new Date().toISOString();
  const integrations: IntegrationRecord[] = [
    {
      id: 'int_armoriq',
      name: 'ArmorIQ',
      category: 'Authorization',
      description: 'capture_plan() and invoke() enforcement plane.',
      status: 'CONNECTED',
      mode: 'simulated',
      detail:
        'Local enforcement build. Plan integrity uses HMAC-SHA256 over the canonical plan body ' +
        'with an in-process demo key; production deployments sign in a KMS/HSM.',
      lastCheckedAt: now,
    },
    {
      id: 'int_adk',
      name: 'Google ADK',
      category: 'Agent runtime',
      description: 'Agent runtime that emits tool calls through the gateway.',
      status: 'CONNECTED',
      mode: 'simulated',
      detail:
        'Deterministic local runner with ADK-shaped planner semantics: the planner consumes tool ' +
        'output, including instructions embedded in source documents.',
      lastCheckedAt: now,
    },
    {
      id: 'int_mcp',
      name: 'MCP',
      category: 'Tool surface',
      description: 'Tool registry with declared capability requirements.',
      status: 'CONNECTED',
      mode: 'sandbox',
      detail: '8 tools registered across 6 surfaces. Requirements are computed per call.',
      lastCheckedAt: now,
    },
    {
      id: 'int_db',
      name: 'Database',
      category: 'System of record',
      description: 'Accounts-payable ledger and retention archive.',
      status: 'CONNECTED',
      mode: 'sandbox',
      detail: 'File-backed sandbox ledger. Writes are real and observable.',
      lastCheckedAt: now,
    },
    {
      id: 'int_mail',
      name: 'Mail Sandbox',
      category: 'Egress',
      description: 'Test-mode transport for every outbound message.',
      status: 'CONNECTED',
      mode: 'sandbox',
      detail:
        'Messages are delivered to a local outbox, never to a public relay. Held messages are ' +
        'absent from the outbox, which is the proof that the hold happened before execution.',
      lastCheckedAt: now,
    },
    {
      id: 'int_audit',
      name: 'Audit Storage',
      category: 'Evidence',
      description: 'Hash-linked authorization and execution log.',
      status: 'CONNECTED',
      mode: 'sandbox',
      detail: 'Each entry commits to the digest of the previous entry (SHA-256).',
      lastCheckedAt: now,
    },
  ];
  db.integrations = integrations;
  return integrations;
}

export function seedPolicies(): PolicyRecord[] {
  const policies: PolicyRecord[] = [
    {
      id: 'pol_invoice',
      name: 'Invoice Processing Policy',
      scope: 'Finance Automation / accounts payable',
      updatedAt: at(8, 40),
      version: 'v4.2',
      statements: [
        {
          disposition: 'ALLOW',
          title: 'Read invoice documents',
          description: 'An agent may open source invoices it has been assigned.',
          tuples: [{ effect: 'read', resource: 'finance.invoice.raw' }],
        },
        {
          disposition: 'ALLOW',
          title: 'Extract invoice fields',
          description: 'Structured fields may be derived from an assigned document.',
          tuples: [{ effect: 'derive', resource: 'finance.invoice.extracted' }],
        },
        {
          disposition: 'ALLOW',
          title: 'Validate vendors',
          description: 'The approved vendor registry may be read for validation.',
          tuples: [{ effect: 'read', resource: 'finance.vendor.registry' }],
        },
        {
          disposition: 'ALLOW',
          title: 'Post accounting records',
          description: 'Payables may be written to the ledger for assigned invoices.',
          tuples: [{ effect: 'write', resource: 'finance.ledger' }],
        },
        {
          disposition: 'ALLOW',
          title: 'Archive processed invoices',
          description: 'Completed documents may be appended to the retention store.',
          tuples: [{ effect: 'append', resource: 'finance.archive' }],
        },
        {
          disposition: 'APPROVAL',
          title: 'Send data outside the trust boundary',
          description:
            'Any transfer of invoice or vendor data to a recipient outside the internal AP domain ' +
            'is held for a named human approver before it is executed.',
          tuples: [
            { effect: 'transfer.external', resource: 'finance.invoice.extracted' },
            { effect: 'transfer.external', resource: 'channel.external' },
          ],
        },
        {
          disposition: 'APPROVAL',
          title: 'Move money',
          description: 'Payment release requires a human approver on every occurrence.',
          tuples: [{ effect: 'write', resource: 'finance.ledger.disbursement' }],
        },
        {
          disposition: 'BLOCK',
          title: 'Destroy accounting records',
          description: 'Deletion of ledger rows is never delegated to an agent.',
          tuples: [{ effect: 'delete', resource: 'finance.ledger' }],
        },
        {
          disposition: 'BLOCK',
          title: 'Change the authority model',
          description:
            'An agent may not alter permissions, roles or credentials - including its own.',
          tuples: [
            { effect: 'privilege.modify', resource: 'system.permissions' },
            { effect: 'write', resource: 'identity.credentials' },
          ],
        },
      ],
    },
  ];
  db.policies = policies;
  return policies;
}

/** Historical rows, evaluated by the real engine and written to the audit chain. */
export function seedHistory(): void {
  const agents = db.agents;
  const artifacts = new Map<string, Artifact>();
  const extracted: Artifact = {
    id: 'art_ext_seed',
    dataClass: 'finance.invoice.extracted',
    producedBy: 'invoice.extract',
    summary: 'Extracted invoice fields (historical run)',
    payload: {},
  };
  const receipt: Artifact = {
    id: 'art_rcpt_seed',
    dataClass: 'finance.invoice.status',
    producedBy: 'database.update',
    summary: 'Posting receipt (historical run)',
    payload: {},
  };
  artifacts.set(extracted.id, extracted);
  artifacts.set(receipt.id, receipt);

  const TOTAL = 127;
  const HELD_AT = new Set([17, 39, 58, 76, 95, 110, 124]);
  const BLOCKED_AT = 84;

  const end = Date.now() - 6 * 60_000;
  const dayStart = new Date();
  dayStart.setHours(9, 26, 0, 0);
  const start = Math.min(dayStart.getTime(), end - 45 * 60_000);
  const span = Math.max(end - start, 30 * 60_000);

  const rotation: { agent: AgentRecord; tool: string; args: Record<string, unknown> }[] = [
    { agent: agents[0], tool: 'invoice.read', args: { invoiceId: 'INV-2026-0788' } },
    {
      agent: agents[0],
      tool: 'invoice.extract',
      args: { sourceArtifactId: 'art_doc_seed', invoiceId: 'INV-2026-0788' },
    },
    { agent: agents[0], tool: 'vendor.verify', args: { taxId: '29AABCM4512P1Z8' } },
    { agent: agents[0], tool: 'database.update', args: { invoiceId: 'INV-2026-0788', amount: 21400 } },
    {
      agent: agents[0],
      tool: 'external.send',
      args: { to: INTERNAL_AP_MAILBOX, subject: 'Payable posted', attachments: [receipt.id] },
    },
    { agent: agents[0], tool: 'invoice.archive', args: { invoiceId: 'INV-2026-0788' } },
    { agent: agents[1], tool: 'vendor.verify', args: { taxId: '27AAECS1429R1ZK' } },
    { agent: agents[1], tool: 'invoice.read', args: { invoiceId: 'INV-2026-0791' } },
    { agent: agents[2], tool: 'database.update', args: { invoiceId: 'ACR-2026-08-14', amount: 96000 } },
    { agent: agents[2], tool: 'invoice.archive', args: { invoiceId: 'ACR-2026-08-14' } },
  ];

  for (let i = 0; i < TOTAL; i += 1) {
    const when = new Date(start + Math.round((span * i) / TOTAL));
    const isHeld = HELD_AT.has(i);
    const isBlocked = i === BLOCKED_AT;
    const base = rotation[i % rotation.length];

    let agent = base.agent;
    let tool = base.tool;
    let args: Record<string, unknown> = { ...base.args };

    if (isHeld) {
      agent = agents[0];
      tool = 'external.send';
      args = {
        to: EXTERNAL_MAILBOX,
        subject: 'Invoice verification',
        attachments: [extracted.id],
      };
    } else if (isBlocked) {
      agent = agents[2];
      tool = 'database.delete';
      args = { invoiceId: 'ACR-2026-07-31' };
    }

    const descriptor = requireTool(tool);
    const plan = db.agents.find((a) => a.id === agent.id)!.planId!;
    const ctx: ToolContext = {
      runId: 'run_seed',
      agentId: agent.id,
      agentName: agent.name,
      planId: plan,
      planVersion: 1,
      artifacts,
    };

    const signedPlan = getPlan(plan)!;
    const decisionRecord = authorize({
      plan: signedPlan,
      agentId: agent.id,
      tool,
      requirements: descriptor.requirements(args, ctx),
      riskTier: descriptor.riskTier,
      now: when,
    });

    const decision: Decision = decisionRecord.decision;
    const pendingHold = i === 110;
    const result =
      decision === 'ALLOWED'
        ? 'SUCCESS'
        : decision === 'BLOCKED'
          ? 'NOT_EXECUTED'
          : pendingHold
            ? 'PENDING'
            : 'SUCCESS';

    const durationMs =
      decision === 'ALLOWED' ? 40 + ((i * 37) % 260) : decision === 'HELD' ? 0 : 0;

    const execution: ExecutionRecord = {
      id: nextExecutionId(),
      runId: 'run_seed',
      stepIndex: i,
      agentId: agent.id,
      agentName: agent.name,
      tool,
      title: descriptor.title,
      resource: descriptor.resource(args, ctx),
      surface: descriptor.surface,
      args,
      decision,
      verification: decisionRecord.verification,
      result,
      planId: plan,
      planVersion: 1,
      startedAt: when.toISOString(),
      completedAt: new Date(when.getTime() + durationMs).toISOString(),
      durationMs,
      authorizationMs: Number(decisionRecord.durationMs.toFixed(3)),
      authorization: decisionRecord,
      origin: isHeld || isBlocked ? 'injected' : 'planned',
      originNote: isHeld
        ? 'Instruction embedded in a supplier document'
        : isBlocked
          ? 'Cleanup routine proposed by the agent planner'
          : undefined,
      seeded: true,
    };
    db.executions.push(execution);

    agent.actionsToday += 1;
    if (decision === 'HELD') agent.heldToday += 1;
    if (decision === 'BLOCKED') agent.blockedToday += 1;
    agent.lastExecutionAt = execution.startedAt;

    if (decision === 'HELD') {
      const approval: ApprovalRequest = {
        id: nextApprovalId(),
        executionId: execution.id,
        runId: 'run_seed',
        agentId: agent.id,
        agentName: agent.name,
        tool,
        title: 'External data transfer',
        target: String(args.to ?? ''),
        planId: plan,
        requestedAt: when.toISOString(),
        resolvedAt: pendingHold ? undefined : new Date(when.getTime() + 92_000).toISOString(),
        status: pendingHold ? 'PENDING' : 'APPROVED',
        decidedBy: pendingHold ? undefined : 'r.iyer@acme-internal.example',
        unsatisfied: decisionRecord.unsatisfied,
        reason: decisionRecord.reason,
        authorization: decisionRecord,
        contextPreview: {
          recipient: args.to,
          attachments: (args.attachments as string[] | undefined)?.length ?? 0,
          dataClasses: decisionRecord.requirements.map((r) => r.resource),
        },
        seeded: true,
      };
      db.approvals.push(approval);
      execution.approvalId = approval.id;
    }

    appendAudit({
      at: execution.startedAt,
      category: 'authorization',
      agentId: agent.id,
      agentName: agent.name,
      tool,
      planId: plan,
      decision,
      verification: decisionRecord.verification,
      execution: result,
      humanDecision:
        decision === 'HELD' ? (pendingHold ? 'Pending' : 'Approved once') : 'Not required',
      summary: `${tool} ${decision.toLowerCase()} under ${plan}`,
      executionId: execution.id,
      approvalId: execution.approvalId,
      chain: {
        userIntent: agent.intent,
        declaredPlan: plan,
        agent: `${agent.name} (${agent.id})`,
        requestedAction: `${tool} -> ${execution.resource}`,
        verification: decisionRecord.verification,
        decision,
        executionResult: result,
        humanDecision:
          decision === 'HELD' ? (pendingHold ? 'Pending' : 'Approved once') : 'Not required',
      },
      detail: summariseAuthorization(decisionRecord),
      seeded: true,
    });
  }
}
