import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, Empty, Panel } from '../components/ui';
import { dateTimeOf } from '../lib/util';
import type { PlanView } from '../lib/types';

export function IntentPlans() {
  const { boot, refresh } = useControlPlane();
  const plans = boot?.plans ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId && plans.length) setSelectedId(plans.find((p) => p.planId === 'PLN-92A7')?.planId ?? plans[0].planId);
  }, [plans, selectedId]);

  const plan = plans.find((p) => p.planId === selectedId) ?? null;
  const agent = boot?.agents.find((a) => a.id === plan?.agentId) ?? null;

  const toggleIntegrity = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await api.planIntegrity(plan.planId, plan.tampered ? 'restore' : 'tamper');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Intent Plans"
        description="A plan is a signed statement of what an agent intends to do. It is captured before execution starts and it is the only source of authority the gateway will accept."
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(230px, 280px) minmax(0, 1fr)' }}>
        <Panel title="Plans" sub={`${plans.length} signed`} flush>
          <div>
            {plans.map((p) => (
              <button
                key={p.planId}
                className="nav-item"
                style={{ borderRadius: 0, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}
                aria-current={p.planId === selectedId}
                onClick={() => setSelectedId(p.planId)}
              >
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span className="tech strong">{p.planId}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {p.agentName}
                  </span>
                </span>
                <Badge tone={p.status === 'VERIFIED' ? 'allow' : 'block'}>v{p.version}</Badge>
              </button>
            ))}
          </div>
        </Panel>

        {!plan ? (
          <Panel title="Plan">
            <Empty>Select a plan.</Empty>
          </Panel>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            <Panel
              title={`Plan ${plan.planId}`}
              sub={`version ${plan.version}`}
              right={
                <>
                  <Badge tone={plan.status === 'VERIFIED' ? 'allow' : 'block'} dot>
                    Plan integrity {plan.status}
                  </Badge>
                  <button className="btn sm" onClick={toggleIntegrity} disabled={busy}>
                    {plan.tampered ? 'Restore signed plan' : 'Simulate plan tampering'}
                  </button>
                </>
              }
            >
              <div className="stack">
                <div>
                  <div className="section-title">Intent</div>
                  <blockquote
                    style={{
                      margin: 0,
                      paddingLeft: 12,
                      borderLeft: '2px solid var(--accent-line)',
                      fontSize: 13,
                      lineHeight: 1.65,
                    }}
                  >
                    {plan.intent}
                  </blockquote>
                </div>

                {plan.tampered ? (
                  <div className="notice danger">
                    <span>
                      <strong>Integrity failure.</strong> The plan body was modified after signing.
                      The HMAC no longer matches, so the gateway derives no authority from it — every
                      action by {plan.agentName} is now blocked, including ones the original plan
                      allowed.
                    </span>
                  </div>
                ) : null}

                {plan.amendment ? (
                  <div className="notice warn">
                    <span>
                      <strong>Amendment in force.</strong> {plan.amendment.reason}. Single-use grant{' '}
                      {plan.amendment.grants.map((g) => `${g.effect} : ${g.resource}`).join(', ')} added by{' '}
                      {plan.amendment.approver} (approval {plan.amendment.approvalId}).
                    </span>
                  </div>
                ) : null}

                <div className="grid cols-2" style={{ gap: 18 }}>
                  <div>
                    <div className="section-title">Authorized actions</div>
                    <div className="authority-list">
                      {plan.declaredSteps.map((step) => (
                        <div className="authority-item tech" key={step.tool + step.summary}>
                          <span className="mark">✓</span>
                          <span>{step.tool}</span>
                          <span className="muted" style={{ fontSize: 10.5 }}>
                            {step.summary}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="section-title">Unauthorized actions</div>
                    <div className="authority-list">
                      {(agent?.restricted ?? []).concat(
                        plan.planId === 'PLN-92A7' ? ['external.send → outside ap.acme-internal.example'] : [],
                      ).map((tool) => (
                        <div className="authority-item denied tech" key={tool}>
                          <span className="mark">×</span>
                          {tool}
                        </div>
                      ))}
                    </div>
                    <p className="faint" style={{ fontSize: 10.5, marginTop: 8 }}>
                      Action names are shown for readability. The gateway evaluates capability
                      tuples, not names — the same action can be authorized or held depending on its
                      arguments.
                    </p>
                  </div>
                </div>
              </div>
            </Panel>

            <div className="grid cols-2">
              <Panel title="Grants" sub="the authority this plan confers">
                <div className="stack">
                  {plan.grants.map((grant, i) => (
                    <div key={i} className="tuple covered" style={{ width: '100%' }}>
                      <span className="faint tech">#{i + 1}</span>
                      <span className="strong">{grant.effect}</span>
                      <span className="op">:</span>
                      <span>{grant.resource}</span>
                      {grant.constraints ? (
                        <span className="faint" style={{ fontSize: 10.5 }}>
                          {Object.entries(grant.constraints)
                            .map(([k, v]) => `${k} ∈ {${v.join(', ')}}`)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Technical metadata" sub="plan integrity record">
                <dl className="kv">
                  <dt>Plan ID</dt>
                  <dd className="tech">{plan.planId}</dd>
                  <dt>Agent ID</dt>
                  <dd className="tech">{plan.agentId}</dd>
                  <dt>Created</dt>
                  <dd className="tech">{dateTimeOf(plan.issuedAt)}</dd>
                  <dt>Expiration</dt>
                  <dd className="tech">{dateTimeOf(plan.expiresAt)}</dd>
                  <dt>Scope</dt>
                  <dd className="tech">{plan.grants.length} capability grants</dd>
                  <dt>Algorithm</dt>
                  <dd className="tech">{plan.algorithm}</dd>
                  <dt>Key</dt>
                  <dd className="tech">{plan.keyId}</dd>
                  <dt>Key custody</dt>
                  <dd>{plan.keyCustody}</dd>
                  <dt>Plan digest</dt>
                  <dd className="tech">{plan.digest.slice(0, 32)}…</dd>
                  <dt>Signature</dt>
                  <dd className="tech">{plan.signature.slice(0, 32)}…</dd>
                  <dt>Verification</dt>
                  <dd>
                    <Badge tone={plan.signatureValid && plan.digestMatches ? 'allow' : 'block'}>
                      {plan.signatureValid && plan.digestMatches ? 'SIGNATURE VALID' : 'SIGNATURE INVALID'}
                    </Badge>
                  </dd>
                  <dt>Chain</dt>
                  <dd className="tech">
                    {plan.previousDigest ? `supersedes ${plan.previousDigest.slice(0, 12)}…` : 'genesis version'}
                  </dd>
                  <dt>Status</dt>
                  <dd>
                    <Badge tone={plan.status === 'VERIFIED' ? 'allow' : 'block'}>{plan.status}</Badge>
                  </dd>
                </dl>
                <div className="divider" />
                <p className="faint" style={{ fontSize: 10.5 }}>
                  Signatures are computed with node:crypto over the canonical plan body. The signing
                  key is an in-process demo key; production deployments hold it in a KMS or HSM and
                  publish a verification key. Values above are live, not placeholders.
                </p>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
