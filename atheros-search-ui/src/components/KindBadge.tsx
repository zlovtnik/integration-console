export function KindBadge(props: { kind: string }) {
  return <span class={`badge badge--${props.kind.toLowerCase()}`}>{props.kind.replace(/^SEARCH_KIND_/, '').toLowerCase()}</span>;
}
