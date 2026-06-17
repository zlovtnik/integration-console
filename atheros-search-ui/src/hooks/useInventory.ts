import { batch, onCleanup } from 'solid-js';
import { ApiError, api } from '~/api/client';
import { mockInventoryResponse } from '~/api/inventoryMock';
import type { InventoryFilters, MergeDecision } from '~/api/types';
import {
  captureMergeUndo,
  clearInventory,
  inventoryFilters,
  removeMergeCandidate,
  restoreMergeUndo,
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

function applyInventoryResponse(
  response: ReturnType<typeof mockInventoryResponse>,
) {
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
        applyInventoryResponse(mockInventoryResponse(filters));
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
    const undo = decision === 'merge' ? captureMergeUndo(candidateId) : null;
    removeMergeCandidate(candidateId);

    try {
      await api.mergeDecision(candidateId, decision);
    } catch (err) {
      if (backendEndpointMissing(err)) return undo?.id ?? null;
      if (undo) restoreMergeUndo(undo.id);
      setInventoryError((err as Error).message || 'Merge decision failed.');
      return null;
    }

    return undo?.id ?? null;
  }

  async function undoMerge(undoId: string) {
    const undo = restoreMergeUndo(undoId);
    if (!undo) return false;

    try {
      await api.mergeDecision(undo.candidateId, 'undo_merge');
    } catch (err) {
      if (!backendEndpointMissing(err)) {
        setInventoryError((err as Error).message || 'Undo merge failed.');
      }
    }

    return true;
  }

  function cancel() {
    ctrl?.abort();
    ctrl = null;
    setInventoryLoading(false);
  }

  onCleanup(cancel);
  return { load, cancel, decideMerge, undoMerge };
}
