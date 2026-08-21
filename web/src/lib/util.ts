import { useEffect, useState } from 'react';
import type { Decision, ExecResult, Verification } from './types';

export function timeOf(iso?: string): string {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

export function dateTimeOf(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

export function relative(iso?: string): string {
  if (!iso) return '-';
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ms(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  if (value === 0) return '0 ms';
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function decisionTone(decision?: Decision | string): 'allow' | 'hold' | 'block' | '' {
  if (decision === 'ALLOWED') return 'allow';
  if (decision === 'HELD') return 'hold';
  if (decision === 'BLOCKED') return 'block';
  return '';
}

export function verificationTone(v?: Verification | string): 'allow' | 'hold' | 'block' | '' {
  if (v === 'VERIFIED') return 'allow';
  if (v === 'OUT_OF_SCOPE') return 'hold';
  if (v === 'INTEGRITY_FAILED' || v === 'REVOKED' || v === 'EXPIRED') return 'block';
  return '';
}

export function resultTone(r?: ExecResult | string): 'allow' | 'hold' | 'block' | '' {
  if (r === 'SUCCESS') return 'allow';
  if (r === 'PENDING') return 'hold';
  if (r === 'FAILED') return 'block';
  return '';
}

export function label(value: string): string {
  return value.replace(/_/g, ' ');
}

export function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0');
}

/** Hash router: #/route/param */
export function useRoute(): [string[], (path: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash.slice(2) || 'overview');

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash.slice(2) || 'overview');
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (path: string) => {
    window.location.hash = `#/${path.replace(/^\//, '')}`;
  };

  return [hash.split('/').filter(Boolean), navigate];
}

export type ThemeMode = 'light' | 'dark' | 'system';

export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem('sentinel.theme') as ThemeMode) || 'system',
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.themeMode = mode;
    };
    apply();
    localStorage.setItem('sentinel.theme', mode);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  return [mode, setMode];
}
