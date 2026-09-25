import { For } from 'solid-js';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  setGraphEdgeKindVisibility,
  setGraphKindVisibility,
  visibleGraphEdgeKinds,
  visibleGraphKinds,
} from '~/stores/graphStore';
import { edgeColor, edgeKindLabel, nodeKindLabel } from '~/hooks/useForceGraph';
import type { EdgeKind, NodeKind } from '~/api/types';

function legendClass(kind: NodeKind): string {
  return `graph-legend-dot graph-legend-dot--${kind}`;
}

export function GraphLegend() {
  return (
    <div class="graph-legend" aria-label="Graph node and edge type visibility">
      <For each={GRAPH_NODE_KINDS}>
        {(kind) => (
          <button
            type="button"
            class={`graph-legend-item ${
              visibleGraphKinds().has(kind) ? '' : 'hidden'
            }`}
            aria-pressed={visibleGraphKinds().has(kind)}
            onClick={() => setGraphKindVisibility(kind)}
          >
            <span class={legendClass(kind)} aria-hidden="true" />
            <span>{nodeKindLabel(kind)}</span>
          </button>
        )}
      </For>
      <span
        class="graph-legend-separator"
        aria-hidden="true"
        role="presentation"
      />
      <For each={GRAPH_EDGE_KINDS}>
        {(kind) => (
          <button
            type="button"
            class={`graph-legend-item graph-legend-item--edge ${
              visibleGraphEdgeKinds().has(kind) ? '' : 'hidden'
            }`}
            aria-pressed={visibleGraphEdgeKinds().has(kind)}
            title={`${edgeKindLabel(kind)} edges`}
            onClick={() => setGraphEdgeKindVisibility(kind)}
          >
            <span
              class="graph-legend-line"
              style={{ 'background-color': edgeColor(kind) }}
              aria-hidden="true"
            />
            <span>{edgeKindLabel(kind)}</span>
          </button>
        )}
      </For>
    </div>
  );
}