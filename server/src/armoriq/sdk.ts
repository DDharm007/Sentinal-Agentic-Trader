/**
 * ArmorIQ SDK bridge.
 *
 * SENTINEL's enforcement plane is TypeScript, but the published ArmorIQ SDK is
 * a Python package. This module detects the interpreter that has the SDK
 * installed and runs `sdk_selftest.py`, so the console can show whether the
 * real SDK is present and which half of it is usable here:
 *
 *   local - plan hashing, canonical JSON, Ed25519 verification (no credentials)
 *   cloud - capture_plan()/invoke() through the ArmorIQ proxy (needs an API key)
 *
 * The self-test is spawned, never imported, so a broken or missing Python
 * environment degrades to a reported status instead of taking the gateway down.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialEnv } from '../store/credentials.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** server/src/armoriq -> repo root */
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const SELFTEST = join(REPO_ROOT, 'sdk_selftest.py');
const TIMEOUT_MS = 30_000;

export interface SdkCheck {
  name: string;
  scope: 'local' | 'cloud';
  status: 'PASS' | 'FAIL' | 'NOT_CONFIGURED';
  detail: string;
  durationMs: number;
  evidence?: unknown;
}

export interface SdkReport {
  ok: boolean;
  detected: boolean;
  sdkVersion: string | null;
  packageName: string;
  checkedAt: string;
  interpreter: { executable: string; python: string; platform: string } | null;
  summary: { localPassed: number; localTotal: number; cloudConfigured: boolean };
  checks: SdkCheck[];
  /** Set when the SDK or its interpreter could not be found at all. */
  error?: string;
  hint?: string;
}

/** Interpreters to try, most specific first: the project venv, then the PATH. */
function candidates(): string[] {
  const venv = [
    join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'),
    join(REPO_ROOT, '.venv', 'bin', 'python3'),
    join(REPO_ROOT, '.venv', 'bin', 'python'),
  ].filter((p) => existsSync(p));
  return [...venv, 'python3', 'python'];
}

function runSelfTest(executable: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, [SELFTEST], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // Keys configured in the console reach the self-test the same way an
        // exported environment variable would.
        ...credentialEnv(),
        // Force UTF-8 so the report survives a legacy Windows console codepage.
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      err += `\nself-test exceeded ${TIMEOUT_MS}ms`;
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, out, err: err + String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, out, err });
    });
  });
}

function notDetected(error: string, hint: string): SdkReport {
  return {
    ok: false,
    detected: false,
    sdkVersion: null,
    packageName: 'armoriq-sdk',
    checkedAt: new Date().toISOString(),
    interpreter: null,
    summary: { localPassed: 0, localTotal: 0, cloudConfigured: false },
    checks: [],
    error,
    hint,
  };
}

let cached: SdkReport | null = null;

/**
 * Runs the SDK self-test. Every candidate interpreter is tried; the first one
 * that produces a parseable report wins, so a stale global `python` on PATH
 * cannot mask a working project venv.
 */
export async function runSdkSelfTest(): Promise<SdkReport> {
  if (!existsSync(SELFTEST)) {
    cached = notDetected(
      `sdk_selftest.py not found at ${SELFTEST}`,
      'The self-test script ships at the repository root - restore it to re-enable this pane.',
    );
    return cached;
  }

  const attempts: string[] = [];
  for (const executable of candidates()) {
    const { code, out, err } = await runSelfTest(executable);
    const start = out.indexOf('{');
    if (start >= 0) {
      try {
        const parsed = JSON.parse(out.slice(start)) as Omit<SdkReport, 'detected' | 'packageName'>;
        cached = { ...parsed, detected: true, packageName: 'armoriq-sdk' };
        return cached;
      } catch {
        attempts.push(`${executable}: report was not valid JSON`);
        continue;
      }
    }
    attempts.push(`${executable}: exit ${code} ${(err || out).trim().split('\n')[0] ?? ''}`.trim());
  }

  cached = notDetected(
    `No Python interpreter could run the ArmorIQ SDK self-test. Tried - ${attempts.join(' | ')}`,
    'Create the environment with: python -m venv .venv && .venv/Scripts/python.exe -m pip install armoriq-sdk==0.6.2',
  );
  return cached;
}

/** Last report, or a fresh run when nothing has been checked yet. */
export async function sdkStatus(): Promise<SdkReport> {
  return cached ?? runSdkSelfTest();
}

/** Called when credentials change so the next read re-runs against them. */
export function invalidateSdkCache(): void {
  cached = null;
}
