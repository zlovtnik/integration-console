import { For } from 'solid-js';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  visibleGraphEdgeKinds,
  visibleGraphKinds,
} from '~/stores/graphStore';
import {
  edgeColor,
  edgeDash,
  edgeKindLabel,
  nodeKindLabel,
} from '~/hooks/useForceGraph';
import type { NodeKind } from '~/api/types';

function legendClass(kind: NodeKind): string {
  return `graph-legend-dot graph-legend-dot--${kind}`;
}

function itemClass(visible: boolean, extra = ''): string {
  return `graph-legend-item ${extra} ${visible ? '' : 'hidden'}`.trim();
}

export function GraphLegend() {
  return (
    <div
      class="graph-legend graph-legend--grouped"
      aria-label="Graph color key"
    >
      <div class="graph-legend-section">
        <p class="graph-legend-heading">Nodes</p>
        <ul class="graph-legend-list">
          <For each={GRAPH_NODE_KINDS}>
            {(kind) => (
              <li class={itemClass(visibleGraphKinds().has(kind))}>
                <span class={legendClass(kind)} aria-hidden="true" />
                <span>{nodeKindLabel(kind)}</span>
              </li>
            )}
          </For>
        </ul>
      </div>

      <div class="graph-legend-section">
        <p class="graph-legend-heading">Edges</p>
        <ul class="graph-legend-list">
          <For each={GRAPH_EDGE_KINDS}>
            {(kind) => (
              <li
                class={itemClass(
                  visibleGraphEdgeKinds().has(kind),
                  'graph-legend-item--edge',
                )}
                title={`${edgeKindLabel(kind)} edges`}
              >
                <span
                  class="graph-legend-line"
                  style={{
                    'border-top': `2px ${edgeDash(kind) ? 'dashed' : 'solid'} ${edgeColor(kind)}`,
                  }}
                  aria-hidden="true"
                />
                <span>{edgeKindLabel(kind)}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
