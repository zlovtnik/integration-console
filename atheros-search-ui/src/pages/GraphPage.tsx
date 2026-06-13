import { createEffect, createMemo, onCleanup, onMount, Show } from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { GraphControls } from '~/components/graph/GraphControls';
import { GraphLegend } from '~/components/graph/GraphLegend';
import { GraphNodePanel } from '~/components/graph/GraphNodePanel';
import { useForceGraph } from '~/hooks/useForceGraph';
import { useGraph } from '~/hooks/useGraph';
import { useSuggest } from '~/hooks/useSuggest';
import {
  graphEdges,
  graphError,
  graphLoading,
  graphNodes,
  pinnedNodeIds,
  selectedNodeId,
  setSelectedNodeId,
  visibleGraphKinds,
} from '~/stores/graphStore';
import '~/styles/graph.css';

export default function GraphPage() {
  let svgRef: SVGSVGElement | undefined;
  const { load } = useGraph();

  useSuggest();

  const graph = useForceGraph(() => svgRef, graphNodes, graphEdges, {
    selectedNodeId,
    pinnedNodeIds,
    visibleKinds: visibleGraphKinds,
    onNodeClick: (node) =>
      setSelectedNodeId((current) => (current === node.id ? null : node.id)),
  });

  const selected = createMemo(
    () => graphNodes().find((node) => node.id === selectedNodeId()) ?? null,
  );

  onMount(() => {
    document.title = 'Device graph - atheros search';
    void load();

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
        setSelectedNodeId(null);
      } else if (event.key.toLowerCase() === 'r') {
        graph.resetZoom();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  createEffect(() => {
    graphNodes();
    graphEdges();
    graph.rebuild();
  });

  return (
    <main id="main-content" class="graph-page" tabIndex={-1}>
      <GraphControls
        onRefresh={() => void load()}
        onResetView={() => graph.resetZoom()}
      />

      <div class="graph-canvas-wrap">
        <Show when={graphLoading()}>
          <div class="graph-loading" role="status">
            Building graph...
          </div>
        </Show>
        <Show when={graphError()}>
          <div class="graph-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{graphError()}</span>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        </Show>
        <svg
          ref={svgRef}
          class="graph-canvas"
          aria-label="Device network graph"
        />
        <GraphLegend />
      </div>

      <Show when={selected()}>
        {(node) => (
          <GraphNodePanel
            node={node()}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </Show>
    </main>
  );
}
