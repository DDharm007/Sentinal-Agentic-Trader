import { useState } from 'react';
import { api } from '../lib/api';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, Flow, Panel } from '../components/ui';
import { dateTimeOf, money } from '../lib/util';
import type { ThemeMode } from '../lib/util';

export function Architecture() {
  const { boot } = useControlPlane();
  const doc = boot?.sourceDocument ?? null;

  return (
    <div className="page">
      <PageHead
        title="System Architecture"
        description="One path from intent to action. The agent runtime holds no tool handles; every call is mediated."
      />

      <div className="grid split-graph">
        <Panel title="Enforcement path" sub="intent to audit">
          <ArchitectureDiagram />
        </Panel>

        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Why this is not keyword filtering" sub="three checks a judge can run live">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 12, fontSize: 12.5 }}>
              <li>
                <span className="strong">Same action, opposite outcomes.</span>{' '}
                <span className="muted">
                  <code className="tech">external.send</code> to the internal AP mailbox with a
                  posting receipt is ALLOWED. The same tool to an outside address carrying extracted
                  invoice fields is HELD. The engine never sees the tool name — it compares the
                  tuples the call consumes against the grants in the plan.
                </span>
              </li>
              <li>
                <span className="strong">A safe-sounding action can be held.</span>{' '}
                <span className="muted">
                  Probe <code className="tech">database.update</code> as the Vendor Reconciliation
                  Agent: its plan grants reads only, so a routine write is held. Authority is a
                  property of the plan, not of the verb.
                </span>
              </li>
              <li>
                <span className="strong">Tamper with the plan and everything stops.</span>{' '}
                <span className="muted">
                  Modify a signed plan on the Intent Plans page and even <code className="tech">invoice.read</code>{' '}
                  is blocked: an unverified plan confers no authority at all.
                </span>
              </li>
            </ol>
          </Panel>

          <Panel title="Decision inputs" sub="everything the engine is allowed to consider">
            <div className="stack" style={{ gap: 8 }}>
              <div className="tuple covered">signed plan document</div>
              <div className="tuple covered">signature validity and lifecycle state</div>
              <div className="tuple covered">capability tuples derived from the call arguments</div>
              <div className="tuple covered">data-provenance labels of referenced artefacts</div>
              <div className="tuple uncovered" style={{ opacity: 0.85 }}>
                tool name · prompt text · model output · document instructions
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                The last row lists inputs the engine deliberately ignores. Instructions found in
                documents are recorded as content in the audit trail and never treated as authority.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {doc ? (
        <Panel
          title="Source document"
          sub={`${doc.id} · the untrusted input that triggers the violation`}
          right={<Badge tone="hold">contains an embedded instruction</Badge>}
        >
          <div className="grid cols-2" style={{ gap: 18 }}>
            <dl className="kv">
              <dt>Invoice</dt>
              <dd className="tech">{doc.id}</dd>
              <dt>Vendor</dt>
              <dd>{doc.vendorName}</dd>
              <dt>Tax ID</dt>
              <dd className="tech">{doc.vendorTaxId}</dd>
              <dt>Amount</dt>
              <dd className="tech">{money(doc.amount, doc.currency)}</dd>
              <dt>PO</dt>
              <dd className="tech">{doc.poNumber}</dd>
              <dt>Bank reference</dt>
              <dd className="tech">{doc.bankAccount}</dd>
              <dt>Due</dt>
              <dd className="tech">{doc.dueAt}</dd>
            </dl>
            <div>
              <div className="section-title">Notes block, as received</div>
              <pre className="code" style={{ borderColor: 'color-mix(in srgb, var(--hold) 45%, var(--border))' }}>
                {doc.notes}
              </pre>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                The agent planner reads tool output, including this text, and emits a matching tool
                call. That call is a genuine action attempt against a real test-mode mail surface —
                it is stopped by authorization, not by refusing to generate it.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <Flow
        steps={[
          { label: 'USER INTENT' },
          { label: 'GOOGLE ADK AGENT' },
          { label: 'capture_plan()', tone: 'accent' },
          { label: 'SIGNED INTENT', tone: 'accent' },
          { label: 'AGENT ACTION' },
          { label: 'invoke()', tone: 'accent' },
          { label: 'ARMORIQ AUTHORIZATION', tone: 'accent' },
        ]}
      />
      <div className="flow-arrow" style={{ margin: '0 auto' }} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          width: '100%',
          maxWidth: 420,
          margin: '0 auto',
        }}
      >
        <div className="flow">
          <div className="flow-node allow">ALLOW</div>
          <div className="flow-arrow" />
          <div className="flow-node">MCP TOOL</div>
        </div>
        <div className="flow">
          <div className="flow-node hold">HOLD</div>
          <div className="flow-arrow" />
          <div className="flow-node">HUMAN APPROVAL</div>
        </div>
      </div>
      <div className="flow-arrow" style={{ margin: '0 auto' }} />
      <div className="flow">
        <div className="flow-node accent">AUDIT LOG</div>
      </div>
      <p className="faint" style={{ fontSize: 10.5, textAlign: 'center', marginTop: 12 }}>
        A held action re-enters authorization after approval; it is never handed to the tool on the
        strength of the approval alone.
      </p>
    </div>
  );
}

