import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHead } from '../components/Shell';
import { Badge, Empty, Panel } from '../components/ui';
import type { CredentialStatus, ProviderId, SdkCheck, SdkReport } from '../lib/types';
import { dateTimeOf } from '../lib/util';

const SCOPE_COPY: Record<string, string> = {
  local:
    'Runs entirely offline: plan shaping, deterministic plan hashing, canonical JSON and Ed25519 verification. No credentials, no network.',
  cloud:
    'Live calls to third-party services using the optional keys above. Each reports as not configured when no key is set, and fails loudly when a key is present but rejected.',
};

function toneOf(status: SdkCheck['status']): 'allow' | 'block' | 'hold' {
  if (status === 'PASS') return 'allow';
  if (status === 'FAIL') return 'block';
  return 'hold';
}

function statusLabel(status: SdkCheck['status']): string {
  if (status === 'NOT_CONFIGURED') return 'Not configured';
  return status === 'PASS' ? 'Pass' : 'Fail';
}

function CheckRow({ check }: { check: SdkCheck }) {
  const [open, setOpen] = useState(false);
  const hasEvidence = check.evidence !== null && check.evidence !== undefined;

  return (
    <div className="sdk-check" data-status={check.status}>
      <div className="sdk-check-head">
        <Badge tone={toneOf(check.status)}>{statusLabel(check.status)}</Badge>
        <div className="sdk-check-name">
          <span className="strong">{check.name}</span>
          <span className="muted">{check.detail}</span>
        </div>
        <span className="faint tech sdk-check-ms">{check.durationMs.toFixed(2)} ms</span>
        {hasEvidence ? (
          <button className="btn sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Evidence'}
          </button>
        ) : null}
      </div>
      {open && hasEvidence ? (
        <pre className="code sdk-evidence">{JSON.stringify(check.evidence, null, 2)}</pre>
      ) : null}
    </div>
  );
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  armoriq: 'ArmorIQ cloud',
  google: 'Google Gemini',
};

function providerTone(state: string | undefined): 'allow' | 'block' | 'hold' {
  if (state === 'PASS') return 'allow';
  if (state === 'FAIL') return 'block';
  return 'hold';
}

function providerText(state: string | undefined): string {
  if (state === 'PASS') return 'Live';
  if (state === 'FAIL') return 'Failing';
  return 'Not set';
}

