export function KindBadge(props: { kind: string }) {
  const kindKey = () => props.kind.replace(/^SEARCH_KIND_/, '').toLowerCase();

  return <span class={`badge badge--${kindKey()}`}>{kindKey()}</span>;
}
