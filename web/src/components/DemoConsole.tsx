import { useState } from 'react';
import { api } from '../lib/api';
import { useControlPlane } from '../lib/store';
import type { Authorization, ExecutionRow } from '../lib/types';
import { Badge, DecisionBadge, Panel, TupleChip } from './ui';
import { IconAlert, IconPlay, IconRefresh } from './icons';
import { ms } from '../lib/util';

const REFUND_STEPS = [
  'capture_plan() - intent signed (limit: ≤ ₹5,000)',
  'customer.get - retrieve customer profile',
  'order.get - inspect order & damage reports',
  'payment.verify - validate gateway settlement',
  'refund.issue - attempt ₹25,000 refund (out-of-scope)',
  'ticket.update - record resolution & reference',
  'notification.send - customer confirmation',
];

const INVOICE_STEPS = [
  'capture_plan() - intent signed',
  'invoice.read - source document',
  'invoice.extract - structured fields',
  'vendor.verify - approved registry',
  'database.update - ledger posting',
  'external.send - internal AP mailbox',
  'external.send - document-borne instruction',
  'invoice.archive - retention store',
];

const PROBE_TOOLS = [
  { id: 'refund.issue', label: 'refund.issue (Monetary check)' },
  { id: 'external.send', label: 'external.send (Domain check)' },
  { id: 'database.delete', label: 'database.delete' },
  { id: 'permission.modify', label: 'permission.modify' },
  { id: 'database.update', label: 'database.update' },
  { id: 'customer.get', label: 'customer.get' },
];

const RECIPIENTS = [
  { id: 'external-review@example.com', label: 'external-review@example.com (outside boundary)' },
  {
    id: 'accounts-payable@ap.acme-internal.example',
    label: 'accounts-payable@ap.acme-internal.example (internal AP)',
  },
];

const PAYLOADS = [
  { id: 'extracted', label: 'Extracted invoice fields (finance.invoice.extracted)' },
  { id: 'status', label: 'Posting receipt (finance.invoice.status)' },
  { id: 'none', label: 'No attachment' },
];

