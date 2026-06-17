import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { Pin, PinOff, X } from 'lucide-solid';
import type { InventoryNode } from '~/api/types';
import { DetailRow } from '~/components/graph/graphPanelUtils';
import { inventoryNodeKindLabel } from '~/hooks/useInventoryGraph';
import {
  pinnedInventoryNodeIds,
  toggleInventoryPin,
} from '~/stores/inventoryStore';

function compact(values: (string | undefined)[]): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  );
}

function deviceMacs(node: InventoryNode): string[] {
  const known = compact(node.known_macs ?? []);
  if (known.length > 0) return known;
  return compact([node.mac]);
}

function eventSearchHref(node: InventoryNode): string {
  const params = new URLSearchParams({
    q: '*',
    kind: 'SEARCH_KIND_EVENT',
    mode: 'SEARCH_MODE_SPARSE',
    k: '200',
  });
  for (const mac of deviceMacs(node)) params.append('mac', mac);
  return `/?${params.toString()}`;
}

function networkGraphHref(node: InventoryNode): string {
  const params = new URLSearchParams();
  const mac = deviceMacs(node)[0];
  if (mac) params.set('mac', mac);
  return params.toString() ? `/graph?${params.toString()}` : '/graph';
}

export function InventoryNodePanel(props: {
  node: InventoryNode;
  onClose: () => void;
}) {
  const pinned = () => pinnedInventoryNodeIds().has(props.node.id);

  return (
    <aside
      class="graph-node-panel inventory-node-panel"
      aria-labelledby="inventory-node-panel-title"
      role="complementary"
    >
      <div class="graph-panel-heading">
        <div>
          <p class="caption">{inventoryNodeKindLabel(props.node.kind)}</p>
          <h2 id="inventory-node-panel-title" class="heading-2">
            {props.node.label}
          </h2>
        </div>
        <div class="graph-panel-actions">
          <button
            type="button"
            class="icon-btn"
            aria-label={pinned() ? 'Unpin node' : 'Pin node'}
            title={pinned() ? 'Unpin node' : 'Pin node'}
            onClick={() => toggleInventoryPin(props.node.id)}
          >
            <Show
              when={pinned()}
              fallback={<Pin size={16} aria-hidden="true" />}
            >
              <PinOff size={16} aria-hidden="true" />
            </Show>
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Close inventory details"
            onClick={() => props.onClose()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <section class="graph-panel-section">
        <dl class="graph-detail-list">
          <DetailRow label="Display name" value={props.node.display_name} />
          <DetailRow label="MAC" value={props.node.mac} />
          <DetailRow label="Owner" value={props.node.owner_id} />
          <DetailRow label="Location" value={props.node.location_id} />
          <DetailRow label="Active" value={props.node.active} />
          <DetailRow
            label="Registered"
            value={props.node.first_registered}
            date
          />
          <DetailRow label="Last seen" value={props.node.last_seen} date />
        </dl>
      </section>

      <Show when={deviceMacs(props.node).length > 0}>
        <section class="graph-panel-section">
          <h3>Known MACs</h3>
          <ul class="graph-node-mini-list">
            <For each={deviceMacs(props.node)}>
              {(mac) => (
                <li>
                  <span>{mac}</span>
                  <span>identity</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={(props.node.tags?.length ?? 0) > 0}>
        <section class="graph-panel-section">
          <h3>Tags</h3>
          <ul class="inventory-tag-list">
            <For each={props.node.tags}>{(tag) => <li>{tag}</li>}</For>
          </ul>
        </section>
      </Show>

      <Show when={props.node.kind === 'device'}>
        <section class="graph-panel-section">
          <h3>Actions</h3>
          <div class="graph-panel-links">
            <A class="btn btn-secondary" href={networkGraphHref(props.node)}>
              View in network graph
            </A>
            <A class="btn btn-secondary" href={eventSearchHref(props.node)}>
              Search events
            </A>
          </div>
        </section>
      </Show>
    </aside>
  );
}
