import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Match,
  Show,
  startTransition,
  Switch,
} from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { DedupQueue } from '~/components/inventory/DedupQueue';
import { InventoryControls } from '~/components/inventory/InventoryControls';
import { InventoryLegend } from '~/components/inventory/InventoryLegend';
import { InventoryNodePanel } from '~/components/inventory/InventoryNodePanel';
import { MergeCandidatePanel } from '~/components/inventory/MergeCandidatePanel';
import { useInventory } from '~/hooks/useInventory';
import {
  filterInventoryByMac,
  useInventoryGraph,
} from '~/hooks/useInventoryGraph';
import { useInventoryGraph3d } from '~/hooks/useInventoryGraph3d';
import { useInventoryUrlSync } from '~/hooks/useInventoryUrlSync';
import type { InventoryFilters, MergeDecision } from '~/api/types';
import {
  expandedInventoryGroupIds,
  inventoryEdges,
  inventoryError,
  inventoryFilters,
  inventoryLoading,
  inventoryMacQuery,
  inventoryNodes,
  inventoryRenderMode,
  inventoryViewMode,
  pinnedInventoryNodeIds,
  recentMergeUndos,
  selectedInventoryNodeId,
  setInventoryViewMode,
  setSelectedInventoryNodeId,
  toggleInventoryGroupExpansion,
  visibleInventoryKinds,
} from '~/stores/inventoryStore';
import '~/styles/graph.css';
import '~/styles/inventory.css';

function snapshotFilters(): InventoryFilters {
  const filters: InventoryFilters = {
    grouping: inventoryFilters.grouping,
  };
  if (inventoryFilters.owner_ids) {
    filters.owner_ids = [...inventoryFilters.owner_ids];
  }
  if (inventoryFilters.location_ids) {
    filters.location_ids = [...inventoryFilters.location_ids];
  }
  if (inventoryFilters.active_only !== undefined) {
    filters.active_only = inventoryFilters.active_only;
  }
  if (inventoryFilters.min_dedup_confidence !== undefined) {
    filters.min_dedup_confidence = inventoryFilters.min_dedup_confidence;
  }
  if (inventoryFilters.tags) filters.tags = [...inventoryFilters.tags];
  if (inventoryFilters.limit !== undefined)
    filters.limit = inventoryFilters.limit;
  return filters;
}

