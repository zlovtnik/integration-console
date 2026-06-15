export function domId(value?: string | null): string {
  const input = value ?? '';
  const normalized = input
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const base =
    normalized && !/^\d/.test(normalized)
      ? normalized
      : `dom-${normalized || 'id'}`;
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return `${base}-${hash.toString(36)}`;
}
