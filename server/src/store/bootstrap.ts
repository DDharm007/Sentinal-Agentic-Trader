import { resetPlans } from '../armoriq/plan.js';
import { loadSandbox } from '../tools/sandbox.js';
import {
  seedAgents,
  seedHistory,
  seedIntegrations,
  seedPlans,
  seedPolicies,
} from './seed.js';
import { emit, resetCounters } from './state.js';

/** Builds (or rebuilds) the whole control plane from a clean slate. */
export function bootstrapControlPlane(): void {
  resetCounters();
  resetPlans();
  loadSandbox();
  seedAgents();
  seedPlans();
  seedIntegrations();
  seedPolicies();
  seedHistory();
  emit({ type: 'reset' });
}
