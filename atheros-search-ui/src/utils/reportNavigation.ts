const shared = ['loc', 'sensor', 'after', 'before', 'mac'];
const supported: Record<string, string[]> = {
  '/': [...shared, 'ssid', 'bssid', 'context', 'entity', 'tag'],
  '/graph': [...shared, 'ssid'],
  '/inventory': [...shared, 'owner', 'tag', 'active', 'preset'],
};

export function reportLink(
  destination: string,
  sourcePath: string,
  search: string,
): string {
  if (destination === sourcePath) return destination + search;
  const input = new URLSearchParams(search),
    output = new URLSearchParams();
  for (const key of supported[destination] ?? shared)
    for (const value of input.getAll(key)) output.append(key, value);
  const lost = [
    'owner',
    'tag',
    'active',
    'preset',
    'bssid',
    'context',
    'ssid',
    'entity',
    'q',
    'kind',
    'mode',
    'k',
    'min',
    'g_mac',
    'g_hops',
    'g_limit',
    'g_threat',
    'g_edges',
    'g_kinds',
    'g_scope',
  ].filter(
    (key) =>
      input.has(key) && !(supported[destination] ?? shared).includes(key),
  );
  if (lost.length)
    output.set(
      'scope_change',
      'Destination does not apply: ' +
        lost.join(', ') +
        '. Shared location, sensor, time and identifier scope is retained.',
    );
  if (destination === '/') {
    output.set('q', '*');
    output.set('mode', 'SEARCH_MODE_SPARSE');
    output.set('kind', 'SEARCH_KIND_EVENT');
  }
  return destination + (output.size ? '?' + output.toString() : '');
}
