import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { Pin, PinOff, X } from 'lucide-solid';
import type { InventoryNode } from '~/api/types';
import {
  DeviceAliasSection,
  DeviceDetailRows,
  DeviceSummaryRows,
  DerivedDeviceList,
  KindIdentityRows,
  TagSection,
  derivedMacs,
} from '~/components/graph/NodeDetailSections';
import { inventoryNodeKindLabel } from '~/hooks/useInventoryGraph';
import { reportLink } from '~/utils/reportNavigation';
import {
  buildInventoryRelationIndex,
  derivedDevicesTitle,
  deviceAliasMacs,
  relatedDevices,
} from '~/utils/inventoryRelations';
import {
  inventoryEdges,
  inventoryNodes,
  pinnedInventoryNodeIds,
  setInventoryFilters,
  setInventoryViewMode,
  toggleInventoryPin,
} from '~/stores/inventoryStore';

/**
 * A URL cannot carry thousands of MAC filters. Derived lists are capped here
 * and the panel states the truncation so a partial search is never mistaken for
 * a complete one.
 */
const MAX_EVENT_MAC_PARAMETERS = 50;

function sharedScopeParams(): URLSearchParams {
  return new URLSearchParams(
    reportLink('/', window.location.pathname, window.location.search).split(
      '?',
    )[1],
  );
}

function eventSearchHref(macs: string[]): string {
  const params = new URLSearchParams({
    q: '*',
    kind: 'SEARCH_KIND_EVENT',
    mode: 'SEARCH_MODE_SPARSE',
    k: '200',
  });
  for (const mac of macs.slice(0, MAX_EVENT_MAC_PARAMETERS)) {
    params.append('mac', mac);
  }
  const shared = sharedScopeParams();
  for (const key of ['loc', 'sensor', 'after', 'before', 'scope_change']) {
    for (const value of shared.getAll(key)) params.append(key, value);
  }
  return `/?${params.toString()}`;
}

function networkGraphHref(node: InventoryNode): string {
  const params = new URLSearchParams(
    reportLink('/graph', window.location.pathname, window.location.search).split(
      '?',
    )[1],
  );
  const mac = deviceAliasMacs(node)[0];
  if (mac) params.set('mac', mac);
  return params.toString() ? `/graph?${params.toString()}` : '/graph';
}

export function InventoryNodePanel(props: {
  node: InventoryNode;
  onClose: () => void;
}) {
  const pinned = () => pinnedInventoryNodeIds().has(props.node.id);
  const index = createMemo(() =>
    buildInventoryRelationIndex(inventoryNodes(), inventoryEdges()),
  );
  const derived = createMemo(() => relatedDevices(index(), props.node.id));
  const isDevice = () => props.node.kind === 'device';
  const scopedMacs = createMemo(() =>
    isDevice() ? deviceAliasMacs(props.node) : derivedMacs(derived()),
  );
  const truncatedSearch = createMemo(
    () => scopedMacs().length > MAX_EVENT_MAC_PARAMETERS,
  );

  function filterTo(field: 'owner_ids' | 'location_ids', value: string) {
    setInventoryFilters(field, [value]);
    setInventoryViewMode('table');
  }

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

      <Show when={isDevice()}>
        <section class="graph-panel-section">
          <Show when={props.node.no_ap_link_in_projection === true}>
            <p title="The latest graph projection may omit retained observations from the selected interval or sensor/site scope.">
              No AP link in this projection. This does not establish that the
              identifier never connected or indicate risk.
            </p>
          </Show>
          <DeviceDetailRows node={props.node} />
        </section>
      </Show>

      <Show when={!isDevice()}>
        <section class="graph-panel-section">
          <KindIdentityRows node={props.node} />
        </section>
        <section class="graph-panel-section">
          <h3>Derived devices</h3>
          <DeviceSummaryRows devices={derived()} />
        </section>
        <DerivedDeviceList
          kind={props.node.kind}
          title={derivedDevicesTitle(props.node.kind, derived().length)}
          devices={derived()}
          edgesLoaded={index().edgesLoaded}
          provenance="Derived from the identifiers and relationships loaded for the current filters. This is not the whole inventory."
        />
      </Show>

      <Show when={isDevice()}>
        <DeviceAliasSection node={props.node} />
      </Show>

      <TagSection node={props.node} />

      <Show when={scopedMacs().length > 0}>
        <section class="graph-panel-section">
          <h3>Actions</h3>
          <div class="graph-panel-links">
            <Show when={isDevice()}>
              <A class="btn btn-secondary" href={networkGraphHref(props.node)}>
                View in network graph
              </A>
            </Show>
            <A class="btn btn-secondary" href={eventSearchHref(scopedMacs())}>
              Search events
            </A>
            <Show when={props.node.kind === 'owner' && props.node.owner_id}>
              {(ownerId) => (
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => filterTo('owner_ids', ownerId())}
                >
                  Filter inventory to this owner
                </button>
              )}
            </Show>
            <Show when={props.node.kind === 'location_asset' && props.node.location_id}>
              {(locationId) => (
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => filterTo('location_ids', locationId())}
                >
                  Filter inventory to this location
                </button>
              )}
            </Show>
            <Show
              when={
                props.node.kind === 'cluster' ||
                props.node.kind === 'merge_candidate'
              }
            >
              <button
                type="button"
                class="btn btn-secondary"
                onClick={() => {
                  setInventoryFilters('needs_identity_review', true);
                  setInventoryViewMode('dedup_queue');
                }}
              >
                Review the identity queue
              </button>
            </Show>
          </div>
          <Show when={truncatedSearch()}>
            <p class="graph-panel-empty">
              Searching the first {MAX_EVENT_MAC_PARAMETERS} of{' '}
              {scopedMacs().length} derived identifiers. Narrow the filters to
              search the remainder.
            </p>
          </Show>
        </section>
      </Show>
    </aside>
  );
}
