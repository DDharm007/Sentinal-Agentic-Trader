import { useState } from 'react';
import { api } from '../lib/api';
import { Badge } from './ui';
import type { CredentialStatus, ProviderId } from '../lib/types';

/**
 * Optional API keys. Every provider here is additive - SENTINEL enforces
 * locally and runs both demo scenarios with none of them configured.
 *
 * The key is write-only from the browser's point of view: it is posted once and
 * never read back, so the field always starts empty and the stored value is
 * shown only as a masked hint.
 */
function ProviderRow({
  provider,
  onChange,
}: {
  provider: CredentialStatus;
  onChange: (next: CredentialStatus[]) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await api.setCredential(provider.id, value));
      setValue('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await api.clearCredential(provider.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cred-row">
      <div className="cred-head">
        <span className="strong">{provider.label}</span>
        {provider.configured ? (
          <Badge tone="allow" dot>
            {provider.source === 'env' ? 'From environment' : 'Configured'}
          </Badge>
        ) : (
          <Badge tone="">Optional — not set</Badge>
        )}
        <a className="link cred-docs" href={provider.docsUrl} target="_blank" rel="noreferrer">
          Get a key
        </a>
      </div>

      <p className="muted cred-purpose">{provider.purpose}</p>

      {provider.lockedByEnv ? (
        <div className="notice">
          <span>
            Set by <code className="tech">{provider.envVars[0]}</code> in the environment
            {provider.hint ? (
              <>
                {' '}
                (<span className="tech">{provider.hint}</span>)
              </>
            ) : null}
            . The environment wins, so this field is read-only. Unset the variable to manage the key
            here.
          </span>
        </div>
      ) : (
        <>
          <div className="cred-controls">
            <input
              className="btn cred-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                provider.configured ? `Stored ${provider.hint} — enter a new key to replace` : 'Paste API key'
              }
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim() && !busy) void save();
              }}
              disabled={busy}
            />
            <button
              className="btn primary"
              onClick={() => void save()}
              disabled={busy || !value.trim()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {provider.configured ? (
              <button className="btn danger" onClick={() => void clear()} disabled={busy}>
                Clear
              </button>
            ) : null}
          </div>
          <div className="cred-foot faint">
            Stored server-side in a gitignored file. Never returned to this page, never written to
            the audit ledger. Or export{' '}
            <code className="tech">{provider.envVars.join(' / ')}</code> instead.
          </div>
        </>
      )}

      {error ? <div className="notice danger cred-msg">{error}</div> : null}
      {saved ? (
        <div className="notice ok cred-msg">
          Saved. Run the self-test to check the key against the live service.
        </div>
      ) : null}
    </div>
  );
}

export function Credentials({
  providers,
  onChange,
}: {
  providers: CredentialStatus[];
  onChange: (next: CredentialStatus[]) => void;
}) {
  return (
    <div className="cred-list">
      {providers.map((p) => (
        <ProviderRow key={p.id} provider={p} onChange={onChange} />
      ))}
    </div>
  );
}

export const PROVIDER_ORDER: ProviderId[] = ['armoriq', 'google'];
