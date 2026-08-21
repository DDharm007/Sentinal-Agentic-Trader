import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ExecutionRow } from '../lib/types';
import { CoverageList, DecisionBadge, Badge, Field, SidePanel, Trace } from './ui';
import { dateTimeOf, label, ms, resultTone, verificationTone } from '../lib/util';

export function ExecutionPanel({
  executionId,
  onClose,
}: {
  executionId: string;
  onClose: () => void;
}) {
  const [execution, setExecution] = useState<ExecutionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .execution(executionId)
      .then((row) => {
        if (!cancelled) setExecution(row);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  const auth = execution?.authorization;
  const resume = (execution as unknown as { resumeAuthorization?: typeof auth })?.resumeAuthorization;

  return (
    <SidePanel
      title={execution ? execution.tool : 'Execution'}
      sub={execution ? `${execution.id} · ${dateTimeOf(execution.startedAt)}` : executionId}
      onClose={onClose}
    >
      {error ? <div className="notice danger">{error}</div> : null}
      {!execution ? (
        <div className="muted">Loading execution record…</div>
      ) : (
        <>
          <div className="row">
            <DecisionBadge decision={execution.decision} />
            <Badge tone={verificationTone(execution.verification) || 'plain'}>
              {label(execution.verification)}
            </Badge>
            <Badge tone={resultTone(execution.result) || 'plain'}>{label(execution.result)}</Badge>
            {execution.origin === 'injected' ? <Badge tone="hold">Document-borne</Badge> : null}
            {execution.origin === 'operator' ? <Badge tone="info">Operator probe</Badge> : null}
            {execution.seeded ? <Badge tone="plain">Demo history</Badge> : null}
          </div>

          <div>
            <div className="section-title">Decision</div>
            <div className="notice">{auth?.reason}</div>
          </div>

          <div>
            <div className="section-title">Request</div>
            <div className="approval-grid" style={{ padding: 0 }}>
              <Field label="Agent">{execution.agentName}</Field>
              <Field label="Agent ID">{execution.agentId}</Field>
              <Field label="Tool surface">{execution.surface}</Field>
              <Field label="Resource">{execution.resource}</Field>
              <Field label="Plan">
                {execution.planId} v{execution.planVersion}
              </Field>
              <Field label="Authorization latency">{ms(execution.authorizationMs)}</Field>
              <Field label="Execution duration">
                {execution.result === 'SUCCESS' ? ms(execution.durationMs) : 'not executed'}
              </Field>
              <Field label="Risk tier">{auth?.riskTier ?? '-'}</Field>
            </div>
          </div>

          {execution.originNote ? (
            <div className="notice warn">
              <span>
                <strong>Origin.</strong> {execution.originNote}
              </span>
            </div>
          ) : null}

          <div>
            <div className="section-title">Capability coverage</div>
            {auth?.coverage?.length ? (
              <CoverageList coverage={auth.coverage} />
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                Not evaluated - the plan failed verification before capability derivation.
              </div>
            )}
          </div>

          <div>
            <div className="section-title">Authorization trace</div>
            {auth?.trace ? <Trace steps={auth.trace} durationMs={auth.durationMs} /> : null}
          </div>

          {resume ? (
            <div>
              <div className="section-title">Re-evaluation after human approval</div>
              <div className="notice ok">{resume.reason}</div>
              {resume.trace ? <Trace steps={resume.trace} durationMs={resume.durationMs} /> : null}
            </div>
          ) : null}

          <div>
            <div className="section-title">Arguments</div>
            <pre className="code">{JSON.stringify(execution.args, null, 2)}</pre>
          </div>

          {execution.output ? (
            <div>
              <div className="section-title">Tool result</div>
              <pre className="code">{JSON.stringify(execution.output, null, 2)}</pre>
            </div>
          ) : (
            <div>
              <div className="section-title">Tool result</div>
              <div className="notice danger">
                Nothing was forwarded to {execution.surface}. The action did not execute.
              </div>
            </div>
          )}
        </>
      )}
    </SidePanel>
  );
}
