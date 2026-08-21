import { useState } from 'react';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, Empty, Panel } from '../components/ui';
import { ApprovalCard } from '../components/ApprovalCard';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { dateTimeOf } from '../lib/util';

export function Approvals({ navigate }: { navigate: (path: string) => void }) {
  const { approvals, pendingApprovals, boot } = useControlPlane();
  const [open, setOpen] = useState<string | null>(null);
  const resolved = approvals.filter((a) => a.status !== 'PENDING');
  const outbox = boot?.sandbox.outbox ?? [];

  return (
    <div className="page">
      <PageHead
        title="Human Approval Required"
        description="Actions the gateway held before execution. Approving mints a single-use grant scoped to exactly the capabilities that were missing — it does not widen the plan."
        actions={
          <span className="chip">
            <i className={`dot ${pendingApprovals.length ? 'hold' : 'allow'}`} />
            {pendingApprovals.length} awaiting decision
          </span>
        }
      />

      {pendingApprovals.length === 0 ? (
        <Panel title="Queue" sub="nothing held">
          <Empty>
            No action is currently held. Run the demo or use “Simulate scope violation” on the
            Command Center to produce one.
          </Empty>
        </Panel>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onOpenExecution={setOpen}
              onOpenIntent={() => navigate('plans')}
            />
          ))}
        </div>
      )}

      <div className="grid cols-2">
        <Panel title="Mail sandbox outbox" sub="proof of what did and did not execute" flush>
          {outbox.length === 0 ? (
            <Empty>The outbox is empty. No message has been delivered in this session.</Empty>
          ) : (
            <div className="feed">
              {outbox.map((message) => (
                <div className="feed-row" key={message.id}>
                  <span className="feed-time tech">{dateTimeOf(message.sentAt).slice(-8)}</span>
                  <div className="feed-main">
                    <span className="feed-action tech">{message.to}</span>
                    <span className="feed-note">
                      {message.subject} · {message.attachments.map((a) => a.dataClass).join(', ') || 'no attachment'}
                    </span>
                  </div>
                  <Badge tone={message.authorizedBy.approvalId ? 'hold' : 'allow'}>
                    {message.authorizedBy.approvalId ? 'approved once' : 'in plan'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Decision history" sub={`${resolved.length} resolved`} flush>
          {resolved.length === 0 ? (
            <Empty>No approvals have been resolved yet.</Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Decided by</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((approval) => (
                    <tr key={approval.id} onClick={() => setOpen(approval.executionId)}>
                      <td className="tech">{dateTimeOf(approval.requestedAt)}</td>
                      <td className="tech strong">{approval.tool}</td>
                      <td className="tech">{approval.target}</td>
                      <td>
                        <Badge
                          tone={
                            approval.status === 'APPROVED'
                              ? 'allow'
                              : approval.status === 'REJECTED'
                                ? 'block'
                                : 'plain'
                          }
                        >
                          {approval.status}
                        </Badge>
                      </td>
                      <td className="tech">{approval.decidedBy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {open ? <ExecutionPanel executionId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
