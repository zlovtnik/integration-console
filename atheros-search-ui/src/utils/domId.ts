export function domId(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const base =
    normalized && !/^\d/.test(normalized)
      ? normalized
      : `dom-${normalized || 'id'}`;
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return `${base}-${hash.toString(36)}`;
}
