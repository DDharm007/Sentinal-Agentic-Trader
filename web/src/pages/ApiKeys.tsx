import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHead } from '../components/Shell';
import { Credentials } from '../components/Credentials';
import { Badge, Empty, Panel } from '../components/ui';
import type { CredentialStatus, ProviderId, SdkReport } from '../lib/types';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  armoriq: 'ArmorIQ cloud',
  google: 'Google Gemini',
};

function stateTone(state: string | undefined): 'allow' | 'block' | 'hold' {
  if (state === 'PASS') return 'allow';
  if (state === 'FAIL') return 'block';
  return 'hold';
}

function stateText(state: string | undefined): string {
  if (state === 'PASS') return 'Verified live';
  if (state === 'FAIL') return 'Key rejected';
  return 'Not configured';
}

export function ApiKeys({ navigate }: { navigate: (path: string) => void }) {
  const [providers, setProviders] = useState<CredentialStatus[]>([]);
  const [report, setReport] = useState<SdkReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (verify: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const [creds, sdk] = await Promise.all([
        api.credentials(),
        verify ? api.sdkSelfTest() : api.sdk(),
      ]);
      setProviders(creds);
      setReport(sdk);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  return (
    <div className="page">
      <PageHead
        title="API Keys"
        description="Optional credentials for third-party services. SENTINEL enforces every authorization decision locally, so both demo scenarios, the audit chain and the CLI agent work with none of these configured."
        actions={
          <button className="btn" onClick={() => void load(true)} disabled={busy}>
            {busy ? 'Verifying…' : 'Verify keys'}
          </button>
        }
      />

      {error ? <div className="notice danger">{error}</div> : null}

      <div className="grid split-graph align-start">
        <Panel title="Providers" sub="both optional" flush>
          {providers.length ? (
            <Credentials
              providers={providers}
              onChange={(next) => {
                setProviders(next);
                // Saving a key immediately checks it against the live service.
                void load(true);
              }}
            />
          ) : (
            <Empty>Loading providers…</Empty>
          )}
        </Panel>

        <div className="stack" style={{ gap: 18 }}>
          <Panel
            title="Live status"
            sub="last verification"
            right={
              <button className="btn sm" onClick={() => navigate('/sdk')}>
                Open SDK pane
              </button>
            }
          >
            <div className="stack" style={{ gap: 12 }}>
              {(['armoriq', 'google'] as ProviderId[]).map((id) => {
                const state = report?.summary.providers?.[id];
                const cred = providers.find((p) => p.id === id);
                return (
                  <div className="key-status" key={id}>
                    <div className="key-status-main">
                      <span className="strong">{PROVIDER_LABEL[id]}</span>
                      <span className="muted">
                        {cred?.configured
                          ? cred.source === 'env'
                            ? `Key from ${cred.envVars[0]}`
                            : `Key stored ${cred.hint ?? ''}`
                          : 'No key set'}
                      </span>
                    </div>
                    <Badge tone={stateTone(state)}>{stateText(state)}</Badge>
                  </div>
                );
              })}
            </div>
            <div className="divider" />
            <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              Verification is a real call to each provider — an ArmorIQ{' '}
              <code className="tech">bootstrap()</code> handshake and a Google model list. A wrong
              key surfaces the provider's own error rather than failing quietly. Full per-check
              detail lives in the SDK pane.
            </p>
          </Panel>

          <Panel title="How keys are handled" sub="what leaves this machine">
            <ul className="sdk-notes">
              <li>
                <span className="strong">Never sent back to this page.</span>{' '}
                <span className="muted">
                  The API returns a masked hint and a boolean. Once saved, a key cannot be read out
                  of the console.
                </span>
              </li>
              <li>
                <span className="strong">Stored server-side only.</span>{' '}
                <span className="muted">
                  Written to <code className="tech">.credentials.json</code> at the repo root with
                  owner-only permissions, and gitignored.
                </span>
              </li>
              <li>
                <span className="strong">Kept out of the evidence trail.</span>{' '}
                <span className="muted">
                  Keys are never written to the audit ledger, the live event stream, or any log.
                </span>
              </li>
              <li>
                <span className="strong">Sent only to their own provider.</span>{' '}
                <span className="muted">
                  The ArmorIQ key goes to the ArmorIQ proxy, the Google key to Google. Nothing is
                  forwarded anywhere else.
                </span>
              </li>
              <li>
                <span className="strong">The environment wins.</span>{' '}
                <span className="muted">
                  Exporting the variable before startup overrides anything entered here, and locks
                  the field so the two cannot disagree.
                </span>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
