import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  startTransition,
} from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { DedupQueue } from '~/components/inventory/DedupQueue';
import { InventoryControls } from '~/components/inventory/InventoryControls';
import { InventoryTable } from '~/components/inventory/InventoryTable';
import { api } from '~/api/client';
import { InventoryLegend } from '~/components/inventory/InventoryLegend';
import { InventoryNodePanel } from '~/components/inventory/InventoryNodePanel';
import { MergeCandidatePanel } from '~/components/inventory/MergeCandidatePanel';
import { useInventory } from '~/hooks/useInventory';
import { useInventoryGraph } from '~/hooks/useInventoryGraph';
import { useInventoryUrlSync } from '~/hooks/useInventoryUrlSync';
import type { InventoryFilters, MergeDecision } from '~/api/types';
import {
  expandedInventoryGroupIds,
  inventoryEdges,
  inventoryError,
  inventoryDecisionNotice,
  inventoryFilters,
  inventoryLoading,
  inventoryNodes,
  inventoryDedupCandidates,
  inventoryViewMode,
  pinnedInventoryNodeIds,
  selectedInventoryNodeId,
  setSelectedInventoryNodeId,
  toggleInventoryGroupExpansion,
  visibleInventoryKinds,
} from '~/stores/inventoryStore';
import '~/styles/graph.css';
import '~/styles/inventory.css';
import '~/styles/reports.css';

function snapshotFilters(): InventoryFilters {
  const filters: InventoryFilters = {
    ...inventoryFilters,
    grouping:
      inventoryViewMode() === 'dedup_queue'
        ? 'similarity'
        : inventoryFilters.grouping,
  };
  if (inventoryFilters.scope !== undefined) {
    filters.scope = inventoryFilters.scope;
  }
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
  const [detailError, setDetailError] = createSignal('');
  let detailController: AbortController | undefined;
  const [rowDetail, { refetch: retryDetail }] = createResource(
    () =>
      selectedInventoryNodeId()?.startsWith('device:')
        ? selectedInventoryNodeId()
        : null,
    async (id) => {
      detailController?.abort();
      detailController = new AbortController();
      setDetailError('');
      try {
        const response = await api.inventory(
          {
            grouping: 'registry',
            scope: 'page',
            page_size: 1,
            source_macs: [id!.slice(7)],
          },
          detailController.signal,
        );
        return response.nodes[0] ?? null;
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError'))
          setDetailError('Identifier detail unavailable.');
        return null;
      }
    },
  );
  let svgRef: SVGSVGElement | undefined;
  let filterReloadTimer: number | undefined;
  let rebuildQueued = false;
  const { ready } = useInventoryUrlSync();
  const { load, decideMerge, loadDedupQueue, cancelDedupQueue } =
    useInventory();

  const graph = useInventoryGraph(
    () => svgRef,
    inventoryNodes,
    inventoryEdges,
    {
      selectedNodeId: selectedInventoryNodeId,
      onClearSelection: () => setSelectedInventoryNodeId(null),
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
      (selectedInventoryNodeId()?.startsWith('device:') &&
      rowDetail()?.id === selectedInventoryNodeId()
        ? rowDetail()
        : null) ??
      inventoryNodes().find((node) => node.id === selectedInventoryNodeId()) ??
      inventoryDedupCandidates().find(
        (node) => node.id === selectedInventoryNodeId(),
      ) ??
      null,
  );
  const dataFilterKey = createMemo(() =>
    JSON.stringify({
      ...inventoryFilters,
      grouping: inventoryFilters.grouping,
      view_mode: inventoryViewMode(),
      owner_ids: inventoryFilters.owner_ids ?? [],
      location_ids: inventoryFilters.location_ids ?? [],
      active_only: inventoryFilters.active_only ?? false,
      min_dedup_confidence: inventoryFilters.min_dedup_confidence ?? 0,
      query: inventoryFilters.query,
      registered: inventoryFilters.registered,
      needs_identity_review: inventoryFilters.needs_identity_review,
      tags: inventoryFilters.tags ?? [],
      scope: inventoryFilters.scope ?? '',
      limit: inventoryFilters.limit ?? 0,
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
        graph.resetZoom();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  createEffect(
    on(ready, (isReady) => {
      if (isReady) {
        if (inventoryViewMode() !== 'table') void load(snapshotFilters());
        if (inventoryViewMode() === 'dedup_queue') void loadDedupQueue();
      }
    }),
  );

  createEffect(
    on(
      dataFilterKey,
      () => {
        if (!ready()) return;
        window.clearTimeout(filterReloadTimer);
        filterReloadTimer = window.setTimeout(() => {
          if (inventoryViewMode() !== 'table') void load(snapshotFilters());
          if (inventoryViewMode() === 'dedup_queue') void loadDedupQueue();
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
        () => inventoryFilters.grouping,
        inventoryViewMode,
        expandedInventoryGroupIds,
      ],
      queueGraphRebuild,
    ),
  );

  onCleanup(() => {
    window.clearTimeout(filterReloadTimer);
    cancelDedupQueue();
    detailController?.abort();
  });

  function queueGraphRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;

    queueMicrotask(() => {
      rebuildQueued = false;
      void startTransition(() => {
        batch(() => graph.rebuild());
      });
    });
  }

  async function handleDecision(candidateId: string, decision: MergeDecision) {
    await decideMerge(candidateId, decision);
  }

  return (
    <main id="main-content" class="graph-page inventory-page" tabIndex={-1}>
      <InventoryControls
        onRefresh={() => {
          void load(snapshotFilters());
          if (inventoryViewMode() === 'dedup_queue') void loadDedupQueue();
        }}
        onResetView={() => graph.resetZoom()}
      />
      <Show when={inventoryDecisionNotice()}>
        <p role="status">{inventoryDecisionNotice()}</p>
      </Show>
      <Show when={inventoryViewMode() === 'table'}>
        <InventoryTable />
      </Show>
      <Show when={rowDetail.loading}>
        <p role="status">Loading identifier detail...</p>
      </Show>
      <Show when={detailError()}>
        <p role="alert">
          {detailError()}{' '}
          <button type="button" onClick={() => void retryDetail()}>
            Retry detail
          </button>
        </p>
      </Show>
      <Show
        when={
          selectedInventoryNodeId()?.startsWith('device:') &&
          !rowDetail.loading &&
          !rowDetail() &&
          !detailError()
        }
      >
        <p role="status">
          This identifier is not in the registry projection. Refresh the report
          to check for changes.
        </p>
      </Show>

      <Show when={inventoryViewMode() !== 'table'}>
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
                  No observed identifiers match the current filters.
                </div>
              </Show>
              <svg
                ref={svgRef}
                class="graph-canvas inventory-canvas"
                aria-label="Device inventory graph"
              />
              <InventoryLegend />
            </div>
          }
        >
          <DedupQueue
            onSelect={(candidateId) => setSelectedInventoryNodeId(candidateId)}
            onDecision={handleDecision}
          />
        </Show>
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
