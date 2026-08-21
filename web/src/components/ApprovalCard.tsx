import { useState } from 'react';
import { api } from '../lib/api';
import type { Approval } from '../lib/types';
import { Badge, CoverageList, Field } from './ui';
import { dateTimeOf, relative } from '../lib/util';

const APPROVER = 'r.iyer@acme-internal.example';

export function ApprovalCard({
  approval,
  onOpenExecution,
  onOpenIntent,
  compact,
}: {
  approval: Approval;
  onOpenExecution?: (id: string) => void;
  onOpenIntent?: (planId: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = approval.status === 'PENDING' && !outcome;

  const decide = async (verdict: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.decide(approval.id, verdict, APPROVER);
      setOutcome(result.status === 'APPROVED' ? 'APPROVED' : 'REJECTED');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const status = outcome ?? approval.status;

  return (
    <article className={`approval-card ${pending ? 'pending' : ''}`}>
      <div className="approval-head">
        <Badge tone={pending ? 'hold' : status === 'APPROVED' ? 'allow' : 'block'} dot>
          {pending ? 'Action held' : status}
        </Badge>
        <h2 style={{ fontSize: 13.5 }}>{approval.title}</h2>
        <span className="muted tech" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {relative(approval.requestedAt)}
        </span>
      </div>

      <div className="approval-grid">
        <Field label="Agent">{approval.agentName}</Field>
        <Field label="Requested action">{approval.tool}</Field>
        <Field label="Target">{approval.target}</Field>
        <Field label="Declared plan">{approval.planId}</Field>
        <Field label="Authorization">NOT PRESENT IN SIGNED PLAN</Field>
        <Field label="Verification">FAILED — OUT OF SCOPE</Field>
        <Field label="Execution">{status === 'APPROVED' ? 'EXECUTED AFTER APPROVAL' : 'NOT EXECUTED'}</Field>
        <Field label="Requested at">{dateTimeOf(approval.requestedAt)}</Field>
      </div>

      {!compact ? (
        <div style={{ padding: '0 16px 16px' }}>
          <div className="section-title">Reason</div>
          <div className="notice warn" style={{ marginBottom: 14 }}>
            {approval.reason}
          </div>

          <div className="section-title">Uncovered capability tuples</div>
          <CoverageList coverage={approval.unsatisfied} />

          {approval.contextPreview?.originNote ? (
            <>
              <div className="section-title" style={{ marginTop: 14 }}>
                Origin
              </div>
              <div className="notice">{String(approval.contextPreview.originNote)}</div>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '0 16px 12px' }}>
          <div className="notice danger">{error}</div>
        </div>
      ) : null}

      {outcome ? (
        <div style={{ padding: '0 16px 16px' }}>
          <div className={`result-banner ${outcome === 'APPROVED' ? 'ok' : 'stop'}`}>
            <strong className="uc" style={{ fontSize: 11 }}>
              {outcome === 'APPROVED' ? 'Approval granted' : 'Action rejected'}
            </strong>
            <span style={{ fontSize: 12 }}>
              {outcome === 'APPROVED'
                ? 'Plan amended with a single-use grant. Agent resumed and the action executed on the sandbox mail surface.'
                : 'Execution terminated safely. Nothing was forwarded to the tool surface.'}
            </span>
          </div>
        </div>
      ) : null}

      <div className="approval-actions">
        {pending ? (
          <>
            <button className="btn approve" disabled={busy} onClick={() => decide('APPROVE')}>
              Approve Once
            </button>
            <button className="btn danger" disabled={busy} onClick={() => decide('REJECT')}>
              Reject
            </button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {status === 'APPROVED'
              ? `Approved once by ${approval.decidedBy ?? APPROVER}`
              : status === 'REJECTED'
                ? `Rejected by ${approval.decidedBy ?? APPROVER}`
                : 'Approval window elapsed — action discarded'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {onOpenIntent ? (
            <button className="btn sm" onClick={() => onOpenIntent(approval.planId)}>
              View Intent
            </button>
          ) : null}
          {onOpenExecution ? (
            <button className="btn sm" onClick={() => onOpenExecution(approval.executionId)}>
              View Execution Context
            </button>
          ) : null}
        </span>
      </div>
    </article>
  );
}
