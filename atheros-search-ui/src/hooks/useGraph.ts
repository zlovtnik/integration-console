import { batch, onCleanup } from 'solid-js';
import { api } from '~/api/client';
import { GRAPH_SCOPE_ALL } from '~/stores/graphStore';
import { loadAllGraphPages } from '~/hooks/useGraphPagination';
import {
  clearGraph,
  graphFilters,
  setGraphCoverage,
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
    const signal = ctrl.signal;
    const requestId = ++activeRequestId;
    clearGraph();
    setGraphLoading(true);

    try {
      const filters = { ...graphFilters };
      if (filters.scope === GRAPH_SCOPE_ALL) {
        const outcome = await loadAllGraphPages(
          filters,
          signal,
          (accumulator) => {
            if (requestId !== activeRequestId || signal.aborted) return;
            batch(() => {
              setGraphNodes(accumulator.nodes);
              setGraphEdges(accumulator.edges);
              setGraphMeta({
                generated_at: accumulator.generatedAt,
                node_count: accumulator.nodes.length,
                edge_count: accumulator.edges.length,
                total_node_count: accumulator.totalNodes,
                total_edge_count: accumulator.totalEdges,
              });
              setGraphCoverage({
                loadedNodes: accumulator.nodes.length,
                totalNodes: accumulator.totalNodes,
                complete: false,
              });
            });
          },
        );
        if (requestId !== activeRequestId || signal.aborted) return;
        setGraphCoverage({
          loadedNodes: outcome.loadedNodes,
          totalNodes: outcome.totalNodes,
          complete: outcome.complete,
        });
      } else {
        const res = await api.graph(filters, signal);
        batch(() => {
          setGraphNodes(res.nodes);
          setGraphEdges(res.edges);
          setGraphMeta({
            generated_at: res.generated_at,
            node_count: res.node_count,
            edge_count: res.edge_count,
          });
          setGraphCoverage(null);
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestId === activeRequestId) {
        setGraphError((err as Error).message || 'Graph load failed.');
        setGraphCoverage(null);
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