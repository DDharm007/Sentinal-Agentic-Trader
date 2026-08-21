/**
 * SENTINEL / ArmorIQ - plan integrity primitives.
 *
 * These are REAL cryptographic operations (SHA-256 digest + HMAC-SHA256 signature)
 * computed by node:crypto over a canonical serialisation of the plan document.
 * The signing key is a DEMO key held in process memory. In production this key
 * lives in an HSM / KMS and plans are signed with an asymmetric key pair; the
 * verification path in `verify()` is identical either way.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const KEY_ID = 'sk_demo_sentinel_hs256_v1';
export const ALGORITHM = 'HMAC-SHA256';
export const KEY_CUSTODY = 'in-process demo key (non-production)';

const SIGNING_KEY = randomBytes(32);

/** Deterministic serialisation: object keys sorted at every depth. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function sign(value: unknown): string {
  return createHmac('sha256', SIGNING_KEY).update(canonicalize(value)).digest('hex');
}

export function verify(value: unknown, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(value), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Short, human-readable fingerprint used across the console UI. */
export function fingerprint(hex: string): string {
  return hex.slice(0, 8).toUpperCase().match(/.{1,4}/g)!.join(' ');
}
