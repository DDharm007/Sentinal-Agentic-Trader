/**
 * ArmorIQ capture_plan() - the agent declares its intent BEFORE it acts.
 *
 * The returned document is hashed and signed. From that moment the plan is the
 * only source of authority the agent has: the gateway will not consult the
 * agent, the prompt, or the tool call itself for permission.
 */
import { digest, sign, verify, KEY_ID, ALGORITHM } from './signing.js';
import type { Grant } from './capabilities.js';
import type { PlanDocument, SignedPlan } from '../types.js';

const plans = new Map<string, SignedPlan>();

let planCounter = 0x92a6;
function nextPlanId(): string {
  planCounter += 1;
  return `PLN-${planCounter.toString(16).toUpperCase().padStart(4, '0')}`;
}

export interface CapturePlanInput {
  agentId: string;
  intent: string;
  grants: Grant[];
  declaredSteps: { tool: string; summary: string }[];
  ttlMinutes?: number;
  planId?: string;
  issuedAt?: string;
}

/** ArmorIQ SDK surface: capture_plan(). */
export function capturePlan(input: CapturePlanInput): SignedPlan {
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const document: PlanDocument = {
    planId: input.planId ?? nextPlanId(),
    agentId: input.agentId,
    intent: input.intent,
    grants: input.grants,
    declaredSteps: input.declaredSteps,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + (input.ttlMinutes ?? 120) * 60_000).toISOString(),
    version: 1,
    previousDigest: null,
  };
  return store(document);
}

/**
 * A human approval does not "let the action through". It mints a narrow,
 * single-use grant, appends it to the plan, and re-signs the document. The
 * agent then re-enters the SAME authorization path under plan v2.
 */
export function amendPlan(
  planId: string,
  amendment: {
    grants: Grant[];
    reason: string;
    approvalId: string;
    approver: string;
    singleUse?: boolean;
  },
): SignedPlan {
  const current = requirePlan(planId);
  const document: PlanDocument = {
    ...current.document,
    grants: [...current.document.grants, ...amendment.grants],
    version: current.document.version + 1,
    previousDigest: current.digest,
    amendment: {
      grants: amendment.grants,
      reason: amendment.reason,
      approvalId: amendment.approvalId,
      approver: amendment.approver,
      singleUse: amendment.singleUse ?? true,
    },
  };
  return store(document, { revokedAt: current.revokedAt ?? null });
}

/** Marks a single-use amendment grant as spent, and re-signs without it. */
export function consumeAmendment(planId: string): SignedPlan | null {
  const current = requirePlan(planId);
  const amendment = current.document.amendment;
  if (!amendment || !amendment.singleUse || current.consumedAmendment) return null;
  const grants = current.document.grants.filter((g) => !amendment.grants.includes(g));
  const document: PlanDocument = {
    ...current.document,
    grants,
    version: current.document.version + 1,
    previousDigest: current.digest,
  };
  const next = store(document, { revokedAt: current.revokedAt ?? null });
  next.consumedAmendment = true;
  return next;
}

export function revokePlan(planId: string): SignedPlan {
  const current = requirePlan(planId);
  current.revokedAt = new Date().toISOString();
  plans.set(planId, current);
  return current;
}

export function restorePlan(planId: string): SignedPlan {
  const current = requirePlan(planId);
  current.revokedAt = null;
  current.tampered = false;
  plans.set(planId, current);
  return current;
}

/**
 * Console-driven integrity test: mutate the plan body WITHOUT re-signing it.
 * Verification must then fail and every action under the plan must be blocked.
 */
export function tamperPlan(planId: string): SignedPlan {
  const current = requirePlan(planId);
  current.document.grants = [
    ...current.document.grants,
    { effect: 'transfer.external', resource: '*' },
  ];
  current.tampered = true;
  plans.set(planId, current);
  return current;
}

export function untamperPlan(planId: string): SignedPlan {
  const current = requirePlan(planId);
  if (!current.tampered) return current;
  current.document.grants = current.document.grants.filter(
    (g) => !(g.effect === 'transfer.external' && g.resource === '*'),
  );
  current.tampered = false;
  plans.set(planId, current);
  return current;
}

export function verifyPlan(plan: SignedPlan): { signatureValid: boolean; digestMatches: boolean } {
  const recomputed = digest(plan.document);
  return {
    signatureValid: verify(plan.document, plan.signature),
    digestMatches: recomputed === plan.digest,
  };
}

export function getPlan(planId: string): SignedPlan | undefined {
  return plans.get(planId);
}

export function requirePlan(planId: string): SignedPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Unknown plan ${planId}`);
  return plan;
}

export function listPlans(): SignedPlan[] {
  return [...plans.values()].sort((a, b) =>
    a.document.issuedAt < b.document.issuedAt ? 1 : -1,
  );
}

export function resetPlans(): void {
  plans.clear();
  planCounter = 0x92a6;
}

function store(document: PlanDocument, extra: Partial<SignedPlan> = {}): SignedPlan {
  const signed: SignedPlan = {
    document,
    digest: digest(document),
    signature: sign(document),
    keyId: KEY_ID,
    algorithm: ALGORITHM,
    tampered: false,
    revokedAt: null,
    ...extra,
  };
  plans.set(document.planId, signed);
  return signed;
}
