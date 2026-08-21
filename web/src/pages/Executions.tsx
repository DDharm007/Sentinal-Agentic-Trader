import { useMemo, useState } from 'react';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, DecisionBadge, Empty, Panel } from '../components/ui';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { label, ms, timeOf } from '../lib/util';

const FILTERS = ['All', 'Allowed', 'Held', 'Blocked', 'Failed'] as const;

export function Executions() {
  const { executions } = useControlPlane();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    let list = executions;
    if (filter === 'Allowed') list = list.filter((e) => e.decision === 'ALLOWED');
    if (filter === 'Held') list = list.filter((e) => e.decision === 'HELD');
    if (filter === 'Blocked') list = list.filter((e) => e.decision === 'BLOCKED');
    if (filter === 'Failed') list = list.filter((e) => e.result === 'FAILED');
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.tool.toLowerCase().includes(q) ||
          e.agentName.toLowerCase().includes(q) ||
          e.resource.toLowerCase().includes(q),
      );
    }
    return list;
  }, [executions, filter, query]);

  const counts = useMemo(
    () => ({
      All: executions.length,
      Allowed: executions.filter((e) => e.decision === 'ALLOWED').length,
      Held: executions.filter((e) => e.decision === 'HELD').length,
      Blocked: executions.filter((e) => e.decision === 'BLOCKED').length,
      Failed: executions.filter((e) => e.result === 'FAILED').length,
    }),
    [executions],
  );

  return (
    <div className="page">
      <PageHead
        title="Executions"
        description="Every action that reached the gateway, whether or not it reached a tool. Select a row for the full authorization record."
      />

      <Panel
        title="Execution history"
        sub={`${rows.length} of ${executions.length} records`}
        right={
          <>
            <input
              className="btn"
              style={{ width: 190, textAlign: 'left' }}
              placeholder="Filter by action, agent…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="seg">
              {FILTERS.map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f} <span className="faint tech">{counts[f]}</span>
                </button>
              ))}
            </div>
          </>
        }
        flush
      >
        <div className="table-wrap" style={{ maxHeight: '66vh', overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Decision</th>
                <th>Verification</th>
                <th>Auth</th>
                <th>Duration</th>
                <th>Result</th>
                <th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => setOpen(row.id)} data-selected={open === row.id}>
                  <td className="tech">{timeOf(row.startedAt)}</td>
                  <td>{row.agentName}</td>
                  <td className="tech strong">{row.tool}</td>
                  <td className="tech">{row.resource}</td>
                  <td>
                    <DecisionBadge decision={row.decision} />
                  </td>
                  <td className="tech">{label(row.verification)}</td>
                  <td className="tech">{ms(row.authorizationMs)}</td>
                  <td className="tech">{row.result === 'SUCCESS' ? ms(row.durationMs) : '—'}</td>
                  <td className="tech">{label(row.result)}</td>
                  <td>
                    {row.origin === 'injected' ? (
                      <Badge tone="hold">document-borne</Badge>
                    ) : row.origin === 'operator' ? (
                      <Badge tone="info">probe</Badge>
                    ) : (
                      <span className="faint">planned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <Empty>No executions match this filter.</Empty> : null}
        </div>
      </Panel>

      {open ? <ExecutionPanel executionId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
