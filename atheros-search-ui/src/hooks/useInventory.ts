import { batch, onCleanup } from 'solid-js';
import { ApiError, api } from '~/api/client';
import type { InventoryFilters, InventoryResponse, MergeDecision } from '~/api/types';
import {
  clearInventory,
  inventoryFilters,
  removeMergeCandidate,
  setInventoryEdges,
  setInventoryError,
  setInventoryLoading,
  setInventoryMeta,
  setInventoryNodes,
} from '~/stores/inventoryStore';

function backendEndpointMissing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 405 || error.status === 501)
  );
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
    const requestId = ++activeRequestId;
    clearInventory();
    setInventoryLoading(true);

    try {
      const response = await api.inventory(filters, ctrl.signal);
      if (requestId !== activeRequestId) return;
      applyInventoryResponse(response);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId !== activeRequestId) return;
      if (backendEndpointMissing(err)) {
        setInventoryError('Inventory endpoint is unavailable.');
        return;
      }
      setInventoryError((err as Error).message || 'Inventory load failed.');
    } finally {
      if (requestId === activeRequestId) {
        ctrl = null;
        setInventoryLoading(false);
      }
    }
  }

  async function decideMerge(candidateId: string, decision: MergeDecision) {
    try {
      await api.mergeDecision(candidateId, decision);
      removeMergeCandidate(candidateId);
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
  return { load, cancel, decideMerge };
}
