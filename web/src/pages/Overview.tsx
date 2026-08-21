import { useState } from 'react';
import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, DecisionBadge, Empty, Flow, Panel } from '../components/ui';
import { GraphLegend, GraphView } from '../components/GraphView';
import { DemoConsole } from '../components/DemoConsole';
import { ApprovalCard } from '../components/ApprovalCard';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { ms, pad, timeOf } from '../lib/util';
import type { GraphNode } from '../lib/types';

export function Overview({ navigate }: { navigate: (path: string) => void }) {
  const { kpis, executions, graph, pendingApprovals, boot } = useControlPlane();
  const [openExecution, setOpenExecution] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const feed = executions.slice(0, 14);

  return (
    <div className="page">
      <PageHead
        title="Command Center"
        description="Autonomous execution, controlled authority. Every action an agent attempts is verified against its signed intent before it reaches a tool."
        actions={
          <>
            <span className="chip tech">
              <i className="dot allow" /> Median authorization {ms(kpis?.medianAuthorizationMs)}
            </span>
            <button className="btn" onClick={() => navigate('architecture')}>
              How it works
            </button>
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Active Agents" value={pad(kpis?.activeAgents ?? 0)} foot="registered and bound to a plan" />
        <Kpi label="Actions Today" value={String(kpis?.actionsToday ?? 0)} foot="evaluated by the gateway" />
        <Kpi label="Allowed" value={String(kpis?.allowed ?? 0)} tone="allow" foot="within declared scope" />
        <Kpi label="Held" value={pad(kpis?.held ?? 0)} tone="hold" foot="outside scope, sent to a human" />
        <Kpi label="Blocked" value={pad(kpis?.blocked ?? 0)} tone="block" foot="irreversible, never delegated" />
        <Kpi
          label="Approval Rate"
          value={`${(kpis?.approvalRate ?? 0).toFixed(1)}%`}
          foot="allowed or approved on review"
        />
      </div>

      {pendingApprovals.length > 0 ? (
        <ApprovalCard
          approval={pendingApprovals[0]}
          compact
          onOpenExecution={(id) => setOpenExecution(id)}
          onOpenIntent={() => navigate('plans')}
        />
      ) : null}

      <div className="grid split-graph">
        <Panel
          title="Intent Execution Graph"
          sub={graph ? `${graph.planId} v${graph.planVersion}` : undefined}
          right={
            <Badge tone={graph?.status === 'waiting-approval' ? 'hold' : graph?.runId ? 'info' : 'plain'}>
              {graph?.runId ? graph.status.replace('-', ' ') : 'no active run'}
            </Badge>
          }
          flush
        >
          <GraphView graph={graph} onSelect={setSelectedNode} selectedId={selectedNode?.id} />
          <GraphLegend />
        </Panel>

        <DemoConsole onOpenExecution={setOpenExecution} />
      </div>

      <div className="grid cols-2">
        <Panel
          title="Live Execution"
          sub="gateway decisions, newest first"
          right={<span className="muted tech" style={{ fontSize: 11 }}>{executions.length} records</span>}
          flush
        >
          <div className="feed">
            {feed.length === 0 ? (
              <Empty>No executions yet. Run the demo to see the gateway decide in real time.</Empty>
            ) : (
              feed.map((row) => (
                <div className="feed-row" key={row.id}>
                  <span className="feed-time tech">{timeOf(row.startedAt)}</span>
                  <div className="feed-main">
                    <span className="feed-action tech">
                      {row.tool}
                      {row.origin === 'injected' ? <Badge tone="hold">document-borne</Badge> : null}
                      {row.origin === 'operator' ? <Badge tone="info">probe</Badge> : null}
                    </span>
                    <span className="feed-note">
                      {row.agentName} · {row.resource}
                    </span>
                  </div>
                  <button
                    className="btn sm"
                    style={{ border: 0, background: 'transparent', padding: 0 }}
                    onClick={() => setOpenExecution(row.id)}
                  >
                    <DecisionBadge decision={row.decision} />
                  </button>
                </div>
              ))
            )}
            {pendingApprovals.length > 0 ? (
              <div className="feed-row">
                <span className="feed-time tech">{timeOf(pendingApprovals[0].requestedAt)}</span>
                <div className="feed-main">
                  <span className="feed-action">Human approval requested</span>
                  <span className="feed-note">
                    {pendingApprovals[0].tool} → {pendingApprovals[0].target}
                  </span>
                </div>
                <Badge tone="hold">Waiting</Badge>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Enforcement, before and after" sub="the same agent, the same instruction">
          <div className="grid cols-2" style={{ gap: 18 }}>
            <div className="stack">
              <div className="row">
                <span className="section-title" style={{ margin: 0 }}>
                  Without enforcement
                </span>
                <Badge tone="block">Unsafe</Badge>
              </div>
              <Flow
                steps={[
                  { label: 'Agent' },
                  { label: 'Tool' },
                  { label: 'Unauthorized action executes', tone: 'block' },
                ]}
              />
              <p className="muted" style={{ fontSize: 11.5 }}>
                The instruction inside the invoice reaches the mail surface. Extracted invoice data
                and the vendor bank reference leave the trust boundary. Nobody is asked.
              </p>
            </div>

            <div className="stack">
              <div className="row">
                <span className="section-title" style={{ margin: 0 }}>
                  With Sentinel
                </span>
                <Badge tone="allow">Controlled</Badge>
              </div>
              <Flow
                steps={[
                  { label: 'Agent' },
                  { label: 'Authorization verification', tone: 'accent' },
                  { label: 'Plan check' },
                  { label: 'HOLD', tone: 'hold' },
                  { label: 'Human decision' },
                  { label: 'Tool', tone: 'allow' },
                ]}
              />
              <p className="muted" style={{ fontSize: 11.5 }}>
                The action is held before execution. A named human approves once, the plan is
                amended with a single-use grant, and the agent resumes.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="notice">
        <span>
          <strong>Data notice.</strong> {boot?.meta.dataNotice}
        </span>
      </div>

      {selectedNode ? (
        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} onOpen={setOpenExecution} />
      ) : null}
      {openExecution ? (
        <ExecutionPanel executionId={openExecution} onClose={() => setOpenExecution(null)} />
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: 'allow' | 'hold' | 'block';
}) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
      <span className="kpi-foot">{foot}</span>
    </div>
  );
}

function NodePanel({
  node,
  onClose,
  onOpen,
}: {
  node: GraphNode;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="side-panel" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>{node.label}</h2>
            <div className="muted tech" style={{ fontSize: 11.5, marginTop: 2 }}>
              {node.kind === 'action' ? node.sublabel ?? 'not executed' : node.sublabel}
            </div>
          </div>
          <button className="btn icon sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="body">
          <div className="row">
            <Badge
              tone={
                node.state === 'allowed' || node.state === 'approved'
                  ? 'allow'
                  : node.state === 'held'
                    ? 'hold'
                    : node.state === 'blocked'
                      ? 'block'
                      : 'plain'
              }
            >
              {node.authorizationState}
            </Badge>
            {!node.inPlan ? <Badge tone="plain">Not in signed plan</Badge> : null}
            {node.timestamp ? (
              <span className="muted tech" style={{ fontSize: 11 }}>
                {timeOf(node.timestamp)}
              </span>
            ) : null}
          </div>
          {node.detail ? <div className="notice">{node.detail}</div> : null}
          {node.executionId ? (
            <button className="btn" onClick={() => { onOpen(node.executionId!); onClose(); }}>
              Open authorization record
            </button>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              This step has not executed in the current run.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
