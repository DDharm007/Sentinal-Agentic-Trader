import type { ReactNode } from 'react';
import { IconClose } from './icons';
import type { Coverage, Requirement, TraceStep, Tuple } from '../lib/types';
import { decisionTone, label, ms } from '../lib/util';

export function Panel({
  title,
  sub,
  right,
  children,
  flush,
  className,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {title !== undefined && (
        <div className="panel-head">
          <h2>
            {title}
            {sub ? <span className="sub">{sub}</span> : null}
          </h2>
          {right ? <div className="panel-head-right">{right}</div> : null}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Badge({
  tone = '',
  children,
  dot,
}: {
  tone?: 'allow' | 'hold' | 'block' | 'info' | 'plain' | '';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot ? <i className={`dot ${tone}`} /> : null}
      {children}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: string }) {
  return <Badge tone={decisionTone(decision) || 'plain'}>{label(decision)}</Badge>;
}

export function Field({ label: name, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{name}</span>
      <span className="value tech">{children}</span>
    </div>
  );
}

export function SidePanel({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="side-panel" role="dialog" aria-modal="true">
        <header>
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {sub ? (
              <div className="muted tech" style={{ fontSize: 11.5, marginTop: 2 }}>
                {sub}
              </div>
            ) : null}
          </div>
          <button className="btn icon sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer ? <div className="approval-actions">{footer}</div> : null}
      </aside>
    </>
  );
}

export function TupleChip({
  tuple,
  state,
}: {
  tuple: Tuple | Requirement;
  state?: 'covered' | 'uncovered';
}) {
  return (
    <span className={`tuple ${state ?? ''}`}>
      <span className="strong">{tuple.effect}</span>
      <span className="op">:</span>
      <span>{tuple.resource}</span>
    </span>
  );
}

export function CoverageList({ coverage }: { coverage: Coverage[] }) {
  return (
    <div className="tuple-list">
      {coverage.map((c, i) => (
        <div key={i} style={{ display: 'grid', gap: 3 }}>
          <TupleChip tuple={c.requirement} state={c.covered ? 'covered' : 'uncovered'} />
          <span className="faint" style={{ fontSize: 10.5, paddingLeft: 2 }}>
            {c.covered
              ? `covered by grant #${(c.grantIndex ?? 0) + 1}`
              : c.failure === 'constraint'
                ? `grant #${(c.grantIndex ?? 0) + 1} limits ${c.failedConstraint?.key} to ${c.failedConstraint?.allowed.join(', ')}`
                : 'no grant in the signed plan covers this tuple'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Trace({ steps, durationMs }: { steps: TraceStep[]; durationMs?: number }) {
  return (
    <div>
      <div className="trace">
        {steps.map((step, i) => (
          <div className="trace-step" key={step.key}>
            <span className={`trace-mark ${step.status}`}>
              {step.status === 'pass' ? '✓' : step.status === 'fail' ? '✕' : i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="trace-label">{step.label}</div>
              <div className="trace-detail">{step.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {durationMs !== undefined ? (
        <div className="faint tech" style={{ fontSize: 10.5 }}>
          Evaluated in {ms(durationMs)} · deterministic, no model inference in the decision path
        </div>
      ) : null}
    </div>
  );
}

export function Flow({
  steps,
}: {
  steps: { label: string; tone?: 'accent' | 'allow' | 'hold' | 'block' }[];
}) {
  return (
    <div className="flow">
      {steps.map((step, i) => (
        <div key={`${step.label}-${i}`} style={{ display: 'contents' }}>
          <div className={`flow-node ${step.tone ?? ''}`}>{step.label}</div>
          {i < steps.length - 1 ? <div className="flow-arrow" /> : null}
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' || status === 'CONNECTED'
      ? 'allow'
      : status === 'HOLDING' || status === 'PAUSED' || status === 'DEGRADED'
        ? 'hold'
        : status === 'REVOKED' || status === 'DISCONNECTED'
          ? 'block'
          : '';
  return <i className={`dot ${tone}`} />;
}
