import { describe, expect, it } from 'vitest';
import {
  asRfc3339,
  compareRfc3339,
  isRfc3339,
  localInputToRfc3339,
  rfc3339ToLocalInput,
} from '~/utils/timestamp';

describe('timestamp utilities', () => {
  it('round-trips datetime-local values through RFC 3339', () => {
    const localValue = '2026-06-16T23:51';
    const timestamp = localInputToRfc3339(localValue);

    expect(timestamp).toBeDefined();
    expect(timestamp).not.toBe(localValue);
    expect(isRfc3339(timestamp!)).toBe(true);
    expect(rfc3339ToLocalInput(timestamp)).toBe(localValue);
  });

  it('rejects incomplete and invalid timestamp values', () => {
    expect(isRfc3339('2026-06-16T23:51')).toBe(false);
    expect(localInputToRfc3339('')).toBeUndefined();
    expect(localInputToRfc3339('garbage')).toBeUndefined();
    expect(asRfc3339('2026-06-16T23:51')).toBeUndefined();
  });

  it('compares timestamps by instant instead of string shape', () => {
    const earlier = asRfc3339('2026-06-16T23:30:00Z');
    const later = asRfc3339('2026-06-16T20:00:00-04:00');

    expect(earlier).toBeDefined();
    expect(later).toBeDefined();
    expect(compareRfc3339(earlier!, later!)).toBeLessThan(0);
  });
});
