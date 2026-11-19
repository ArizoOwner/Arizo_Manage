import { describe, expect, it } from 'vitest';
import { LOCKOUT_INITIAL, lockDurationMs, registerFailure, registerSuccess, remainingLockMs, WIPE_AFTER } from '../src/core/security/lockout';

describe('exponential lockout', () => {
  it('follows the 5 / 8 / 10 schedule', () => {
    expect([1, 4, 5, 7, 8, 9, 10, 14, 20].map(lockDurationMs)).toEqual([0, 0, 30_000, 30_000, 300_000, 300_000, 900_000, 900_000, 900_000]);
  });

  it('accumulates failures, locks, and resets on success', () => {
    let s = LOCKOUT_INITIAL;
    for (let i = 0; i < 5; i++) s = registerFailure(s, 1_000, false).state;
    expect(s.failures).toBe(5);
    expect(remainingLockMs(s, 1_000)).toBe(30_000);
    expect(remainingLockMs(s, 31_000)).toBe(0);
    expect(registerSuccess()).toEqual(LOCKOUT_INITIAL);
  });

  it('wipes only when enabled and only from the 15th failure', () => {
    let s = LOCKOUT_INITIAL;
    let wipe = false;
    for (let i = 0; i < WIPE_AFTER - 1; i++) ({ state: s, wipe } = registerFailure(s, 0, true));
    expect(wipe).toBe(false);
    expect(registerFailure(s, 0, true).wipe).toBe(true);
    expect(registerFailure(s, 0, false).wipe).toBe(false);
  });
});