export function DemoConsole({ onOpenExecution }: { onOpenExecution: (id: string) => void }) {
  const { run, refresh } = useControlPlane();
  const [scenario, setScenario] = useState<'refund' | 'invoice'>('refund');
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState(PROBE_TOOLS[0].id);
  const [probeAmount, setProbeAmount] = useState<number>(25000);
  const [recipient, setRecipient] = useState(RECIPIENTS[0].id);
  const [payload, setPayload] = useState<'extracted' | 'status' | 'none'>('extracted');
  const [probe, setProbe] = useState<{ execution: ExecutionRow; authorization: Authorization } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const running = run?.status === 'running' || run?.status === 'waiting-approval';
  const activeStep = run ? run.currentStep : -1;
  const isCurrentRunRefund = run?.agentId?.includes('refund') || run?.scenario?.includes('Refund');
  const steps = (running || run) ? (isCurrentRunRefund ? REFUND_STEPS : INVOICE_STEPS) : (scenario === 'refund' ? REFUND_STEPS : INVOICE_STEPS);

  const runDemo = async () => {
    setBusy('run');
    setError(null);
    try {
      await api.runDemo(scenario, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runProbe = async () => {
    setBusy('probe');
    setError(null);
    try {
      const result = await api.probe({
        tool,
        amount: tool === 'refund.issue' ? probeAmount : undefined,
        to: recipient,
        attach: tool === 'external.send' ? payload : 'none',
      });
      setProbe({ execution: result.execution, authorization: result.authorization });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    setProbe(null);
    try {
      await api.reset();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Demo Control Center"
      sub={scenario === 'refund' ? 'Customer Refund Operations — Monetary Limit Gating' : 'Invoice Processing — Exfiltration Gating'}
      right={
        <>
          <button className="btn sm" onClick={reset} disabled={busy !== null || running}>
            <IconRefresh />
            Reset
          </button>
          <button className="btn primary sm" onClick={runDemo} disabled={busy !== null || running}>
            <IconPlay />
            {running ? 'Running…' : 'Run Demo'}
          </button>
        </>
      }
    >
      <div className="stack">
        {error ? <div className="notice danger">{error}</div> : null}

        <div className="row" style={{ gap: 8 }}>
          <button
            className={`btn sm ${scenario === 'refund' ? 'primary' : ''}`}
            onClick={() => setScenario('refund')}
            disabled={running}
          >
            Scenario 1: Customer Refund (₹5,000 Limit)
          </button>
          <button
            className={`btn sm ${scenario === 'invoice' ? 'primary' : ''}`}
            onClick={() => setScenario('invoice')}
            disabled={running}
          >
            Scenario 2: Invoice Exfiltration
          </button>
        </div>

        <div className="step-list">
          {steps.map((step, index) => {
            const done = activeStep > index || run?.status === 'completed';
            const active = activeStep === index;
            return (
              <div className="step" key={step} data-active={active} data-done={done}>
                <span className="step-n tech">{done ? '✓' : index}</span>
                <span className={active ? 'strong' : 'muted'}>{step}</span>
                {active && run?.status === 'waiting-approval' ? (
                  <Badge tone="hold">Held</Badge>
                ) : active ? (
                  <Badge tone="info">Running</Badge>
                ) : null}
              </div>
            );
          })}
        </div>

        {run?.note ? (
          <div
            className={`notice ${
              run.status === 'waiting-approval'
                ? 'warn'
                : run.status === 'terminated'
                  ? 'danger'
                  : run.status === 'completed'
                    ? 'ok'
                    : ''
            }`}
          >
            <span>{run.note}</span>
          </div>
        ) : null}

        <div className="divider" />

        <div>
          <div className="section-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconAlert size={13} /> Simulate scope violation
            </span>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
            Send any action through the same gateway the agent uses. The engine derives the
            capability tuples from the arguments and checks them against the signed plan — it never
            looks at the action name.
          </p>

          <div className="grid" style={{ gap: 8 }}>
            <label className="stack" style={{ gap: 4 }}>
              <span className="label uc muted">Action</span>
              <select className="btn" style={{ width: '100%' }} value={tool} onChange={(e) => setTool(e.target.value)}>
                {PROBE_TOOLS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            {tool === 'external.send' ? (
              <>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="label uc muted">Recipient</span>
                  <select
                    className="btn"
                    style={{ width: '100%' }}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  >
                    {RECIPIENTS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="label uc muted">Payload provenance</span>
                  <select
                    className="btn"
                    style={{ width: '100%' }}
                    value={payload}
                    onChange={(e) => setPayload(e.target.value as 'extracted' | 'status' | 'none')}
                  >
                    {PAYLOADS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <button className="btn" onClick={runProbe} disabled={busy !== null}>
              {busy === 'probe' ? 'Evaluating…' : 'Run authorization check'}
            </button>
          </div>
        </div>

        {probe ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <DecisionBadge decision={probe.execution.decision} />
              <span className="tech muted" style={{ fontSize: 11 }}>
                {probe.execution.tool} · {ms(probe.execution.authorizationMs)}
              </span>
              <button
                className="link"
                style={{ marginLeft: 'auto', fontSize: 11.5, background: 'none', border: 0 }}
                onClick={() => onOpenExecution(probe.execution.id)}
              >
                View full decision
              </button>
            </div>
            <div className="notice">{probe.authorization.reason}</div>
            {probe.authorization.unsatisfied?.length ? (
              <div className="tuple-list">
                {probe.authorization.unsatisfied.map((c, i) => (
                  <TupleChip key={i} tuple={c.requirement} state="uncovered" />
                ))}
              </div>
            ) : (
              <div className="tuple-list">
                {(probe.authorization.requirements ?? []).map((r, i) => (
                  <TupleChip key={i} tuple={r} state="covered" />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