export function ArmorIqSdk({ navigate }: { navigate: (path: string) => void }) {
  const [report, setReport] = useState<SdkReport | null>(null);
  const [providers, setProviders] = useState<CredentialStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const [next, creds] = await Promise.all([
        fresh ? api.sdkSelfTest() : api.sdk(),
        api.credentials(),
      ]);
      setReport(next);
      setProviders(creds);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const local = report?.checks.filter((c) => c.scope === 'local') ?? [];
  const cloud = report?.checks.filter((c) => c.scope === 'cloud') ?? [];
  const detected = report?.detected ?? false;

  return (
    <div className="page">
      <PageHead
        title="ArmorIQ SDK"
        description="The published armoriq-sdk package, exercised live in this environment. SENTINEL enforces in TypeScript; this pane proves the real SDK primitives agree with it."
        actions={
          <button className="btn primary" onClick={() => void load(true)} disabled={busy}>
            {busy ? 'Running…' : 'Run self-test'}
          </button>
        }
      />

      {error ? <div className="notice danger">{error}</div> : null}

      <div className="kpi-grid sdk-kpis">
        <div className="kpi">
          <div className="kpi-label">Package</div>
          <div className="kpi-value sdk-kpi-text">{report?.packageName ?? 'armoriq-sdk'}</div>
          <div className="kpi-foot">{detected ? 'Installed and importable' : 'Not detected'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Version</div>
          <div className={`kpi-value ${detected ? 'allow' : 'block'}`}>
            {report?.sdkVersion ?? '—'}
          </div>
          <div className="kpi-foot">Resolved from the running interpreter</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Local checks</div>
          <div
            className={`kpi-value ${report && report.summary.localPassed === report.summary.localTotal && report.summary.localTotal > 0 ? 'allow' : 'hold'}`}
          >
            {report ? `${report.summary.localPassed}/${report.summary.localTotal}` : '—'}
          </div>
          <div className="kpi-foot">Offline primitives, no credentials needed</div>
        </div>
        {(['armoriq', 'google'] as ProviderId[]).map((id) => {
          const state = report?.summary.providers?.[id];
          const cred = providers.find((p) => p.id === id);
          return (
            <div className="kpi" key={id}>
              <div className="kpi-label">{PROVIDER_LABEL[id]}</div>
              <div className={`kpi-value sdk-kpi-text ${providerTone(state)}`}>
                {providerText(state)}
              </div>
              <div className="kpi-foot">
                {cred?.configured
                  ? `Key ${cred.source === 'env' ? 'from environment' : 'configured'} — optional`
                  : 'Optional — add a key below'}
              </div>
            </div>
          );
        })}
      </div>

      {report && !detected ? (
        <Panel title="SDK not detected" sub="the pane could not reach a working interpreter">
          <div className="notice danger">{report.error}</div>
          {report.hint ? (
            <>
              <div className="section-title" style={{ marginTop: 14 }}>
                How to fix
              </div>
              <pre className="code">{report.hint}</pre>
            </>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title="API credentials"
        sub="both optional — the console works fully without them"
        right={
          <button className="btn sm" onClick={() => navigate('/api-keys')}>
            Manage API keys
          </button>
        }
      >
        <div className="cred-summary">
          {providers.map((p) => (
            <div className="cred-summary-item" key={p.id}>
              <Badge tone={p.configured ? 'allow' : ''} dot={p.configured}>
                {p.configured ? (p.source === 'env' ? 'From environment' : 'Configured') : 'Not set'}
              </Badge>
              <span className="strong">{p.label}</span>
              <span className="muted">
                {p.configured ? (p.hint ?? '') : 'Optional — the cloud checks below stay skipped'}
              </span>
            </div>
          ))}
          {providers.length === 0 ? <Empty>Loading providers…</Empty> : null}
        </div>
      </Panel>

      <div className="grid split-graph">
        <Panel
          title="Self-test"
          sub={report ? `checked ${dateTimeOf(report.checkedAt)}` : 'loading'}
          flush
        >
          {local.length === 0 && cloud.length === 0 ? (
            <Empty>{busy ? 'Running the SDK self-test…' : 'No checks have run yet.'}</Empty>
          ) : (
            <div className="sdk-checks">
              <div className="sdk-scope">
                <div className="section-title" style={{ margin: 0 }}>
                  Local — offline primitives
                </div>
                <p className="muted sdk-scope-copy">{SCOPE_COPY.local}</p>
              </div>
              {local.map((c) => (
                <CheckRow key={c.name} check={c} />
              ))}

              {cloud.length ? (
                <>
                  <div className="sdk-scope">
                    <div className="section-title" style={{ margin: 0 }}>
                      Cloud — live provider calls
                    </div>
                    <p className="muted sdk-scope-copy">{SCOPE_COPY.cloud}</p>
                  </div>
                  {cloud.map((c) => (
                    <CheckRow key={c.name} check={c} />
                  ))}
                </>
              ) : null}
            </div>
          )}
        </Panel>

        <div className="stack" style={{ gap: 18 }}>
          <Panel title="Interpreter" sub="where the SDK is running">
            {report?.interpreter ? (
              <dl className="kv">
                <dt>Executable</dt>
                <dd className="tech sdk-path">{report.interpreter.executable}</dd>
                <dt>Python</dt>
                <dd className="tech">{report.interpreter.python}</dd>
                <dt>Platform</dt>
                <dd className="tech">{report.interpreter.platform}</dd>
              </dl>
            ) : (
              <Empty>No interpreter resolved.</Empty>
            )}
          </Panel>

          <Panel title="What this proves" sub="and what it does not">
            <ul className="sdk-notes">
              <li>
                <span className="strong">The package is real.</span>{' '}
                <span className="muted">
                  <code className="tech">armoriq-sdk</code> is installed from PyPI and imported in
                  this process — not stubbed or vendored.
                </span>
              </li>
              <li>
                <span className="strong">Hashing is tamper-evident.</span>{' '}
                <span className="muted">
                  The plan hash is stable across runs and changes the moment the refund amount moves
                  from ₹5,000 to ₹25,000 — the same violation the refund demo holds.
                </span>
              </li>
              <li>
                <span className="strong">Signatures are enforced, not decorative.</span>{' '}
                <span className="muted">
                  A valid Ed25519 signature verifies, and the same signature is rejected once a
                  single field of the payload is edited.
                </span>
              </li>
              <li>
                <span className="strong">Cloud calls are out of scope here.</span>{' '}
                <span className="muted">
                  <code className="tech">capture_plan()</code> and{' '}
                  <code className="tech">invoke()</code> reach the ArmorIQ proxy and need an API
                  key. SENTINEL demonstrates the enforcement decision locally, so that path reports
                  as not configured rather than failing.
                </span>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
