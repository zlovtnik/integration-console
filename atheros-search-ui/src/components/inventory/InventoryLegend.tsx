import { For } from 'solid-js';
import {
  INVENTORY_NODE_KINDS,
  setInventoryKindVisibility,
  visibleInventoryKinds,
} from '~/stores/inventoryStore';
import {
  inventoryNodeColor,
  inventoryNodeKindLabel,
} from '~/hooks/useInventoryGraph';
import type { InventoryNodeKind } from '~/api/types';

function legendStyle(kind: InventoryNodeKind) {
  return { background: inventoryNodeColor({ kind }) };
}

export function InventoryLegend() {
  return (
    <div
      class="graph-legend inventory-legend"
      aria-label="Inventory node type visibility"
    >
      <For each={INVENTORY_NODE_KINDS}>
        {(kind) => (
          <button
            type="button"
            class={`graph-legend-item ${
              visibleInventoryKinds().has(kind) ? '' : 'hidden'
            }`}
            aria-pressed={visibleInventoryKinds().has(kind)}
            onClick={() => setInventoryKindVisibility(kind)}
          >
            <span
              class="graph-legend-dot inventory-legend-dot"
              style={legendStyle(kind)}
              aria-hidden="true"
            />
            <span>{inventoryNodeKindLabel(kind)}</span>
          </button>
        )}
      </For>
    </div>
  );
}