export default function InventoryPage() {
  let svgRef: SVGSVGElement | undefined;
  let canvas3dRef: HTMLDivElement | undefined;
  let filterReloadTimer: number | undefined;
  let rebuildQueued = false;
  const { ready } = useInventoryUrlSync();
  const { load, decideMerge, undoMerge } = useInventory();
  const [activeUndoId, setActiveUndoId] = createSignal<string | null>(null);

  const macFilteredGraph = createMemo(() =>
    filterInventoryByMac(inventoryNodes(), inventoryEdges(), inventoryMacQuery()),
  );
  const graphNodes = () => macFilteredGraph().nodes;
  const graphEdges = () => macFilteredGraph().edges;

  const graph2d = useInventoryGraph(
    () => svgRef,
    graphNodes,
    graphEdges,
    {
      selectedNodeId: selectedInventoryNodeId,
      pinnedNodeIds: pinnedInventoryNodeIds,
      visibleKinds: visibleInventoryKinds,
      grouping: () => inventoryFilters.grouping,
      expandedGroupIds: expandedInventoryGroupIds,
      onNodeClick: (node) =>
        setSelectedInventoryNodeId((current) =>
          current === node.id ? null : node.id,
        ),
      onAggregateClick: toggleInventoryGroupExpansion,
    },
  );
  const graph3d = useInventoryGraph3d(
    () => canvas3dRef,
    graphNodes,
    graphEdges,
    {
      selectedNodeId: selectedInventoryNodeId,
      pinnedNodeIds: pinnedInventoryNodeIds,
      visibleKinds: visibleInventoryKinds,
      grouping: () => inventoryFilters.grouping,
      expandedGroupIds: expandedInventoryGroupIds,
      onNodeClick: (node) =>
        setSelectedInventoryNodeId((current) =>
          current === node.id ? null : node.id,
        ),
      onAggregateClick: toggleInventoryGroupExpansion,
    },
  );

  const selected = createMemo(
    () =>
      inventoryNodes().find((node) => node.id === selectedInventoryNodeId()) ??
      null,
  );
  const activeUndo = createMemo(() => {
    const id = activeUndoId();
    if (!id) return null;
    return recentMergeUndos().find((undo) => undo.id === id) ?? null;
  });
  const dataFilterKey = createMemo(() =>
    JSON.stringify({
      owner_ids: inventoryFilters.owner_ids ?? [],
      location_ids: inventoryFilters.location_ids ?? [],
      active_only: inventoryFilters.active_only ?? false,
      min_dedup_confidence: inventoryFilters.min_dedup_confidence ?? 0,
      tags: inventoryFilters.tags ?? [],
      limit: inventoryFilters.limit ?? 400,
    }),
  );

  onMount(() => {
    document.title = 'Inventory - atheros search';

    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === 'Escape') {
        setSelectedInventoryNodeId(null);
      } else if (event.key.toLowerCase() === 'r') {
        resetActiveGraph();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  createEffect(
    on(ready, (isReady) => {
      if (isReady) void load(snapshotFilters());
    }),
  );

  createEffect(
    on(
      dataFilterKey,
      () => {
        if (!ready()) return;
        window.clearTimeout(filterReloadTimer);
        filterReloadTimer = window.setTimeout(() => {
          void load(snapshotFilters());
        }, 250);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      [
        inventoryNodes,
        inventoryEdges,
        inventoryMacQuery,
        () => inventoryFilters.grouping,
        inventoryRenderMode,
        inventoryViewMode,
        expandedInventoryGroupIds,
      ],
      queueGraphRebuild,
    ),
  );

  onCleanup(() => window.clearTimeout(filterReloadTimer));

  createEffect(() => {
    const selectedId = selectedInventoryNodeId();
    if (!selectedId) return;
    if (!macFilteredGraph().nodes.some((node) => node.id === selectedId)) {
      setSelectedInventoryNodeId(null);
    }
  });

  function queueGraphRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;

    queueMicrotask(() => {
      rebuildQueued = false;
      void startTransition(() => {
        batch(() => {
          graph2d.rebuild();
          graph3d.rebuild();
        });
      });
    });
  }

  function resetActiveGraph() {
    if (inventoryRenderMode() === '3d') graph3d.resetZoom();
    else graph2d.resetZoom();
  }

  async function handleDecision(candidateId: string, decision: MergeDecision) {
    const undoId = await decideMerge(candidateId, decision);
    if (undoId) setActiveUndoId(undoId);
  }

  async function handleUndo(undoId: string) {
    const restored = await undoMerge(undoId);
    if (restored) {
      setActiveUndoId(null);
      setInventoryViewMode('graph');
      graph2d.rebuild();
      graph3d.rebuild();
    }
  }

  return (
    <main id="main-content" class="graph-page inventory-page" tabIndex={-1}>
      <InventoryControls
        onRefresh={() => void load(snapshotFilters())}
        onResetView={resetActiveGraph}
      />

      <Show when={activeUndo()}>
        {(undo) => (
          <div class="inventory-undo-toast" role="status">
            <span>Merged {undo().label}</span>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => void handleUndo(undo().id)}
            >
              Undo merge
            </button>
          </div>
        )}
      </Show>

      <Show
        when={inventoryViewMode() === 'dedup_queue'}
        fallback={
          <div class="graph-canvas-wrap inventory-canvas-wrap">
            <Show when={inventoryLoading()}>
              <div class="inventory-loading" role="status">
                Building inventory...
              </div>
            </Show>
            <Show when={inventoryError()}>
              <div class="inventory-error" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{inventoryError()}</span>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => void load(snapshotFilters())}
                >
                  Retry
                </button>
              </div>
            </Show>
            <Show when={!inventoryLoading() && inventoryNodes().length === 0}>
              <div class="inventory-empty" role="status">
                No inventory devices match the current filters.
              </div>
            </Show>
            <Show
              when={
                !inventoryLoading() &&
                macFilteredGraph().active &&
                macFilteredGraph().matchedNodeIds.size === 0
              }
            >
              <div class="inventory-empty inventory-empty--mac" role="status">
                This MAC is not present in the loaded inventory. Widen filters
                or increase the limit, then refresh.
              </div>
            </Show>
            <Switch>
              <Match when={inventoryRenderMode() === '3d'}>
                <div
                  ref={canvas3dRef}
                  class="graph-canvas inventory-canvas inventory-canvas-3d"
                  role="img"
                  aria-label="3D device inventory graph"
                />
              </Match>
              <Match when={true}>
                <svg
                  ref={svgRef}
                  class="graph-canvas inventory-canvas"
                  aria-label="Device inventory graph"
                />
              </Match>
            </Switch>
            <InventoryLegend />
          </div>
        }
      >
        <DedupQueue
          onSelect={(candidateId) => setSelectedInventoryNodeId(candidateId)}
          onDecision={handleDecision}
        />
      </Show>

      <Show when={selected()}>
        {(node) => (
          <Show
            when={node().kind === 'merge_candidate'}
            fallback={
              <InventoryNodePanel
                node={node()}
                onClose={() => setSelectedInventoryNodeId(null)}
              />
            }
          >
            <MergeCandidatePanel
              node={node()}
              onClose={() => setSelectedInventoryNodeId(null)}
              onDecision={(decision) => handleDecision(node().id, decision)}
            />
          </Show>
        )}
      </Show>
    </main>
  );
}
