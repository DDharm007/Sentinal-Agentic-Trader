import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type {
  Approval,
  AuditEvent,
  Bootstrap,
  ExecutionRow,
  IntentGraph,
  Kpis,
  RunState,
} from './types';

interface ControlPlaneState {
  boot: Bootstrap | null;
  kpis: Kpis | null;
  executions: ExecutionRow[];
  approvals: Approval[];
  audit: AuditEvent[];
  graph: IntentGraph | null;
  run: RunState | null;
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshLight: () => void;
  pendingApprovals: Approval[];
}

const Ctx = createContext<ControlPlaneState | null>(null);

export function ControlPlaneProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [graph, setGraph] = useState<IntentGraph | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [b, ex, ap, au, gr] = await Promise.all([
        api.bootstrap(),
        api.executions('all', 240),
        api.approvals(),
        api.audit('all', 160),
        api.graph(),
      ]);
      setBoot(b);
      setKpis(b.kpis);
      setRun(b.run);
      setExecutions(ex.rows);
      setApprovals(ap);
      setAudit(au.rows);
      setGraph(gr);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Debounced pull of the derived views after a burst of stream events. */
  const refreshLight = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const [k, g, b] = await Promise.all([api.kpis(), api.graph(), api.bootstrap()]);
        setKpis(k);
        setGraph(g);
        setBoot(b);
      } catch {
        /* the stream will resync */
      }
    }, 160);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as
        | { type: 'execution'; execution: ExecutionRow }
        | { type: 'approval'; approval: Approval }
        | { type: 'audit'; event: AuditEvent }
        | { type: 'agent'; agent: unknown }
        | { type: 'plan'; planId: string }
        | { type: 'run'; runId: string; status: RunState['status']; step?: number; note?: string }
        | { type: 'reset' };

      switch (payload.type) {
        case 'execution': {
          setExecutions((prev) => {
            const index = prev.findIndex((e) => e.id === payload.execution.id);
            if (index === -1) return [payload.execution, ...prev].slice(0, 260);
            const next = [...prev];
            next[index] = payload.execution;
            return next;
          });
          refreshLight();
          break;
        }
        case 'approval': {
          setApprovals((prev) => {
            const index = prev.findIndex((a) => a.id === payload.approval.id);
            if (index === -1) return [payload.approval, ...prev];
            const next = [...prev];
            next[index] = payload.approval;
            return next;
          });
          refreshLight();
          break;
        }
        case 'audit': {
          setAudit((prev) => [payload.event, ...prev].slice(0, 260));
          break;
        }
        case 'run': {
          setRun((prev) =>
            prev && prev.runId === payload.runId
              ? { ...prev, status: payload.status, currentStep: payload.step ?? prev.currentStep, note: payload.note }
              : prev,
          );
          refreshLight();
          break;
        }
        case 'plan':
        case 'agent': {
          refreshLight();
          break;
        }
        case 'reset': {
          void refresh();
          break;
        }
      }
    };
    return () => source.close();
  }, [refresh, refreshLight]);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'PENDING'),
    [approvals],
  );

  const value = useMemo<ControlPlaneState>(
    () => ({
      boot,
      kpis,
      executions,
      approvals,
      audit,
      graph,
      run,
      connected,
      error,
      refresh,
      refreshLight,
      pendingApprovals,
    }),
    [boot, kpis, executions, approvals, audit, graph, run, connected, error, refresh, refreshLight, pendingApprovals],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControlPlane(): ControlPlaneState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useControlPlane must be used inside ControlPlaneProvider');
  return value;
}
