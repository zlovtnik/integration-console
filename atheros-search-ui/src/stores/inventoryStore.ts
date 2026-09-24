import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryNodeKind,
  InventoryResponse,
} from '~/api/types';

/*
 * Contract assumption:
 * The inventory UI is built against POST /v1/inventory and
 * POST /v1/inventory/merge-candidates/:id/decision in atheros-search.
 * Merge decisions are final; there is no undo endpoint.
 */

export const INVENTORY_NODE_KINDS: InventoryNodeKind[] = [
  'device',
  'owner',
  'location_asset',
  'cluster',
  'merge_candidate',
];

export const INVENTORY_LIMITS = [100, 200, 400, 800] as const;

export type InventoryViewMode = 'graph' | 'dedup_queue';

function defaultVisibleKinds(): Set<InventoryNodeKind> {
  return new Set(INVENTORY_NODE_KINDS);
}

export const [inventoryNodes, setInventoryNodes] = createSignal<
  InventoryNode[]
>([]);
export const [inventoryEdges, setInventoryEdges] = createSignal<
  InventoryEdge[]
>([]);
export const [inventoryMeta, setInventoryMeta] = createStore<
  Partial<InventoryResponse>
>({});
export const [inventoryLoading, setInventoryLoading] = createSignal(false);
export const [inventoryError, setInventoryError] = createSignal<string | null>(
  null,
);
export const [inventoryFilters, setInventoryFilters] =
  createStore<InventoryFilters>({
    grouping: 'registry',
    limit: 400,
    min_dedup_confidence: 0.75,
  });
export const [selectedInventoryNodeId, setSelectedInventoryNodeId] =
  createSignal<string | null>(null);
export const [pinnedInventoryNodeIds, setPinnedInventoryNodeIds] = createSignal<
  Set<string>
>(new Set());
export const [visibleInventoryKinds, setVisibleInventoryKinds] = createSignal<
  Set<InventoryNodeKind>
>(defaultVisibleKinds());
export const [inventoryViewMode, setInventoryViewMode] =
  createSignal<InventoryViewMode>('graph');
export const [expandedInventoryGroupIds, setExpandedInventoryGroupIds] =
  createSignal<Set<string>>(new Set());

export function toggleInventoryPin(id: string) {
  setPinnedInventoryNodeIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

export function setInventoryKindVisibility(
  kind: InventoryNodeKind,
  visible?: boolean,
) {
  setVisibleInventoryKinds((prev) => {
    const next = new Set(prev);
    const shouldShow = visible ?? !next.has(kind);
    if (shouldShow) next.add(kind);
    else next.delete(kind);
    return next;
  });
}

export function toggleInventoryGroupExpansion(groupId: string) {
  setExpandedInventoryGroupIds((prev) => {
    const next = new Set(prev);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    return next;
  });
}

export function resetInventoryFilters() {
  setInventoryFilters(
    reconcile({
      grouping: 'registry',
      limit: 400,
      min_dedup_confidence: 0.75,
    }),
  );
  setVisibleInventoryKinds(defaultVisibleKinds());
  setExpandedInventoryGroupIds(new Set<string>());
}

export function clearInventory() {
  setInventoryNodes([]);
  setInventoryEdges([]);
  setInventoryMeta(reconcile({}));
  setInventoryError(null);
  setSelectedInventoryNodeId(null);
}

export function removeMergeCandidate(candidateId: string) {
  setInventoryNodes((prev) => prev.filter((node) => node.id !== candidateId));
  setInventoryEdges((prev) =>
    prev.filter(
      (edge) => edge.source !== candidateId && edge.target !== candidateId,
    ),
  );
  setSelectedInventoryNodeId(null);
}
