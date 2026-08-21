import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, DecisionBadge, Empty, Field, Panel, SidePanel } from '../components/ui';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { dateTimeOf, label, timeOf } from '../lib/util';
import type { AuditEvent, ExecutionRow } from '../lib/types';

const CATEGORIES = ['all', 'authorization', 'execution', 'approval', 'plan', 'agent', 'system'] as const;

export function AuditTrail() {
  const { audit, boot } = useControlPlane();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [linked, setLinked] = useState<ExecutionRow | null>(null);
  const [openExecution, setOpenExecution] = useState<string | null>(null);

  const rows = useMemo(
    () => (category === 'all' ? audit : audit.filter((e) => e.category === category)),
    [audit, category],
  );

  useEffect(() => {
    if (!selected) {
      setLinked(null);
      return;
    }
    let cancelled = false;
    api
      .auditEvent(selected.id)
      .then((d) => {
        if (!cancelled) setLinked(d.execution);
      })
      .catch(() => setLinked(null));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="page">
      <PageHead
        title="Authorization Audit Trail"
        description="Every decision, in order, hash-linked. Each entry commits to the digest of the entry before it, so the record cannot be edited after the fact without detection."
        actions={
          <span className="chip">
            <i className={`dot ${boot?.audit.intact ? 'allow' : 'block'}`} />
            Chain {boot?.audit.intact ? 'intact' : 'broken'} · {boot?.audit.length ?? 0} entries
          </span>
        }
      />

      <Panel
        title="Events"
        sub={`${rows.length} shown`}
        right={
          <div className="seg">
            {CATEGORIES.map((c) => (
              <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        }
        flush
      >
        <div className="table-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Time</th>
                <th>Category</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Plan</th>
                <th>Decision</th>
                <th>Verification</th>
                <th>Execution</th>
                <th>Human</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id} onClick={() => setSelected(event)} data-selected={selected?.id === event.id}>
                  <td className="tech faint">{event.seq}</td>
                  <td className="tech">{timeOf(event.at)}</td>
                  <td className="tech">{event.category}</td>
                  <td>{event.agentName ?? '—'}</td>
                  <td className="tech strong">{event.tool ?? '—'}</td>
                  <td className="tech">{event.planId ?? '—'}</td>
                  <td>{event.decision ? <DecisionBadge decision={event.decision} /> : '—'}</td>
                  <td className="tech">{event.verification ? label(event.verification) : '—'}</td>
                  <td className="tech">{event.execution ? label(event.execution) : '—'}</td>
                  <td className="tech">{event.humanDecision ?? '—'}</td>
                  <td>
                    <span className="link" style={{ fontSize: 11 }}>
                      View Full Event
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <Empty>No audit events in this category.</Empty> : null}
        </div>
      </Panel>

      {selected ? (
        <SidePanel
          title={selected.summary}
          sub={`${selected.id} · seq ${selected.seq} · ${dateTimeOf(selected.at)}`}
          onClose={() => setSelected(null)}
          footer={
            selected.executionId ? (
              <button
                className="btn"
                onClick={() => {
                  setOpenExecution(selected.executionId!);
                  setSelected(null);
                }}
              >
                Open authorization record
              </button>
            ) : undefined
          }
        >
          <div className="row">
            <Badge tone="plain">{selected.category}</Badge>
            {selected.decision ? <DecisionBadge decision={selected.decision} /> : null}
            {selected.seeded ? <Badge tone="plain">demo history</Badge> : null}
          </div>

          {selected.chain ? (
            <div>
              <div className="section-title">Decision chain</div>
              <ChainRow label="User intent" value={selected.chain.userIntent} />
              <ChainRow label="Declared plan" value={selected.chain.declaredPlan} tech />
              <ChainRow label="Agent" value={selected.chain.agent} tech />
              <ChainRow label="Requested action" value={selected.chain.requestedAction} tech />
              <ChainRow label="Verification" value={label(selected.chain.verification)} tech />
              <ChainRow label="Decision" value={selected.chain.decision} tech />
              <ChainRow label="Execution result" value={selected.chain.executionResult} tech />
              <ChainRow label="Human decision" value={selected.chain.humanDecision} tech last />
            </div>
          ) : null}

          <div>
            <div className="section-title">Entry integrity</div>
            <div className="approval-grid" style={{ padding: 0 }}>
              <Field label="Entry digest">{selected.entryDigest.slice(0, 24)}…</Field>
              <Field label="Previous digest">
                {selected.previousDigest ? `${selected.previousDigest.slice(0, 24)}…` : 'genesis entry'}
              </Field>
            </div>
          </div>

          {selected.detail ? (
            <div>
              <div className="section-title">Event detail</div>
              <pre className="code">{JSON.stringify(selected.detail, null, 2)}</pre>
            </div>
          ) : null}

          {linked ? (
            <div>
              <div className="section-title">Linked execution</div>
              <div className="approval-grid" style={{ padding: 0 }}>
                <Field label="Execution">{linked.id}</Field>
                <Field label="Resource">{linked.resource}</Field>
                <Field label="Result">{label(linked.result)}</Field>
                <Field label="Surface">{linked.surface}</Field>
              </div>
            </div>
          ) : null}
        </SidePanel>
      ) : null}

      {openExecution ? (
        <ExecutionPanel executionId={openExecution} onClose={() => setOpenExecution(null)} />
      ) : null}
    </div>
  );
}

function ChainRow({
  label: name,
  value,
  tech,
  last,
}: {
  label: string;
  value: string;
  tech?: boolean;
  last?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 2, marginBottom: last ? 0 : 6 }}>
      <span className="uc muted">{name}</span>
      <span className={tech ? 'tech' : ''} style={{ fontSize: 12.5 }}>
        {value}
      </span>
      {!last ? <span className="faint" style={{ fontSize: 11, lineHeight: 1 }}>↓</span> : null}
    </div>
  );
}
