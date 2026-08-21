import { Sidebar, TopBar } from './components/Shell';
import { ControlPlaneProvider, useControlPlane } from './lib/store';
import { useRoute, useTheme } from './lib/util';
import { Overview } from './pages/Overview';
import { AgentDetail, Agents } from './pages/Agents';
import { Executions } from './pages/Executions';
import { Approvals } from './pages/Approvals';
import { IntentPlans } from './pages/IntentPlans';
import { AuditTrail } from './pages/AuditTrail';
import { Integrations, Policies } from './pages/Governance';
import { Architecture, Settings } from './pages/System';
import { ArmorIqSdk } from './pages/Sdk';
import { ApiKeys } from './pages/ApiKeys';

const TITLES: Record<string, { title: string; subtitle: string }> = {
  overview: { title: 'Sentinel', subtitle: 'Autonomous Operations Control Plane' },
  agents: { title: 'Agents', subtitle: 'Registered autonomous workers and their authority' },
  executions: { title: 'Executions', subtitle: 'Authorization decisions and execution results' },
  approvals: { title: 'Approvals', subtitle: 'Actions held before execution' },
  plans: { title: 'Intent Plans', subtitle: 'Signed declarations of intended scope' },
  audit: { title: 'Audit Trail', subtitle: 'Hash-linked record of every decision' },
  policies: { title: 'Policies', subtitle: 'Human-readable authorization boundaries' },
  sdk: { title: 'ArmorIQ SDK', subtitle: 'The published SDK, exercised live in this environment' },
  'api-keys': { title: 'API Keys', subtitle: 'Optional credentials for third-party services' },
  integrations: { title: 'Integrations', subtitle: 'Connected runtimes, surfaces and evidence stores' },
  architecture: { title: 'Architecture', subtitle: 'How an action becomes an authorized action' },
  settings: { title: 'Settings', subtitle: 'Console preferences and control-plane identity' },
};

function Routes() {
  const [segments, navigate] = useRoute();
  const [theme, setTheme] = useTheme();
  const { error, boot } = useControlPlane();
  const route = segments[0] ?? 'overview';
  const head = TITLES[route] ?? TITLES.overview;

  const body = () => {
    switch (route) {
      case 'agents':
        return segments[1] ? (
          <AgentDetail agentId={segments[1]} navigate={navigate} />
        ) : (
          <Agents navigate={navigate} />
        );
      case 'executions':
        return <Executions />;
      case 'approvals':
        return <Approvals navigate={navigate} />;
      case 'plans':
        return <IntentPlans />;
      case 'audit':
        return <AuditTrail />;
      case 'policies':
        return <Policies />;
      case 'sdk':
        return <ArmorIqSdk navigate={navigate} />;
      case 'api-keys':
        return <ApiKeys navigate={navigate} />;
      case 'integrations':
        return <Integrations />;
      case 'architecture':
        return <Architecture />;
      case 'settings':
        return <Settings theme={theme} onTheme={setTheme} />;
      default:
        return <Overview navigate={navigate} />;
    }
  };

  return (
    <div className="shell">
      <Sidebar active={route} onNavigate={navigate} theme={theme} onTheme={setTheme} />
      <main className="main">
        <TopBar title={head.title} subtitle={head.subtitle} />
        {error ? (
          <div className="page">
            <div className="notice danger">
              <span>
                <strong>Gateway unreachable.</strong> {error}. Start the authorization gateway with{' '}
                <code className="tech">npm run dev</code> from the project root.
              </span>
            </div>
          </div>
        ) : !boot ? (
          <div className="page">
            <div className="muted">Connecting to the authorization gateway…</div>
          </div>
        ) : (
          body()
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ControlPlaneProvider>
      <Routes />
    </ControlPlaneProvider>
  );
}
