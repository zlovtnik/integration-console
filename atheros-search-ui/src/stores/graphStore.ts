import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  GraphEdge,
  GraphFilters,
  GraphNode,
  GraphResponse,
  NodeKind,
} from '~/api/types';

export const GRAPH_NODE_KINDS: NodeKind[] = [
  'device',
  'cluster',
  'ap',
  'client',
  'shadow_alert',
  'alert',
];

export const GRAPH_LIMITS = [50, 100, 200, 500] as const;

function defaultVisibleKinds(): Set<NodeKind> {
  return new Set(GRAPH_NODE_KINDS);
}

function graphKindFilter(kinds: Set<NodeKind>): NodeKind[] | undefined {
  const next = GRAPH_NODE_KINDS.filter((kind) => kinds.has(kind));
  return next.length === GRAPH_NODE_KINDS.length ? undefined : next;
}

export const [graphNodes, setGraphNodes] = createSignal<GraphNode[]>([]);
export const [graphEdges, setGraphEdges] = createSignal<GraphEdge[]>([]);
export const [graphMeta, setGraphMeta] = createStore<Partial<GraphResponse>>(
  {},
);
export const [graphLoading, setGraphLoading] = createSignal(false);
export const [graphError, setGraphError] = createSignal<string | null>(null);
export const [graphFilters, setGraphFilters] = createStore<GraphFilters>({
  limit: 200,
});
export const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(
  null,
);
export const [pinnedNodeIds, setPinnedNodeIds] = createSignal<Set<string>>(
  new Set(),
);
export const [visibleGraphKinds, setVisibleGraphKinds] = createSignal<
  Set<NodeKind>
>(defaultVisibleKinds());

export function togglePin(id: string) {
  setPinnedNodeIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

export function setGraphKindVisibility(kind: NodeKind, visible?: boolean) {
  setVisibleGraphKinds((prev) => {
    const next = new Set(prev);
    const shouldShow = visible ?? !next.has(kind);
    if (shouldShow) next.add(kind);
    else next.delete(kind);

    setGraphFilters('kinds', graphKindFilter(next));
    return next;
  });
}

export function resetGraphFilters() {
  setGraphFilters(reconcile({ limit: 200 }));
  setVisibleGraphKinds(defaultVisibleKinds());
}

export function clearGraph() {
  setGraphNodes([]);
  setGraphEdges([]);
  setGraphMeta(reconcile({}));
  setGraphError(null);
  setSelectedNodeId(null);
}