export function Settings({
  theme,
  onTheme,
}: {
  theme: ThemeMode;
  onTheme: (mode: ThemeMode) => void;
}) {
  const { boot, refresh } = useControlPlane();
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      await api.reset();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead title="Settings" description="Console preferences and control-plane identity." />

      <div className="grid cols-2">
        <Panel title="Appearance" sub="applies system-wide">
          <div className="stack">
            <div className="row">
              <span className="muted" style={{ fontSize: 12.5, minWidth: 90 }}>
                Theme
              </span>
              <div className="seg">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                  <button key={mode} aria-pressed={theme === mode} onClick={() => onTheme(mode)}>
                    {mode === 'light' ? '☀ Light' : mode === 'dark' ? '◐ Dark' : '⚙ System'}
                  </button>
                ))}
              </div>
            </div>
            <p className="faint" style={{ fontSize: 11 }}>
              System follows the operating system preference and updates without a reload.
            </p>
          </div>
        </Panel>

        <Panel title="Operator" sub="the identity recorded on approvals">
          <dl className="kv">
            <dt>Signed in as</dt>
            <dd className="tech">r.iyer@acme-internal.example</dd>
            <dt>Role</dt>
            <dd>Finance operations approver</dd>
            <dt>Environment</dt>
            <dd>{boot?.meta.environment}</dd>
            <dt>Gateway time</dt>
            <dd className="tech">{dateTimeOf(boot?.meta.serverTime)}</dd>
          </dl>
        </Panel>

        <Panel title="Plan signing" sub="integrity configuration">
          <dl className="kv">
            <dt>Algorithm</dt>
            <dd className="tech">{boot?.meta.signing.algorithm}</dd>
            <dt>Key ID</dt>
            <dd className="tech">{boot?.meta.signing.keyId}</dd>
            <dt>Custody</dt>
            <dd>{boot?.meta.signing.custody}</dd>
            <dt>Audit chain</dt>
            <dd>
              <Badge tone={boot?.audit.intact ? 'allow' : 'block'}>
                {boot?.audit.intact ? 'INTACT' : 'BROKEN'} · {boot?.audit.length ?? 0} entries
              </Badge>
            </dd>
          </dl>
        </Panel>

        <Panel title="Demo data" sub="reset the control plane">
          <div className="stack">
            <p className="muted" style={{ fontSize: 12 }}>
              Clears runs, approvals, the sandbox ledger, archive and outbox, re-issues every signed
              plan and regenerates today's history. Use this between demo passes.
            </p>
            <div className="row">
              <button className="btn danger" onClick={reset} disabled={busy}>
                {busy ? 'Resetting…' : 'Reset demo environment'}
              </button>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              {boot?.meta.dataNotice}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
