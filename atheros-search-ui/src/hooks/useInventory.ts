import { batch, onCleanup } from 'solid-js';
import { ApiError, api } from '~/api/client';
import type {
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryResponse,
  MergeDecision,
} from '~/api/types';
import { INVENTORY_SCOPE_ALL } from '~/stores/inventoryStore';
import {
  clearInventory,
  inventoryFilters,
  removeMergeCandidate,
  setInventoryCoverage,
  setInventoryDedupCandidates,
  setInventoryDedupDevices,
  setInventoryDedupEdges,
  setInventoryDedupError,
  setInventoryDedupLoading,
  setInventoryDedupMeta,
  setInventoryEdges,
  setInventoryError,
  setInventoryLoading,
  setInventoryMeta,
  setInventoryNodes,
} from '~/stores/inventoryStore';

const DEDUP_PAGE_SIZE = 500;
const MAX_PAGES = 200;

function backendEndpointMissing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 405 || error.status === 501)
  );
}

export function stripMergeNodePrefix(nodeId: string): string {
  return nodeId.startsWith('merge:') ? nodeId.slice('merge:'.length) : nodeId;
}

function applyInventoryResponse(response: InventoryResponse) {
  batch(() => {
    setInventoryNodes(response.nodes);
    setInventoryEdges(response.edges);
    setInventoryMeta({
      generated_at: response.generated_at,
      node_count: response.node_count,
      edge_count: response.edge_count,
      total_registered_count: response.total_registered_count,
    });
  });
}

