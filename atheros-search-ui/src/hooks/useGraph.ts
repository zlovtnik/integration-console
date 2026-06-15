import { onCleanup } from 'solid-js';
import { api } from '~/api/client';
import {
  clearGraph,
  graphFilters,
  setGraphEdges,
  setGraphError,
  setGraphLoading,
  setGraphMeta,
  setGraphNodes,
} from '~/stores/graphStore';

export function useGraph() {
  let ctrl: AbortController | null = null;
  let activeRequestId = 0;

  async function load() {
    ctrl?.abort();
    ctrl = new AbortController();
    const requestId = ++activeRequestId;
    clearGraph();
    setGraphLoading(true);

    try {
      const res = await api.graph({ ...graphFilters }, ctrl.signal);
      setGraphNodes(res.nodes);
      setGraphEdges(res.edges);
      setGraphMeta({
        generated_at: res.generated_at,
        node_count: res.node_count,
        edge_count: res.edge_count,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId === activeRequestId) {
        setGraphError((err as Error).message || 'Graph load failed.');
      }
    } finally {
      if (requestId === activeRequestId) {
        ctrl = null;
        setGraphLoading(false);
      }
    }
  }

  function cancel() {
    ctrl?.abort();
    ctrl = null;
    setGraphLoading(false);
  }

  onCleanup(cancel);
  return { load, cancel };
}
