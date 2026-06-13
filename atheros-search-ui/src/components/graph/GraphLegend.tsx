import { For } from 'solid-js';
import {
  GRAPH_NODE_KINDS,
  setGraphKindVisibility,
  visibleGraphKinds,
} from '~/stores/graphStore';
import { nodeKindLabel } from '~/hooks/useForceGraph';
import type { NodeKind } from '~/api/types';

function legendClass(kind: NodeKind): string {
  return `graph-legend-dot graph-legend-dot--${kind}`;
}

export function GraphLegend() {
  return (
    <div class="graph-legend" aria-label="Graph node type visibility">
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
    </div>
  );
}
