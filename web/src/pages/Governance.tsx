import { useControlPlane } from '../lib/store';
import { PageHead } from '../components/Shell';
import { Badge, Panel, TupleChip } from '../components/ui';
import { dateTimeOf, relative } from '../lib/util';

export function Policies() {
  const { boot } = useControlPlane();
  const policies = boot?.policies ?? [];
  const effects = boot?.capabilities.effects ?? [];

  return (
    <div className="page">
      <PageHead
        title="Policies"
        description="Authorization boundaries written the way an operator would describe them. A policy statement is a set of capability tuples with a disposition — the same tuples the engine evaluates at runtime."
      />

      {policies.map((policy) => (
        <Panel
          key={policy.id}
          title={policy.name}
          sub={`${policy.scope} · ${policy.version}`}
          right={<span className="muted tech" style={{ fontSize: 11 }}>updated {relative(policy.updatedAt)}</span>}
          flush
        >
          <div className="policy-block" style={{ border: 0, borderRadius: 0 }}>
            {policy.statements.map((statement) => (
              <div className="policy-row" key={statement.title}>
                <div>
                  <Badge
                    tone={
                      statement.disposition === 'ALLOW'
                        ? 'allow'
                        : statement.disposition === 'APPROVAL'
                          ? 'hold'
                          : 'block'
                    }
                    dot
                  >
                    {statement.disposition === 'APPROVAL' ? 'Approval' : statement.disposition}
                  </Badge>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="strong">{statement.title}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {statement.description}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {statement.tuples.map((tuple, i) => (
                      <TupleChip key={i} tuple={tuple} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      <Panel
        title="Effect dispositions"
        sub="what happens when a required capability is not in the plan"
        flush
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Effect</th>
                <th>Implies</th>
                <th>Reversible</th>
                <th>If uncovered</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {effects.map((effect) => (
                <tr key={effect.id} style={{ cursor: 'default' }}>
                  <td className="tech strong">{effect.id}</td>
                  <td className="tech faint">{effect.implies.join(', ')}</td>
                  <td className="tech">{effect.reversible ? 'yes' : 'no'}</td>
                  <td>
                    <Badge tone={effect.unsatisfiedDisposition === 'block' ? 'block' : 'hold'}>
                      {effect.unsatisfiedDisposition}
                    </Badge>
                  </td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>{effect.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function Integrations() {
  const { boot } = useControlPlane();
  const integrations = boot?.integrations ?? [];
  const tools = boot?.tools ?? [];

  return (
    <div className="page">
      <PageHead
        title="Integrations"
        description="Connected planes. Modes are labelled honestly: sandbox surfaces perform real, observable side effects locally; simulated surfaces model a vendor SDK with the same call shape."
      />

      <div className="grid cols-3">
        {integrations.map((integration) => (
          <div className="integration" key={integration.id}>
            <span
              className="avatar"
              style={{ width: 34, height: 34, fontSize: 12, borderRadius: 8 }}
            >
              {integration.name.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="strong">{integration.name}</span>
                <Badge tone={integration.status === 'CONNECTED' ? 'allow' : 'hold'} dot>
                  {integration.status}
                </Badge>
                <Badge tone="plain">{integration.mode}</Badge>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                {integration.description}
              </div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 5 }}>
                {integration.detail}
              </div>
              <div className="faint tech" style={{ fontSize: 10, marginTop: 5 }}>
                checked {dateTimeOf(integration.lastCheckedAt)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Panel title="Registered tools" sub={`${tools.length} across the MCP surface`} flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Surface</th>
                <th>Risk tier</th>
                <th>Mode</th>
                <th>Requirements are derived from</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.id} style={{ cursor: 'default' }}>
                  <td className="tech strong">{tool.id}</td>
                  <td className="tech">{tool.surface}</td>
                  <td>
                    <Badge
                      tone={
                        tool.riskTier === 'critical' ? 'block' : tool.riskTier === 'elevated' ? 'hold' : 'plain'
                      }
                    >
                      {tool.riskTier}
                    </Badge>
                  </td>
                  <td className="tech">{tool.testMode ? 'test mode' : 'sandbox'}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 460 }}>{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
