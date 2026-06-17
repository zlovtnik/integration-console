export type Rfc3339Timestamp = string & {
  readonly __brand: 'Rfc3339Timestamp';
};

const RFC3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Converts a native datetime-local input value into an RFC 3339 timestamp.
 * datetime-local is zone-less, so Date interprets it as the user's local time.
 */
export function localInputToRfc3339(
  value: string,
): Rfc3339Timestamp | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return asRfc3339(parsed.toISOString());
}

export function rfc3339ToLocalInput(value: string | undefined): string {
  if (!value || !isRfc3339(value)) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function isRfc3339(value: string): boolean {
  if (!RFC3339_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function asRfc3339(
  value: string,
): Rfc3339Timestamp | undefined {
  return isRfc3339(value) ? (value as Rfc3339Timestamp) : undefined;
}

export function compareRfc3339(
  left: Rfc3339Timestamp,
  right: Rfc3339Timestamp,
): number {
  return new Date(left).getTime() - new Date(right).getTime();
}
