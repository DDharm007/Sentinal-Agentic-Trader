/**
 * SENTINEL / ArmorIQ - capability model.
 *
 * Authorization in SENTINEL is a SET-COVERAGE problem, not a name check.
 *
 *   1. Every tool declares the capability tuples it will consume, derived from
 *      its runtime arguments and the data-provenance labels of the artefacts
 *      those arguments reference.
 *   2. Every signed plan carries a set of grants.
 *   3. An action is authorized only when EVERY required tuple is covered by at
 *      least one grant in the plan the agent is executing under.
 *
 * No rule anywhere in this engine mentions a tool by name. Adding a grant to a
 * plan changes the outcome for any tool; removing one revokes any tool.
 */

export type Effect =
  | 'read'
  | 'derive'
  | 'write'
  | 'append'
  | 'delete'
  | 'transfer.external'
  | 'privilege.modify';

export interface EffectMeta {
  label: string;
  /** Effects a holder of this effect also holds. */
  implies: Effect[];
  reversible: boolean;
  /** What the engine does when the tuple is NOT covered by the signed plan. */
  unsatisfiedDisposition: 'hold' | 'block';
  rationale: string;
}

export const EFFECTS: Record<Effect, EffectMeta> = {
  read: {
    label: 'Read',
    implies: ['read'],
    reversible: true,
    unsatisfiedDisposition: 'hold',
    rationale: 'Observation of a resource the plan did not declare.',
  },
  derive: {
    label: 'Derive',
    implies: ['derive', 'read'],
    reversible: true,
    unsatisfiedDisposition: 'hold',
    rationale: 'Creation of a derived artefact from a source resource.',
  },
  append: {
    label: 'Append',
    implies: ['append'],
    reversible: true,
    unsatisfiedDisposition: 'hold',
    rationale: 'Additive mutation of a record set.',
  },
  write: {
    label: 'Write',
    implies: ['write', 'append'],
    reversible: true,
    unsatisfiedDisposition: 'hold',
    rationale: 'Mutation of a system of record.',
  },
  delete: {
    label: 'Delete',
    implies: ['delete'],
    reversible: false,
    unsatisfiedDisposition: 'block',
    rationale: 'Irreversible destruction of a system of record.',
  },
  'transfer.external': {
    label: 'External transfer',
    implies: ['transfer.external'],
    reversible: false,
    unsatisfiedDisposition: 'hold',
    rationale: 'Data leaves the trust boundary and cannot be recalled.',
  },
  'privilege.modify': {
    label: 'Privilege change',
    implies: ['privilege.modify'],
    reversible: false,
    unsatisfiedDisposition: 'block',
    rationale: 'Alteration of the authority model that governs the agent itself.',
  },
};

/** Resource classes are hierarchical dotted paths. A grant covers its subtree. */
export const RESOURCE_CLASSES: Record<string, string> = {
  'finance.invoice.raw': 'Invoice documents as received',
  'finance.invoice.extracted': 'Structured fields derived from an invoice',
  'finance.invoice.status': 'Processing status of an invoice, without payment instrument data',
  'finance.vendor.registry': 'Approved vendor master data',
  'finance.ledger': 'Accounting system of record',
  'finance.archive': 'Immutable processed-document store',
  'finance.refund': 'Customer refund operations & payment gateway reversals',
  'finance.payment.verify': 'Payment gateway transaction settlement verification',
  'support.customer': 'Customer master record and identity details',
  'support.order': 'Order and item purchase history',
  'support.ticket': 'Support ticket system of record',
  'comm.customer': 'Customer communication channel (Email / SMS)',
  'identity.credentials': 'Secrets and credential material',
  'system.permissions': 'Authority and role assignments',
  'channel.external': 'Any egress channel leaving the trust boundary',
};

export type RiskTier = 'routine' | 'elevated' | 'critical';

export interface Requirement {
  effect: Effect;
  resource: string;
  /** Runtime facts the grant's constraints are evaluated against. */
  attributes?: Record<string, string[]>;
  /** Where this tuple came from - shown verbatim in the decision trace. */
  derivedFrom: string;
}

export interface Grant {
  effect: Effect;
  resource: string;
  /** Optional narrowing, e.g. { recipientDomain: ['*.acme-internal.example'], maxAmount: ['5000'] } */
  constraints?: Record<string, string[]>;
}

export interface CoverageResult {
  requirement: Requirement;
  covered: boolean;
  grantIndex?: number;
  grant?: Grant;
  failure?: 'no-grant' | 'constraint';
  failedConstraint?: { key: string; allowed: string[]; presented: string[] };
}

function effectCovers(grantEffect: Effect, required: Effect): boolean {
  return EFFECTS[grantEffect].implies.includes(required);
}

function resourceCovers(grantResource: string, required: string): boolean {
  if (grantResource === '*') return true;
  return required === grantResource || required.startsWith(`${grantResource}.`);
}

function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function constraintsSatisfied(
  grant: Grant,
  requirement: Requirement,
): { ok: true } | { ok: false; key: string; allowed: string[]; presented: string[] } {
  for (const [key, allowed] of Object.entries(grant.constraints ?? {})) {
    const presented = requirement.attributes?.[key] ?? [];
    if (presented.length === 0) return { ok: false, key, allowed, presented };

    // Check if numeric comparison: e.g. maxAmount, maxLimit, threshold
    const isNumericKey =
      key.toLowerCase().startsWith('max') ||
      key.toLowerCase().includes('limit') ||
      key.toLowerCase().includes('amount') ||
      key.toLowerCase().includes('threshold');

    if (isNumericKey) {
      const maxAllowed = Math.max(...allowed.map(Number).filter((n) => !Number.isNaN(n)));
      if (!Number.isNaN(maxAllowed) && Number.isFinite(maxAllowed)) {
        const anyExceeds = presented.some((val) => {
          const num = Number(val);
          return !Number.isNaN(num) && num > maxAllowed;
        });
        if (anyExceeds) {
          return { ok: false, key, allowed, presented };
        }
        continue;
      }
    }

    const every = presented.every((value) => allowed.some((pattern) => globMatch(pattern, value)));
    if (!every) return { ok: false, key, allowed, presented };
  }
  return { ok: true };
}

/** Evaluate one requirement against the grant set of a signed plan. */
export function coverRequirement(requirement: Requirement, grants: Grant[]): CoverageResult {
  let sawEffectAndResource = false;
  let nearMiss: CoverageResult | undefined;

  for (let i = 0; i < grants.length; i += 1) {
    const grant = grants[i];
    if (!effectCovers(grant.effect, requirement.effect)) continue;
    if (!resourceCovers(grant.resource, requirement.resource)) continue;
    sawEffectAndResource = true;
    const check = constraintsSatisfied(grant, requirement);
    if (check.ok) return { requirement, covered: true, grantIndex: i, grant };
    nearMiss = {
      requirement,
      covered: false,
      grantIndex: i,
      grant,
      failure: 'constraint',
      failedConstraint: { key: check.key, allowed: check.allowed, presented: check.presented },
    };
  }

  if (sawEffectAndResource && nearMiss) return nearMiss;
  return { requirement, covered: false, failure: 'no-grant' };
}

export function formatTuple(t: { effect: Effect; resource: string }): string {
  return `${t.effect} : ${t.resource}`;
}
