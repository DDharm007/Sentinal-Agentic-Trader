/**
 * Intent Execution Graph.
 *
 * The shape of the graph is the declared plan: intent -> signed plan -> the
 * steps the agent said it would take. Any action the agent attempts that is not
 * in the plan is attached as an off-plan node, which is why the violating node
 * is visually outside the authorized subtree rather than styled differently.
 */
import { getPlan } from '../armoriq/plan.js';
import { db, latestRun } from './state.js';
import type { ExecutionRecord } from '../types.js';

export type GraphNodeState =
  | 'idle'
  | 'running'
  | 'allowed'
  | 'held'
  | 'blocked'
  | 'approved'
  | 'skipped';

export interface GraphNode {
  id: string;
  kind: 'intent' | 'plan' | 'action';
  label: string;
  sublabel?: string;
  tool?: string;
  layer: number;
  column: number;
  state: GraphNodeState;
  authorizationState: string;
  timestamp?: string;
  executionId?: string;
  inPlan: boolean;
  detail?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  state: 'idle' | 'active' | 'traversed' | 'severed';
}

export interface IntentGraph {
  runId: string | null;
  status: string;
  planId: string;
  planVersion: number;
  intent: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Blueprint {
  id: string;
  tool: string;
  label: string;
  layer: number;
  column: number;
  inPlan: boolean;
  match: (e: ExecutionRecord) => boolean;
}

const INTERNAL_DOMAIN = 'ap.acme-internal.example';

interface Shape {
  nodes: Blueprint[];
  edges: [string, string][];
}

/** An execution the agent proposed at plan time, not one steered in later. */
const planned = (tool: string) => (e: ExecutionRecord) =>
  e.tool === tool && e.origin === 'planned';

/** An action steered outside the declared scope (injection, drift, operator). */
const offPlan = (tool: string) => (e: ExecutionRecord) =>
  e.tool === tool && e.origin !== 'planned';

/**
 * Accounts-payable pipeline (PLN-92A7). The two external.send nodes are the
 * point of the scenario: the internal notification is declared, the egress to
 * an outside domain is not, so it hangs off the authorized subtree.
 */
const INVOICE_SHAPE: Shape = {
  nodes: [
    {
      id: 'invoice.read',
      tool: 'invoice.read',
      label: 'invoice.read',
      layer: 2,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'invoice.read',
    },
    {
      id: 'vendor.verify',
      tool: 'vendor.verify',
      label: 'vendor.verify',
      layer: 2,
      column: 1,
      inPlan: true,
      match: (e) => e.tool === 'vendor.verify',
    },
    {
      id: 'invoice.extract',
      tool: 'invoice.extract',
      label: 'invoice.extract',
      layer: 3,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'invoice.extract',
    },
    {
      id: 'database.update',
      tool: 'database.update',
      label: 'database.update',
      layer: 4,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'database.update',
    },
    {
      id: 'external.send.internal',
      tool: 'external.send',
      label: 'external.send',
      layer: 5,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'external.send' && String(e.args.to ?? '').endsWith(INTERNAL_DOMAIN),
    },
    {
      id: 'invoice.archive',
      tool: 'invoice.archive',
      label: 'invoice.archive',
      layer: 6,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'invoice.archive',
    },
    {
      id: 'external.send.offplan',
      tool: 'external.send',
      label: 'external.send',
      layer: 6,
      column: 1,
      inPlan: false,
      match: (e) => e.tool === 'external.send' && !String(e.args.to ?? '').endsWith(INTERNAL_DOMAIN),
    },
  ],
  edges: [
    ['intent', 'plan'],
    ['plan', 'invoice.read'],
    ['plan', 'vendor.verify'],
    ['invoice.read', 'invoice.extract'],
    ['invoice.extract', 'database.update'],
    ['vendor.verify', 'database.update'],
    ['database.update', 'external.send.internal'],
    ['external.send.internal', 'invoice.archive'],
    ['external.send.internal', 'external.send.offplan'],
  ],
};

/**
 * Customer refund pipeline (PLN-REFUND-01). refund.issue appears twice: the
 * declared node authorized up to the monetary limit, and the off-plan node for
 * the over-limit attempt that ArmorIQ holds before execution.
 */
const REFUND_SHAPE: Shape = {
  nodes: [
    {
      id: 'customer.get',
      tool: 'customer.get',
      label: 'customer.get',
      layer: 2,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'customer.get',
    },
    {
      id: 'order.get',
      tool: 'order.get',
      label: 'order.get',
      layer: 2,
      column: 1,
      inPlan: true,
      match: (e) => e.tool === 'order.get',
    },
    {
      id: 'payment.verify',
      tool: 'payment.verify',
      label: 'payment.verify',
      layer: 3,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'payment.verify',
    },
    {
      id: 'refund.issue',
      tool: 'refund.issue',
      label: 'refund.issue',
      layer: 4,
      column: 0,
      inPlan: true,
      match: planned('refund.issue'),
    },
    {
      id: 'refund.issue.offplan',
      tool: 'refund.issue',
      label: 'refund.issue',
      layer: 4,
      column: 1,
      inPlan: false,
      match: offPlan('refund.issue'),
    },
    {
      id: 'ticket.update',
      tool: 'ticket.update',
      label: 'ticket.update',
      layer: 5,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'ticket.update',
    },
    {
      id: 'notification.send',
      tool: 'notification.send',
      label: 'notification.send',
      layer: 6,
      column: 0,
      inPlan: true,
      match: (e) => e.tool === 'notification.send',
    },
  ],
  edges: [
    ['intent', 'plan'],
    ['plan', 'customer.get'],
    ['plan', 'order.get'],
    ['customer.get', 'payment.verify'],
    ['order.get', 'payment.verify'],
    ['payment.verify', 'refund.issue'],
    ['payment.verify', 'refund.issue.offplan'],
    ['refund.issue', 'ticket.update'],
    ['refund.issue.offplan', 'ticket.update'],
    ['ticket.update', 'notification.send'],
  ],
};

const SHAPES: Record<string, Shape> = {
  'PLN-92A7': INVOICE_SHAPE,
  'PLN-REFUND-01': REFUND_SHAPE,
};

/**
 * Any plan without a hand-authored shape is drawn straight from its declared
 * steps as a linear spine, with one off-plan node per tool the run attempted
 * outside that sequence. Keeps the graph honest for agents added later.
 */
function shapeFromDeclaredSteps(
  steps: { tool: string; summary: string }[],
  executions: ExecutionRecord[],
): Shape {
  const nodes: Blueprint[] = [];
  const edges: [string, string][] = [['intent', 'plan']];
  let previous = 'plan';

  steps.forEach((step, index) => {
    const id = `${step.tool}#${index}`;
    const ordinal = steps.slice(0, index).filter((s) => s.tool === step.tool).length;
    nodes.push({
      id,
      tool: step.tool,
      label: step.tool,
      layer: 2 + index,
      column: 0,
      inPlan: true,
      // The nth declared use of a tool binds to the nth planned execution of it.
      match: (e) =>
        e.tool === step.tool &&
        e.origin === 'planned' &&
        executions.filter((x) => x.tool === step.tool && x.origin === 'planned').indexOf(e) ===
          ordinal,
    });
    edges.push([previous, id]);
    previous = id;
  });

  const declaredTools = new Set(steps.map((s) => s.tool));
  const strayTools = [
    ...new Set(
      executions
        .filter((e) => e.origin !== 'planned' || !declaredTools.has(e.tool))
        .map((e) => e.tool),
    ),
  ];

  strayTools.forEach((tool, index) => {
    const id = `offplan:${tool}`;
    if (nodes.some((n) => n.id === id)) return;
    const anchorIndex = steps.findIndex((s) => s.tool === tool);
    const layer = anchorIndex >= 0 ? 2 + anchorIndex : 2 + steps.length;
    const anchor = anchorIndex > 0 ? nodes[anchorIndex - 1]?.id ?? 'plan' : 'plan';
    nodes.push({
      id,
      tool,
      label: tool,
      layer,
      column: 1 + index,
      inPlan: false,
      match: offPlan(tool),
    });
    edges.push([anchor, id]);
  });

  return { nodes, edges };
}

function stateOf(execution: ExecutionRecord | undefined): GraphNodeState {
  if (!execution) return 'idle';
  if (execution.decision === 'BLOCKED') return 'blocked';
  if (execution.decision === 'HELD') return execution.result === 'SUCCESS' ? 'approved' : 'held';
  if (execution.result === 'PENDING') return 'running';
  return 'allowed';
}

function authorizationLabel(execution: ExecutionRecord | undefined, inPlan: boolean): string {
  if (!execution) return inPlan ? 'AUTHORIZED IN PLAN' : 'NOT IN PLAN';
  if (execution.decision === 'ALLOWED') return 'AUTHORIZED';
  if (execution.decision === 'BLOCKED') return 'BLOCKED BEFORE EXECUTION';
  return execution.result === 'SUCCESS' ? 'APPROVED ONCE' : 'OUT OF SCOPE';
}

export function buildGraph(): IntentGraph {
  const run = latestRun();
  const planId = run?.planId ?? db.agents[0]?.planId ?? 'PLN-92A7';
  const plan = getPlan(planId);
  const executions = run
    ? db.executions.filter((e) => e.runId === run.runId)
    : [];

  // The graph is the shape of THIS plan - never another scenario's pipeline.
  const shape =
    SHAPES[planId] ?? shapeFromDeclaredSteps(plan?.document.declaredSteps ?? [], executions);

  const nodes: GraphNode[] = [
    {
      id: 'intent',
      kind: 'intent',
      label: 'USER INTENT',
      sublabel: 'Declared operating scope',
      layer: 0,
      column: 0,
      state: run ? 'allowed' : 'idle',
      authorizationState: 'DECLARED',
      inPlan: true,
      detail: plan?.document.intent,
    },
    {
      id: 'plan',
      kind: 'plan',
      label: 'SIGNED PLAN',
      sublabel: `${planId} v${plan?.document.version ?? 1}`,
      layer: 1,
      column: 0,
      state: run ? 'allowed' : 'idle',
      authorizationState: plan ? 'SIGNATURE VERIFIED' : 'NOT CAPTURED',
      inPlan: true,
      detail: `${plan?.document.grants.length ?? 0} grants - ${plan?.algorithm ?? ''}`,
    },
  ];

  for (const blueprint of shape.nodes) {
    const execution = executions.find(blueprint.match);
    nodes.push({
      id: blueprint.id,
      kind: 'action',
      label: blueprint.label,
      sublabel: execution ? execution.resource : undefined,
      tool: blueprint.tool,
      layer: blueprint.layer,
      column: blueprint.column,
      state: stateOf(execution),
      authorizationState: authorizationLabel(execution, blueprint.inPlan),
      timestamp: execution?.startedAt,
      executionId: execution?.id,
      inPlan: blueprint.inPlan,
      detail: execution?.authorization.reason,
    });
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = shape.edges.map(([from, to]) => {
    const target = nodeById.get(to);
    const source = nodeById.get(from);
    let state: GraphEdge['state'] = 'idle';
    if (target && source && source.state !== 'idle') {
      if (target.state === 'idle') state = 'idle';
      else if (target.state === 'held' || target.state === 'blocked') state = 'severed';
      else if (target.state === 'running') state = 'active';
      else state = 'traversed';
    }
    return { from, to, state };
  });

  return {
    runId: run?.runId ?? null,
    status: run?.status ?? 'idle',
    planId,
    planVersion: plan?.document.version ?? 1,
    intent: plan?.document.intent ?? '',
    nodes,
    edges,
  };
}
