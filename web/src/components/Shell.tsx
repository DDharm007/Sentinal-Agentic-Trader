import type { ReactNode } from 'react';
import {
  IconAgents,
  IconApprovals,
  IconArchitecture,
  IconAudit,
  IconExecutions,
  IconIntegrations,
  IconKey,
  IconMoon,
  IconOverview,
  IconPlans,
  IconPolicies,
  IconSdk,
  IconSettings,
  IconSun,
  IconSystem,
} from './icons';
import { useControlPlane } from '../lib/store';
import type { ThemeMode } from '../lib/util';

export interface NavEntry {
  id: string;
  label: string;
  icon: (p: { size?: number; className?: string }) => JSX.Element;
  group: 'Operations' | 'Governance' | 'System';
}

export const NAV: NavEntry[] = [
  { id: 'overview', label: 'Overview', icon: IconOverview, group: 'Operations' },
  { id: 'agents', label: 'Agents', icon: IconAgents, group: 'Operations' },
  { id: 'executions', label: 'Executions', icon: IconExecutions, group: 'Operations' },
  { id: 'approvals', label: 'Approvals', icon: IconApprovals, group: 'Operations' },
  { id: 'plans', label: 'Intent Plans', icon: IconPlans, group: 'Governance' },
  { id: 'audit', label: 'Audit Trail', icon: IconAudit, group: 'Governance' },
  { id: 'policies', label: 'Policies', icon: IconPolicies, group: 'Governance' },
  { id: 'sdk', label: 'ArmorIQ SDK', icon: IconSdk, group: 'System' },
  { id: 'api-keys', label: 'API Keys', icon: IconKey, group: 'System' },
  { id: 'integrations', label: 'Integrations', icon: IconIntegrations, group: 'System' },
  { id: 'architecture', label: 'Architecture', icon: IconArchitecture, group: 'System' },
  { id: 'settings', label: 'Settings', icon: IconSettings, group: 'System' },
];

export function Sidebar({
  active,
  onNavigate,
  theme,
  onTheme,
}: {
  active: string;
  onNavigate: (path: string) => void;
  theme: ThemeMode;
  onTheme: (mode: ThemeMode) => void;
}) {
  const { pendingApprovals, connected } = useControlPlane();
  const groups: NavEntry['group'][] = ['Operations', 'Governance', 'System'];

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <g transform="translate(16 16) scale(1.16) translate(-16 -16)">
            <path
              d="M16 4 26.7 8v8c0 5.6-4.3 10.1-10.7 12-6.4-1.9-10.7-6.4-10.7-12V8L16 4Z"
              fill="var(--accent)"
            />
            <path
              d="M11 16.2 14.6 19.8 21.2 12.6"
              fill="none"
              stroke="var(--sidebar)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
        <span className="brand-name">Sentinel</span>
        <span className="brand-env">Demo</span>
      </div>

      <nav className="nav">
        {groups.map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-label">{group}</div>
            {NAV.filter((entry) => entry.group === group).map((entry) => {
              const Icon = entry.icon;
              const isActive = active === entry.id;
              return (
                <button
                  key={entry.id}
                  className="nav-item"
                  aria-current={isActive}
                  onClick={() => onNavigate(entry.id)}
                  title={entry.label}
                >
                  <Icon className="nav-icon" />
                  <span>{entry.label}</span>
                  {entry.id === 'approvals' && pendingApprovals.length > 0 ? (
                    <em className="nav-count tech" style={{ fontStyle: 'normal' }}>
                      {pendingApprovals.length}
                    </em>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="nav-label" style={{ padding: 0 }}>
          System status
        </div>
        <div className="sysstatus">
          <i className={`dot ${connected ? 'allow pulse' : 'hold'}`} />
          <span>{connected ? 'All systems operational' : 'Reconnecting to gateway'}</span>
        </div>
        <div className="theme-switch" role="group" aria-label="Theme">
          <button aria-pressed={theme === 'light'} onClick={() => onTheme('light')} title="Light">
            <IconSun />
            <span>Light</span>
          </button>
          <button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')} title="Dark">
            <IconMoon />
            <span>Dark</span>
          </button>
          <button aria-pressed={theme === 'system'} onClick={() => onTheme('system')} title="System">
            <IconSystem />
            <span>Auto</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export function TopBar({ title, subtitle }: { title: string; subtitle: string }) {
  const { boot, connected, run } = useControlPlane();
  const running = run?.status === 'running' || run?.status === 'waiting-approval';

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="topbar-right">
        {running ? (
          <span className="chip">
            <i className="dot info pulse" style={{ color: 'var(--accent)' }} />
            <span className="tech">
              {run?.status === 'waiting-approval' ? 'Awaiting approval' : 'Run in progress'}
            </span>
          </span>
        ) : null}
        <span className="chip hide-sm">
          <i className={`dot ${connected ? 'allow' : 'hold'}`} />
          <span>{connected ? 'Operational' : 'Reconnecting'}</span>
        </span>
        <span className="chip hide-sm tech">Env · {boot?.meta.environment ?? 'Demo'}</span>
        <span className="avatar" title="Operator">
          RI
        </span>
      </div>
    </header>
  );
}

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </div>
  );
}
