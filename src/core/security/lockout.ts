// Brute-force exponential lockout (PROMPT.md §5.2): 5 fails → 30 s, 8 → 5 min, 10+ → 15 min.
// Optional wipe after 15 consecutive failures (off by default). Pure state machine: the caller persists it.
export interface LockoutState {
  failures: number;
  lockedUntil: number;
}

export const LOCKOUT_INITIAL: LockoutState = { failures: 0, lockedUntil: 0 };
export const WIPE_AFTER = 15;

export function lockDurationMs(failures: number): number {
  if (failures >= 10) return 15 * 60_000;
  if (failures >= 8) return 5 * 60_000;
  if (failures >= 5) return 30_000;
  return 0;
}

export const remainingLockMs = (s: LockoutState, now: number): number => Math.max(0, s.lockedUntil - now);

export function registerFailure(s: LockoutState, now: number, wipeEnabled: boolean): { state: LockoutState; wipe: boolean } {
  const failures = s.failures + 1;
  const d = lockDurationMs(failures);
  return { state: { failures, lockedUntil: d ? now + d : 0 }, wipe: wipeEnabled && failures >= WIPE_AFTER };
}

export const registerSuccess = (): LockoutState => ({ ...LOCKOUT_INITIAL });
