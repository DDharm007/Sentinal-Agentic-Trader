import { useMemo, useState } from 'react';
import type { GraphNode, IntentGraph } from '../lib/types';
import { timeOf } from '../lib/util';

const NODE_W = 158;
const NODE_H = 54;
const GAP_X = 34;
const GAP_Y = 30;
const PAD = 16;

interface Placed extends GraphNode {
  x: number;
  y: number;
}

function toneOf(node: GraphNode): 'allow' | 'hold' | 'block' | '' {
  if (node.state === 'allowed' || node.state === 'approved') return 'allow';
  if (node.state === 'held') return 'hold';
  if (node.state === 'blocked') return 'block';
  return '';
}

export function GraphView({
  graph,
  onSelect,
  selectedId,
}: {
  graph: IntentGraph | null;
  onSelect?: (node: GraphNode) => void;
  selectedId?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const { placed, width, height } = useMemo(() => {
    if (!graph) return { placed: [] as Placed[], width: 640, height: 320 };
    const layers = [...new Set(graph.nodes.map((n) => n.layer))].sort((a, b) => a - b);
    const spineCenter = PAD + NODE_W + GAP_X / 2;
    const nodes: Placed[] = [];

    for (const layer of layers) {
      const inLayer = graph.nodes.filter((n) => n.layer === layer);
      const spine = inLayer.filter((n) => n.inPlan).sort((a, b) => a.column - b.column);
      const offPlan = inLayer.filter((n) => !n.inPlan);
      const y = PAD + layer * (NODE_H + GAP_Y);

      spine.forEach((node, index) => {
        const total = spine.length;
        const x = spineCenter + (index - (total - 1) / 2) * (NODE_W + GAP_X) - NODE_W / 2;
        nodes.push({ ...node, x, y });
      });

      offPlan.forEach((node, index) => {
        const x = spineCenter + (NODE_W + GAP_X) * (index + 1) - NODE_W / 2;
        nodes.push({ ...node, x, y });
      });
    }

    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W), 520);
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H), 300);
    return { placed: nodes, width: maxX + PAD, height: maxY + PAD + 6 };
  }, [graph]);

  if (!graph) return null;

  const byId = new Map(placed.map((n) => [n.id, n]));

  return (
    <div className="graph-shell">
      <svg
        className="graph-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Intent execution graph"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 1.5 6 4 0 6.5Z" fill="currentColor" />
          </marker>
        </defs>

        {graph.edges.map((edge, i) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const midY = y1 + (y2 - y1) / 2;
          const d =
            Math.abs(x1 - x2) < 1
              ? `M${x1} ${y1} L${x2} ${y2 - 3}`
              : `M${x1} ${y1} L${x1} ${midY - 8} Q${x1} ${midY} ${x1 + Math.sign(x2 - x1) * 10} ${midY} L${
                  x2 - Math.sign(x2 - x1) * 10
                } ${midY} Q${x2} ${midY} ${x2} ${midY + 8} L${x2} ${y2 - 3}`;
          return (
            <g key={i} className={`g-edge-wrap ${edge.state}`}>
              <path className={`g-edge ${edge.state}`} d={d} />
              {edge.state === 'severed' ? (
                <g>
                  <line
                    x1={x2 - 6}
                    y1={midY - 6}
                    x2={x2 + 6}
                    y2={midY + 6}
                    stroke="var(--block)"
                    strokeWidth="1.4"
                  />
                  <line
                    x1={x2 + 6}
                    y1={midY - 6}
                    x2={x2 - 6}
                    y2={midY + 6}
                    stroke="var(--block)"
                    strokeWidth="1.4"
                  />
                </g>
              ) : null}
            </g>
          );
        })}

        {placed.map((node) => {
          const tone = toneOf(node);
          return (
            <g
              key={node.id}
              className="g-node"
              data-state={node.state}
              data-offplan={!node.inPlan}
              data-selected={selectedId === node.id}
              transform={`translate(${node.x} ${node.y})`}
              onClick={() => onSelect?.(node)}
              onMouseEnter={() => setHover(node.id)}
              onMouseLeave={() => setHover(null)}
            >
              <rect width={NODE_W} height={NODE_H} rx="12" />
              <text className="g-title" x="12" y="21">
                {node.label}
              </text>
              <text className={`g-sub ${tone}`} x="12" y="35">
                {node.authorizationState}
              </text>
              <text className="g-time" x="12" y="46">
                {node.kind === 'action'
                  ? node.timestamp
                    ? timeOf(node.timestamp)
                    : 'not executed'
                  : node.sublabel}
              </text>
              {node.state === 'running' ? (
                <circle cx={NODE_W - 13} cy="15" r="3.2" fill="var(--accent)">
                  <animate attributeName="opacity" values="1;0.25;1" dur="1.2s" repeatCount="indefinite" />
                </circle>
              ) : tone ? (
                <circle
                  cx={NODE_W - 13}
                  cy="15"
                  r="3.2"
                  fill={tone === 'allow' ? 'var(--allow)' : tone === 'hold' ? 'var(--hold)' : 'var(--block)'}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {hover ? (
        <div className="faint tech" style={{ fontSize: 10.5, padding: '2px 2px 0' }}>
          {byId.get(hover)?.detail ?? ''}
        </div>
      ) : null}
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="g-legend">
      <span>
        <i className="dot allow" /> Authorized by plan
      </span>
      <span>
        <i className="dot hold" /> Held - outside declared scope
      </span>
      <span>
        <i className="dot block" /> Blocked before execution
      </span>
      <span>
        <i className="dot" /> Not yet executed
      </span>
      <span style={{ marginLeft: 'auto' }}>Dashed outline = action not present in the signed plan</span>
    </div>
  );
}
