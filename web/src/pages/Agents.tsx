import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, DecisionBadge, Empty, Panel, StatusDot } from '../components/ui';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { dateTimeOf, label, ms, relative, timeOf } from '../lib/util';
import type { Agent, ExecutionRow, PlanView, RunState, ToolInfo } from '../lib/types';
import { IconArrowLeft } from '../components/icons';

export function Agents({ navigate }: { navigate: (path: string) => void }) {
  const { boot } = useControlPlane();
  const agents = boot?.agents ?? [];

  return (
    <div className="page">
      <PageHead
        title="Agents"
        description="Registered autonomous workers. Authority is not a property of the agent — it is the grant set inside the plan the agent is currently bound to."
      />

      <div className="grid cols-3">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={() => navigate(`agents/${agent.id}`)} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { boot, refresh } = useControlPlane();
  const plan = boot?.plans.find((p) => p.planId === agent.planId) ?? null;
  const [busy, setBusy] = useState(false);

  const setStatus = async (status: 'ACTIVE' | 'PAUSED' | 'REVOKED') => {
    setBusy(true);
    try {
      await api.agentStatus(agent.id, status);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="agent-card">
      <div className="agent-top">
        <div style={{ minWidth: 0 }}>
          <h2 style={{ marginBottom: 2 }}>{agent.name}</h2>
          <div className="muted tech" style={{ fontSize: 11 }}>
            {agent.id} · {agent.runtime}
          </div>
        </div>
        <span className="badge plain" style={{ marginLeft: 'auto' }}>
          <StatusDot status={agent.status} />
          {agent.status}
        </span>
      </div>

      <p className="muted" style={{ fontSize: 11.5 }}>
        {agent.description}
      </p>

      <div>
        <div className="section-title">Authority — {agent.planId ?? 'no plan'}</div>
        <div className="authority-list">
          {agent.tools.map((tool) => (
            <div className="authority-item tech" key={tool}>
              <span className="mark">✓</span>
              {tool}
            </div>
          ))}
          {agent.restricted.map((tool) => (
            <div className="authority-item denied tech" key={tool}>
              <span className="mark">×</span>
              {tool}
              <span className="muted" style={{ fontSize: 10.5 }}>
                not authorized
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <Badge tone={plan?.status === 'VERIFIED' ? 'allow' : 'block'} dot>
          Plan {plan?.status ?? 'MISSING'}
        </Badge>
        <span className="muted tech" style={{ fontSize: 10.5 }}>
          last execution {agent.lastExecutionAt ? relative(agent.lastExecutionAt) : '—'}
        </span>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="n">{agent.actionsToday}</div>
          <div className="l">Actions</div>
        </div>
        <div className="metric">
          <div className="n" style={{ color: 'var(--hold)' }}>
            {agent.heldToday}
          </div>
          <div className="l">Held</div>
        </div>
        <div className="metric">
          <div className="n" style={{ color: 'var(--block)' }}>
            {agent.blockedToday}
          </div>
          <div className="l">Blocked</div>
        </div>
        <div className="metric">
          <div className="n">{agent.tools.length}</div>
          <div className="l">Tools</div>
        </div>
      </div>

      <div className="row">
        <button className="btn sm" onClick={onOpen}>
          View
        </button>
        <button
          className="btn sm"
          disabled={busy || agent.status === 'REVOKED'}
          onClick={() => setStatus(agent.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED')}
        >
          {agent.status === 'PAUSED' ? 'Resume' : 'Pause'}
        </button>
        <button
          className="btn sm danger"
          disabled={busy}
          onClick={() => setStatus(agent.status === 'REVOKED' ? 'ACTIVE' : 'REVOKED')}
        >
          {agent.status === 'REVOKED' ? 'Restore Authority' : 'Revoke Authority'}
        </button>
      </div>
    </article>
  );
}

export function AgentDetail({ agentId, navigate }: { agentId: string; navigate: (path: string) => void }) {
  const { executions } = useControlPlane();
  const [data, setData] = useState<{
    agent: Agent;
    plan: PlanView | null;
    executions: ExecutionRow[];
    tools: ToolInfo[];
    restricted: ToolInfo[];
    run: RunState | null;
  } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.agent(agentId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
    // re-fetch when the live stream reports new executions
  }, [agentId, executions.length]);

  if (!data) return <div className="page"><Empty>Loading agent…</Empty></div>;
  const { agent, plan } = data;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: -4 }}>
        <button className="btn sm" onClick={() => navigate('agents')}>
          <IconArrowLeft /> Agents
        </button>
      </div>

      <PageHead
        title={agent.name}
        description={agent.description}
        actions={
          <>
            <span className="chip">
              <StatusDot status={agent.status} /> {agent.status}
            </span>
            <span className="chip tech">{agent.id}</span>
          </>
        }
      />

      <div className="grid cols-2">
        <Panel title="Current intent" sub={plan ? `${plan.planId} v${plan.version}` : 'no plan'}>
          <blockquote
            style={{
              margin: 0,
              paddingLeft: 12,
              borderLeft: '2px solid var(--accent-line)',
              fontSize: 13,
              lineHeight: 1.65,
            }}
          >
            {agent.intent}
          </blockquote>
          <div className="divider" />
          <dl className="kv">
            <dt>Runtime</dt>
            <dd className="tech">{agent.runtime}</dd>
            <dt>Owner</dt>
            <dd>{agent.owner}</dd>
            <dt>Registered</dt>
            <dd className="tech">{dateTimeOf(agent.registeredAt)}</dd>
            <dt>Last execution</dt>
            <dd className="tech">{agent.lastExecutionAt ? dateTimeOf(agent.lastExecutionAt) : '—'}</dd>
            <dt>Plan integrity</dt>
            <dd>
              <Badge tone={plan?.status === 'VERIFIED' ? 'allow' : 'block'}>{plan?.status ?? '—'}</Badge>
            </dd>
            <dt>Signature</dt>
            <dd className="tech">
              {plan?.algorithm} · {plan?.signatureShort}
            </dd>
          </dl>
        </Panel>

        <Panel title="Current authorization" sub="grants in the signed plan">
          <div className="stack">
            {(plan?.grants ?? []).map((grant, i) => (
              <div className="tuple covered" key={i}>
                <span className="strong">{grant.effect}</span>
                <span className="op">:</span>
                <span>{grant.resource}</span>
                {grant.constraints ? (
                  <span className="faint" style={{ fontSize: 10.5 }}>
                    {Object.entries(grant.constraints)
                      .map(([k, v]) => `${k} ∈ {${v.join(', ')}}`)
                      .join(' · ')}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="grid cols-2" style={{ gap: 16 }}>
            <div>
              <div className="section-title">Tools</div>
              <div className="authority-list">
                {data.tools.map((tool) => (
                  <div className="authority-item tech" key={tool.id}>
                    <span className="mark">✓</span>
                    {tool.id}
                    {tool.testMode ? <Badge tone="plain">test mode</Badge> : null}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="section-title">Restricted actions</div>
              <div className="authority-list">
                {data.restricted.map((tool) => (
                  <div className="authority-item denied tech" key={tool.id}>
                    <span className="mark">×</span>
                    {tool.id}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="Current execution"
        sub={data.run ? data.run.scenario : 'no active run'}
        right={
          data.run ? (
            <Badge tone={data.run.status === 'waiting-approval' ? 'hold' : 'info'}>
              {data.run.status.replace('-', ' ')}
            </Badge>
          ) : null
        }
      >
        {data.run ? (
          <div className="stack">
            <div className="row">
              <span className="tech muted" style={{ fontSize: 11.5 }}>
                {data.run.runId} · step {data.run.currentStep} of {data.run.totalSteps}
              </span>
            </div>
            <div className="notice">{data.run.note ?? 'Running.'}</div>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>
            No workflow is currently executing for this agent.
          </div>
        )}
      </Panel>

      <Panel title="Recent decisions" sub="newest first" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Decision</th>
                <th>Verification</th>
                <th>Latency</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.executions.slice(0, 18).map((row) => (
                <tr key={row.id} onClick={() => setOpen(row.id)}>
                  <td className="tech">{timeOf(row.startedAt)}</td>
                  <td className="tech strong">{row.tool}</td>
                  <td className="tech">{row.resource}</td>
                  <td>
                    <DecisionBadge decision={row.decision} />
                  </td>
                  <td className="tech">{label(row.verification)}</td>
                  <td className="tech">{ms(row.authorizationMs)}</td>
                  <td className="tech">{label(row.result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {open ? <ExecutionPanel executionId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
