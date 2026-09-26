import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  EdgeKind,
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

export const GRAPH_EDGE_KINDS: EdgeKind[] = [
  'association',
  'cluster_member',
  'roaming',
  'same_channel',
  'vendor_link',
  'rf_proximity',
  'probe',
  'shadow',
  'alert_ref',
];

export const GRAPH_LIMITS = [50, 100, 200, 500] as const;

/** Sentinel scope covering the complete filtered inventory. */
export const GRAPH_SCOPE_ALL = 'all' as const;

export type GraphLimit = (typeof GRAPH_LIMITS)[number] | typeof GRAPH_SCOPE_ALL;

function defaultVisibleKinds(): Set<NodeKind> {
  return new Set(GRAPH_NODE_KINDS);
}

function defaultVisibleEdgeKinds(): Set<EdgeKind> {
  return new Set(GRAPH_EDGE_KINDS);
}

function graphKindFilter(kinds: Set<NodeKind>): NodeKind[] | undefined {
  const next = GRAPH_NODE_KINDS.filter((kind) => kinds.has(kind));
  return next.length === GRAPH_NODE_KINDS.length ? undefined : next;
}

function graphEdgeKindFilter(kinds: Set<EdgeKind>): EdgeKind[] | undefined {
  const next = GRAPH_EDGE_KINDS.filter((kind) => kinds.has(kind));
  return next.length === GRAPH_EDGE_KINDS.length ? undefined : next;
}

export const [graphNodes, setGraphNodes] = createSignal<GraphNode[]>([]);
export const [graphEdges, setGraphEdges] = createSignal<GraphEdge[]>([]);
export const [graphMeta, setGraphMeta] = createStore<Partial<GraphResponse>>(
  {},
);
export const [graphLoading, setGraphLoading] = createSignal(false);
export const [graphError, setGraphError] = createSignal<string | null>(null);
/** Loading progress for scope "all" (loaded vs total device coverage). */
export const [graphCoverage, setGraphCoverage] = createSignal<{
  loadedNodes: number;
  totalNodes: number;
  complete: boolean;
} | null>(null);
export const [graphFilters, setGraphFilters] = createStore<GraphFilters>({
  scope: GRAPH_SCOPE_ALL,
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
export const [visibleGraphEdgeKinds, setVisibleGraphEdgeKinds] = createSignal<
  Set<EdgeKind>
>(defaultVisibleEdgeKinds());

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

export function setGraphEdgeKindVisibility(
  kind: EdgeKind,
  visible?: boolean,
) {
  setVisibleGraphEdgeKinds((prev) => {
    const next = new Set(prev);
    const shouldShow = visible ?? !next.has(kind);
    if (shouldShow) next.add(kind);
    else next.delete(kind);

    setGraphFilters('edge_kinds', graphEdgeKindFilter(next));
    return next;
  });
}

export function resetGraphFilters() {
  setGraphFilters(reconcile({ scope: GRAPH_SCOPE_ALL }));
  setVisibleGraphKinds(defaultVisibleKinds());
  setVisibleGraphEdgeKinds(defaultVisibleEdgeKinds());
}

const SAVED_VIEWS_KEY = 'atheros-search.graph-views';
const MAX_SAVED_VIEWS = 12;

export interface GraphSavedView {
  name: string;
  filters: GraphFilters;
  visible_kinds: NodeKind[];
  visible_edge_kinds: EdgeKind[];
}

function sanitizeKindList(
  values: unknown,
  allowed: readonly string[],
): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is string =>
      typeof value === 'string' && allowed.includes(value),
  );
}

export function loadGraphSavedViews(): GraphSavedView[] {
  try {
    const stored = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): GraphSavedView | null => {
        if (typeof item !== 'object' || item === null) return null;
        const record = item as Record<string, unknown>;
        if (typeof record.name !== 'string') return null;
        if (typeof record.filters !== 'object' || record.filters === null) {
          return null;
        }
        return {
          name: record.name,
          filters: record.filters as GraphFilters,
          visible_kinds: sanitizeKindList(
            record.visible_kinds,
            GRAPH_NODE_KINDS,
          ) as NodeKind[],
          visible_edge_kinds: sanitizeKindList(
            record.visible_edge_kinds,
            GRAPH_EDGE_KINDS,
          ) as EdgeKind[],
        };
      })
      .filter((view): view is GraphSavedView => view !== null);
  } catch {
    return [];
  }
}

function persistGraphSavedViews(views: GraphSavedView[]) {
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Storage may be unavailable (private mode, quota); saved views are
    // best-effort and must never break the graph.
  }
}

export function saveCurrentGraphView(name: string): GraphSavedView[] {
  const trimmed = name.trim();
  if (!trimmed) return loadGraphSavedViews();
  const view: GraphSavedView = {
    name: trimmed,
    filters: { ...graphFilters },
    visible_kinds: GRAPH_NODE_KINDS.filter((kind) =>
      visibleGraphKinds().has(kind),
    ),
    visible_edge_kinds: GRAPH_EDGE_KINDS.filter((kind) =>
      visibleGraphEdgeKinds().has(kind),
    ),
  };
  const next = [
    view,
    ...loadGraphSavedViews().filter(
      (existing) => existing.name !== trimmed,
    ),
  ].slice(0, MAX_SAVED_VIEWS);
  persistGraphSavedViews(next);
  return next;
}

export function deleteGraphSavedView(name: string): GraphSavedView[] {
  const next = loadGraphSavedViews().filter(
    (existing) => existing.name !== name,
  );
  persistGraphSavedViews(next);
  return next;
}

export function applyGraphSavedView(view: GraphSavedView) {
  const filters: GraphFilters = { ...view.filters };
  if (!filters.limit && !filters.scope) {
    filters.scope = GRAPH_SCOPE_ALL;
  }
  setGraphFilters(reconcile(filters));
  setVisibleGraphKinds(
    view.visible_kinds.length > 0
      ? new Set(view.visible_kinds)
      : defaultVisibleKinds(),
  );
  setVisibleGraphEdgeKinds(
    view.visible_edge_kinds.length > 0
      ? new Set(view.visible_edge_kinds)
      : defaultVisibleEdgeKinds(),
  );
}

export function clearGraph() {
  setGraphNodes([]);
  setGraphEdges([]);
  setGraphMeta(reconcile({}));
  setGraphError(null);
  setSelectedNodeId(null);
  setGraphCoverage(null);
}