export function useInventory() {
  let ctrl: AbortController | null = null;
  let activeRequestId = 0;

  async function load(filters: InventoryFilters = { ...inventoryFilters }) {
    ctrl?.abort();
    ctrl = new AbortController();
    const signal = ctrl.signal;
    const requestId = ++activeRequestId;
    clearInventory();
    setInventoryLoading(true);

    try {
      if (filters.scope === INVENTORY_SCOPE_ALL) {
        const nodeIds = new Set<string>();
        const edgeIds = new Set<string>();
        const nodes: InventoryNode[] = [];
        const edges: InventoryEdge[] = [];
        let totalRegistered = 0;
        let totalDevices: number | undefined;
        let loadedDevices = 0;
        let generatedAt = '';
        let pages = 0;
        let cursor: string | undefined;

        for (;;) {
          if (signal.aborted) return;
          const response = await api.inventoryPage(
            { ...filters, scope: INVENTORY_SCOPE_ALL },
            cursor,
            signal,
          );
          pages += 1;
          for (const node of response.nodes) {
            if (nodeIds.has(node.id)) continue;
            nodeIds.add(node.id);
            nodes.push(node);
            if (node.kind === 'device') loadedDevices += 1;
          }
          for (const edge of response.edges) {
            if (edgeIds.has(edge.id)) continue;
            edgeIds.add(edge.id);
            edges.push(edge);
          }
          totalRegistered = response.total_registered_count;
          if (response.total_device_count !== undefined) {
            totalDevices = response.total_device_count;
          }
          if (!generatedAt) generatedAt = response.generated_at;

          batch(() => {
            setInventoryNodes([...nodes]);
            setInventoryEdges([...edges]);
            const meta: Partial<InventoryResponse> = {
              generated_at: generatedAt,
              node_count: nodes.length,
              edge_count: edges.length,
              total_registered_count: totalRegistered,
            };
            if (totalDevices !== undefined) {
              meta.total_device_count = totalDevices;
            }
            setInventoryMeta(meta);
            setInventoryCoverage({
              loadedNodes: loadedDevices,
              totalNodes: totalDevices ?? loadedDevices,
              totalDevices: totalDevices ?? loadedDevices,
              complete: false,
            });
          });

          cursor = response.next_page_cursor ?? undefined;
          if (!cursor) break;
          if (pages >= MAX_PAGES) {
            throw new Error(
              `Inventory pagination did not complete after ${MAX_PAGES} pages.`,
            );
          }
        }

        if (requestId !== activeRequestId || signal.aborted) return;
        setInventoryCoverage({
          loadedNodes: loadedDevices,
          totalNodes: totalDevices ?? loadedDevices,
          totalDevices: totalDevices ?? loadedDevices,
          complete: true,
        });
      } else {
        const response = await api.inventory(filters, signal);
        if (requestId !== activeRequestId) return;
        applyInventoryResponse(response);
        setInventoryCoverage(null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId !== activeRequestId) return;
      if (backendEndpointMissing(err)) {
        setInventoryError('Inventory endpoint is unavailable.');
        return;
      }
      setInventoryError((err as Error).message || 'Inventory load failed.');
      setInventoryCoverage(null);
    } finally {
      if (requestId === activeRequestId) {
        ctrl = null;
        setInventoryLoading(false);
      }
    }
  }

  async function decideMerge(candidateId: string, decision: MergeDecision) {
    try {
      await api.mergeDecision(stripMergeNodePrefix(candidateId), decision);
      removeMergeCandidate(candidateId);
      removeDedupCandidate(candidateId);
      return true;
    } catch (err) {
      setInventoryError((err as Error).message || 'Merge decision failed.');
      return false;
    }
  }

  function cancel() {
    ctrl?.abort();
    ctrl = null;
    setInventoryLoading(false);
  }

  onCleanup(cancel);
  return { load, cancel, decideMerge, loadDedupQueue, cancelDedupQueue };
}

let dedupCtrl: AbortController | null = null;
let dedupRequestId = 0;

export function removeDedupCandidate(candidateId: string) {
  const id = stripMergeNodePrefix(candidateId);
  setInventoryDedupCandidates((prev) =>
    prev.filter((item) => stripMergeNodePrefix(item.id) !== id),
  );
  setInventoryDedupEdges((prev) =>
    prev.filter(
      (edge) =>
        stripMergeNodePrefix(edge.source) !== id &&
        stripMergeNodePrefix(edge.target) !== id,
    ),
  );
}

/**
 * The dedupe queue loads candidates, their edges, and the referenced devices
 * independently of the inventory graph sampling, so graph grouping or limits
 * cannot hide candidates or blank out their identities. It walks its own
 * pagination over the filtered inventory.
 */
export async function loadDedupQueue(): Promise<void> {
  dedupCtrl?.abort();
  dedupCtrl = new AbortController();
  const signal = dedupCtrl.signal;
  const requestId = ++dedupRequestId;
  setInventoryDedupLoading(true);
  setInventoryDedupError(null);

  try {
    const confidence = inventoryFilters.min_dedup_confidence;
    const filters: InventoryFilters = {
      grouping: 'similarity',
      scope: INVENTORY_SCOPE_ALL,
      page_size: DEDUP_PAGE_SIZE,
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
    if (inventoryFilters.tags) {
      filters.tags = [...inventoryFilters.tags];
    }
    if (confidence !== undefined) {
      filters.min_dedup_confidence = confidence;
    }

    const candidateIds = new Set<string>();
    const edgeIds = new Set<string>();
    const candidates: InventoryNode[] = [];
    const candidateEdges: InventoryEdge[] = [];
    const deviceById = new Map<string, InventoryNode>();
    let pages = 0;
    let cursor: string | undefined;

    function referencedDevices(): InventoryNode[] {
      const referenced = new Set<string>();
      for (const edge of candidateEdges) {
        referenced.add(edge.source);
        referenced.add(edge.target);
      }
      const devices: InventoryNode[] = [];
      for (const id of referenced) {
        const device = deviceById.get(id);
        if (device) devices.push(device);
      }
      return devices;
    }

    for (;;) {
      if (signal.aborted) return;
      const response = await api.inventoryPage(filters, cursor, signal);
      pages += 1;
      for (const node of response.nodes) {
        if (node.kind === 'device') {
          deviceById.set(node.id, node);
          continue;
        }
        if (node.kind !== 'merge_candidate') continue;
        if (candidateIds.has(node.id)) continue;
        candidateIds.add(node.id);
        candidates.push(node);
      }
      for (const edge of response.edges) {
        if (edge.kind !== 'merge_candidate') continue;
        if (edgeIds.has(edge.id)) continue;
        edgeIds.add(edge.id);
        candidateEdges.push(edge);
      }

      batch(() => {
        setInventoryDedupCandidates([...candidates]);
        setInventoryDedupEdges([...candidateEdges]);
        setInventoryDedupDevices(referencedDevices());
        setInventoryDedupMeta({
          total_candidates: candidates.length,
          pages,
          complete: false,
        });
      });

      cursor = response.next_page_cursor ?? undefined;
      if (!cursor) break;
      if (pages >= MAX_PAGES) {
        throw new Error(
          `Dedupe queue pagination did not complete after ${MAX_PAGES} pages.`,
        );
      }
    }

    if (requestId !== dedupRequestId || signal.aborted) return;
    batch(() => {
      setInventoryDedupCandidates([...candidates]);
      setInventoryDedupEdges([...candidateEdges]);
      setInventoryDedupDevices(referencedDevices());
      setInventoryDedupMeta({
        total_candidates: candidates.length,
        pages,
        complete: true,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    if (requestId !== dedupRequestId) return;
    setInventoryDedupError(
      (err as Error).message || 'Dedupe queue load failed.',
    );
  } finally {
    if (requestId === dedupRequestId) {
      dedupCtrl = null;
      setInventoryDedupLoading(false);
    }
  }
}

export function cancelDedupQueue() {
  dedupCtrl?.abort();
  dedupCtrl = null;
  setInventoryDedupLoading(false);
}