export function tagClass(tag: string): string {
  const normalized = tag.toLowerCase();
  if (normalized.includes('threat') || normalized.includes('risk')) return 'tag tag--danger';
  if (normalized.includes('warn') || normalized.includes('shadow')) return 'tag tag--warn';
  if (normalized.includes('ok') || normalized.includes('trusted')) return 'tag tag--ok';
  return 'tag';
}
