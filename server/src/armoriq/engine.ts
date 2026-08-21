/**
 * ArmorIQ authorization engine.
 *
 * Every decision returned by this module is a function of exactly four inputs:
 *   - the signed plan document,
 *   - its signature validity and lifecycle state,
 *   - the capability tuples the requested action requires at runtime,
 *   - the grant set inside the plan.
 *
 * There is no allow-list of tool names, no deny-list, and no branch anywhere in
 * this file that tests a specific action identifier.
 */
import { coverRequirement, EFFECTS, formatTuple } from './capabilities.js';
import type { CoverageResult, Requirement, RiskTier } from './capabilities.js';
import { verifyPlan } from './plan.js';
import type { AuthorizationDecision, DecisionStep, SignedPlan } from '../types.js';

export interface AuthorizeInput {
  plan: SignedPlan;
  agentId: string;
  tool: string;
  requirements: Requirement[];
  riskTier: RiskTier;
  now?: Date;
}

export function authorize(input: AuthorizeInput): AuthorizationDecision {
  const startedAt = process.hrtime.bigint();
  const now = input.now ?? new Date();
  const { plan, requirements } = input;
  const trace: DecisionStep[] = [];

  const base = {
    requirements,
    planId: plan.document.planId,
    planVersion: plan.document.version,
    planDigest: plan.digest,
    riskTier: input.riskTier,
    evaluatedAt: now.toISOString(),
  };

  const finish = (
    partial: Omit<AuthorizationDecision, keyof typeof base | 'trace' | 'durationMs'>,
  ): AuthorizationDecision => ({
    ...base,
    ...partial,
    trace,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
  });

  // 1 - PLAN BINDING -------------------------------------------------------
  const boundToAgent = plan.document.agentId === input.agentId;
  trace.push({
    key: 'binding',
    label: 'Plan binding',
    detail: boundToAgent
      ? `Plan ${plan.document.planId} v${plan.document.version} is bound to caller ${input.agentId}.`
      : `Plan ${plan.document.planId} is bound to ${plan.document.agentId}, caller is ${input.agentId}.`,
    status: boundToAgent ? 'pass' : 'fail',
  });

  // 2 - INTEGRITY ----------------------------------------------------------
  const integrity = verifyPlan(plan);
  const integrityOk = integrity.signatureValid && integrity.digestMatches;
  trace.push({
    key: 'integrity',
    label: 'Plan integrity',
    detail: integrityOk
      ? `${plan.algorithm} signature verified against the canonical plan body (key ${plan.keyId}).`
      : `${plan.algorithm} signature does not match the plan body. The plan was altered after signing.`,
    status: integrityOk ? 'pass' : 'fail',
  });

  if (!boundToAgent || !integrityOk) {
    return finish({
      decision: 'BLOCKED',
      verification: 'INTEGRITY_FAILED',
      reason: boundToAgent
        ? 'Plan signature verification failed. No authority can be derived from an unverified plan.'
        : 'Plan is bound to a different agent identity.',
      coverage: [],
      unsatisfied: [],
      signatureValid: integrity.signatureValid && boundToAgent,
    });
  }

  // 3 - LIFECYCLE ----------------------------------------------------------
  const revoked = Boolean(plan.revokedAt);
  const expired = new Date(plan.document.expiresAt).getTime() <= now.getTime();
  trace.push({
    key: 'lifecycle',
    label: 'Plan lifecycle',
    detail: revoked
      ? `Plan revoked at ${plan.revokedAt}.`
      : expired
        ? `Plan expired at ${plan.document.expiresAt}.`
        : `Plan active until ${plan.document.expiresAt}.`,
    status: revoked || expired ? 'fail' : 'pass',
  });

  if (revoked || expired) {
    return finish({
      decision: 'BLOCKED',
      verification: revoked ? 'REVOKED' : 'EXPIRED',
      reason: revoked
        ? 'Authority for this agent has been revoked by an operator.'
        : 'The signed plan is no longer within its validity window.',
      coverage: [],
      unsatisfied: [],
      signatureValid: true,
    });
  }

  // 4 - REQUIREMENT DERIVATION --------------------------------------------
  trace.push({
    key: 'requirements',
    label: 'Capability derivation',
    detail: requirements.length
      ? requirements.map((r) => `${formatTuple(r)}   from ${r.derivedFrom}`).join('\n')
      : 'Action consumes no capabilities.',
    status: 'info',
  });

  // 5 - COVERAGE -----------------------------------------------------------
  const coverage: CoverageResult[] = requirements.map((requirement) =>
    coverRequirement(requirement, plan.document.grants),
  );
  const unsatisfied = coverage.filter((c) => !c.covered);

  trace.push({
    key: 'coverage',
    label: 'Grant coverage',
    detail: coverage
      .map((c) => {
        const tuple = formatTuple(c.requirement);
        if (c.covered) {
          const idx = (c.grantIndex ?? 0) + 1;
          return `COVERED     ${tuple}   by grant #${idx} ${formatTuple(c.grant!)}`;
        }
        if (c.failure === 'constraint') {
          const idx = (c.grantIndex ?? 0) + 1;
          const fc = c.failedConstraint!;
          return `CONSTRAINED ${tuple}   grant #${idx} limits ${fc.key} to [${fc.allowed.join(', ')}], presented [${fc.presented.join(', ')}]`;
        }
        return `UNCOVERED   ${tuple}   no grant in plan ${plan.document.planId} covers this tuple`;
      })
      .join('\n'),
    status: unsatisfied.length === 0 ? 'pass' : 'fail',
  });

  const amendmentGrants = plan.document.amendment?.grants ?? [];
  const amendmentUsed = coverage.some(
    (c) => c.covered && c.grant !== undefined && amendmentGrants.includes(c.grant),
  );

  if (unsatisfied.length === 0) {
    trace.push({
      key: 'disposition',
      label: 'Disposition',
      detail: `All ${coverage.length} required capability tuple(s) are covered by the signed plan. The action proceeds to the tool surface.`,
      status: 'pass',
    });
    return finish({
      decision: 'ALLOWED',
      verification: 'VERIFIED',
      reason: amendmentUsed
        ? 'Covered by a single-use grant added to the plan by human approval.'
        : 'Every capability required by this action is present in the signed plan.',
      coverage,
      unsatisfied: [],
      signatureValid: true,
      amendmentUsed,
    });
  }

  // 6 - DISPOSITION OF UNSATISFIED TUPLES ---------------------------------
  const blocking = unsatisfied.find(
    (c) => EFFECTS[c.requirement.effect].unsatisfiedDisposition === 'block',
  );
  const decision = blocking ? 'BLOCKED' : 'HELD';
  const driver = blocking ?? unsatisfied[0];
  const meta = EFFECTS[driver.requirement.effect];

  trace.push({
    key: 'disposition',
    label: 'Disposition',
    detail: `${unsatisfied.length} tuple(s) uncovered. The governing effect "${meta.label}" is ${meta.reversible ? 'reversible' : 'irreversible'}; the policy disposition for an uncovered ${meta.label.toLowerCase()} is ${meta.unsatisfiedDisposition.toUpperCase()}. ${meta.rationale}`,
    status: 'fail',
  });

  const constraintReason = () => {
    const fc = driver.failedConstraint!;
    return `The plan grants ${formatTuple(driver.grant!)} but constrains ${fc.key} to [${fc.allowed.join(', ')}]. The requested value falls outside that boundary.`;
  };

  return finish({
    decision,
    verification: 'OUT_OF_SCOPE',
    reason:
      driver.failure === 'constraint'
        ? constraintReason()
        : `The signed plan does not authorize ${formatTuple(driver.requirement)}. ${meta.rationale}`,
    coverage,
    unsatisfied,
    signatureValid: true,
  });
}
