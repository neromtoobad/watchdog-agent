import type { ViolationAction } from '../index';
import type { RulesEvaluation } from './rules';

export interface ActionOutcome {
  block: boolean;
  action: ViolationAction;
  reasons: string[];
}

export function handleViolation(
  mode: ViolationAction,
  status: RulesEvaluation,
  setPaused: (paused: boolean) => void,
): ActionOutcome {
  const reasons = status.violations.slice();
  const msg = `[WATCHDOG] ${mode} — ${reasons.join(' | ') || 'violation'}`;

  switch (mode) {
    case 'log':
      console.warn(msg);
      return { block: false, action: 'log', reasons };
    case 'alert':
      console.warn(msg);
      return { block: false, action: 'alert', reasons };
    case 'pause':
      console.warn(msg);
      setPaused(true);
      return { block: true, action: 'pause', reasons };
  }
}
