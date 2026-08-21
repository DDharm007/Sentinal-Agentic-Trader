/**
 * Optional third-party API credentials.
 *
 * SENTINEL runs fully without any of these: enforcement decisions are made
 * locally by this gateway. Supplying a key only widens what the SDK pane can
 * prove - the ArmorIQ key enables the cloud proxy path, the Google key enables
 * live Gemini reasoning checks.
 *
 * Handling rules, deliberately narrow:
 *   - Secrets are never returned to the browser. The API exposes a masked hint
 *     and a boolean, nothing more.
 *   - Secrets are never written to the audit ledger, the SSE stream, or a log.
 *   - Keys entered in the console are persisted to a gitignored file at the
 *     repo root so a gateway restart does not lose them.
 *   - A key supplied through the environment always wins over a stored one, so
 *     CI and shell exports stay authoritative.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** server/src/store -> repo root */
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const STORE_FILE = join(REPO_ROOT, '.credentials.json');

export type ProviderId = 'armoriq' | 'google';

interface ProviderSpec {
  id: ProviderId;
  label: string;
  purpose: string;
  /** Environment variables consulted, in priority order. */
  envVars: string[];
  docsUrl: string;
  /** Returns an error string when the key is obviously malformed. */
  validate: (key: string) => string | null;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'armoriq',
    label: 'ArmorIQ',
    purpose:
      'Enables capture_plan() and invoke() against the ArmorIQ cloud proxy. Without it, SENTINEL still enforces locally and the cloud checks report as not configured.',
    envVars: ['ARMORIQ_API_KEY'],
    docsUrl: 'https://platform.armoriq.ai/dashboard/api-keys',
    validate: (key) =>
      /^ak_(live|claw|test)_/.test(key)
        ? null
        : "ArmorIQ keys start with 'ak_live_', 'ak_claw_' or 'ak_test_'.",
  },
  {
    id: 'google',
    label: 'Google Gemini',
    purpose:
      'Enables live Gemini calls for agent reasoning checks. Without it, the agent runs its scripted plan and the Gemini check reports as not configured.',
    envVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    validate: (key) =>
      key.length >= 20 ? null : 'That looks too short to be a Google AI Studio key.',
  },
];

const specOf = (id: ProviderId) => PROVIDERS.find((p) => p.id === id);

interface StoredCredential {
  apiKey: string;
  updatedAt: string;
}

type Store = Partial<Record<ProviderId, StoredCredential>>;

let store: Store = load();

function load(): Store {
  try {
    if (!existsSync(STORE_FILE)) return {};
    const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt store must not stop the gateway from booting.
    return {};
  }
}

function persist(): void {
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal: the key still applies for the life of this process.
  }
}

/** Last four characters only - enough to recognise a key, useless if leaked. */
function mask(key: string): string {
  const tail = key.slice(-4);
  return `${'•'.repeat(Math.min(Math.max(key.length - 4, 4), 20))}${tail}`;
}

function envValue(spec: ProviderSpec): { key: string; varName: string } | null {
  for (const varName of spec.envVars) {
    const key = process.env[varName];
    if (key && key.trim()) return { key: key.trim(), varName };
  }
  return null;
}

export interface CredentialStatus {
  id: ProviderId;
  label: string;
  purpose: string;
  docsUrl: string;
  envVars: string[];
  configured: boolean;
  /** 'env' when supplied by the environment, 'console' when entered in the UI. */
  source: 'env' | 'console' | null;
  hint: string | null;
  updatedAt: string | null;
  /** True when the environment wins, so the console field is read-only. */
  lockedByEnv: boolean;
}

/** Server-side only. Never send the result to a client. */
export function getCredential(id: ProviderId): string | null {
  const spec = specOf(id);
  if (!spec) return null;
  return envValue(spec)?.key ?? store[id]?.apiKey ?? null;
}

export function credentialStatus(): CredentialStatus[] {
  return PROVIDERS.map((spec) => {
    const fromEnv = envValue(spec);
    const stored = store[spec.id];
    const active = fromEnv?.key ?? stored?.apiKey ?? null;
    return {
      id: spec.id,
      label: spec.label,
      purpose: spec.purpose,
      docsUrl: spec.docsUrl,
      envVars: spec.envVars,
      configured: Boolean(active),
      source: fromEnv ? 'env' : stored ? 'console' : null,
      hint: active ? mask(active) : null,
      updatedAt: fromEnv ? null : (stored?.updatedAt ?? null),
      lockedByEnv: Boolean(fromEnv),
    };
  });
}

export function setCredential(id: ProviderId, apiKey: string): CredentialStatus[] {
  const spec = specOf(id);
  if (!spec) throw new Error(`Unknown provider: ${id}`);

  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('An API key is required.');

  const problem = spec.validate(trimmed);
  if (problem) throw new Error(problem);

  store = { ...store, [id]: { apiKey: trimmed, updatedAt: new Date().toISOString() } };
  persist();
  return credentialStatus();
}

export function clearCredential(id: ProviderId): CredentialStatus[] {
  if (!specOf(id)) throw new Error(`Unknown provider: ${id}`);
  const next = { ...store };
  delete next[id];
  store = next;
  persist();
  return credentialStatus();
}

/** Credentials shaped as environment variables for a spawned child process. */
export function credentialEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of PROVIDERS) {
    const key = getCredential(spec.id);
    if (key) for (const varName of spec.envVars) env[varName] = key;
  }
  return env;
}
