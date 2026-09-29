import { For, Show, type JSX } from 'solid-js';
import type { InventoryNode, InventoryNodeKind } from '~/api/types';
import { DetailRow, formatDate } from './graphPanelUtils';
import {
  deviceAliasMacs,
  summarizeDevices,
  type DeviceSummary,
} from '~/utils/inventoryRelations';

/**
 * Number of derived devices rendered before the list is capped. A group can
 * cover the whole filtered inventory (the unclustered group in the pasted
 * report holds 9613 devices), so the full breakdown is always opt-in.
 */
export const DERIVED_DEVICE_PREVIEW_LIMIT = 25;

export const DERIVED_DEVICES_UNAVAILABLE =
  'Derived devices are unavailable here. This report loads one bounded page of identifiers without graph relationships, so sibling, cluster, and ownership detail is not present. Switch to the graph view to resolve them.';

export function registrationLabel(node: InventoryNode): string {
  if (node.registered === undefined) return 'Unknown';
  return node.registered ? 'Registered' : 'Unregistered';
}

/**
 * The joined registry detail every device surface renders. This is the single
 * definition of the join; the inventory graph, the merge candidate panel, the
 * network graph, the table, and the dedupe queue all reuse it.
 */
export function DeviceDetailRows(props: { node: InventoryNode }) {
  return (
    <dl class="graph-detail-list">
      <DetailRow label="Display name" value={props.node.display_name} />
      <DetailRow label="MAC" value={props.node.mac} />
      <DetailRow label="Owner" value={props.node.owner_id} />
      <DetailRow label="Location" value={props.node.location_id} />
      <DetailRow
        label="Registry active (not online status)"
        value={props.node.active}
      />
      <DetailRow label="Registration" value={registrationLabel(props.node)} />
      <DetailRow
        label="Registered"
        value={props.node.first_registered}
        date
      />
      <DetailRow label="First observed" value={props.node.first_seen} date />
      <DetailRow
        label="Last observed (registry lifetime)"
        value={props.node.last_seen}
        date
      />
    </dl>
  );
}

function joinedSummaryLine(node: InventoryNode): string {
  return [
    registrationLabel(node),
    node.owner_id ?? 'Unassigned',
    node.location_id ?? 'Unknown location',
    node.last_seen
      ? `last seen ${formatDate(node.last_seen)}`
      : 'last observed unknown',
  ].join(' · ');
}

/** The compact form used inside the dedupe queue and table identity cells. */
export function DeviceSummaryLine(props: { node: InventoryNode }) {
  return <small>{joinedSummaryLine(props.node)}</small>;
}

export function DeviceSummaryRows(props: { devices: InventoryNode[] }) {
  const summary = (): DeviceSummary => summarizeDevices(props.devices);
  const registration = () => {
    const value = summary();
    const parts = [`${value.registered} registered`];
    if (value.unregistered > 0) parts.push(`${value.unregistered} unregistered`);
    if (value.registrationUnknown > 0) {
      parts.push(`${value.registrationUnknown} unknown`);
    }
    return parts.join(', ');
  };

  return (
    <dl class="graph-detail-list">
      <DetailRow label="Derived devices" value={summary().total} />
      <DetailRow label="Registration split" value={registration()} />
      <DetailRow
        label="Registry active (not online status)"
        value={summary().registryActive}
      />
      <DetailRow label="Owners" value={summary().owners} />
      <DetailRow label="Locations" value={summary().locations} />
      <DetailRow
        label="Earliest first observed"
        value={summary().earliestFirstSeen}
        date
      />
      <DetailRow
        label="Latest last observed"
        value={summary().latestLastSeen}
        date
      />
      <DetailRow
        label="Earliest registered"
        value={summary().earliestFirstRegistered}
        date
      />
    </dl>
  );
}

/**
 * The identity fields a non-device node actually carries. Kept separate from
 * {@link DeviceDetailRows} so an owner, location, or cluster never displays a
 * device row it cannot support.
 */
export function KindIdentityRows(props: { node: InventoryNode }) {
  return (
    <dl class="graph-detail-list">
      <DetailRow
        label={props.node.kind === 'owner' ? 'Owner' : 'Location'}
        value={
          props.node.kind === 'owner'
            ? (props.node.owner_id ?? props.node.label)
            : (props.node.location_id ?? props.node.label)
        }
      />
      <Show when={props.node.kind === 'cluster'}>
        <DetailRow
          label="Pending similarity id"
          value={props.node.similarity_cluster_id}
        />
      </Show>
      <Show when={props.node.kind === 'merge_candidate'}>
        <DetailRow
          label="Pair confidence (0 to 1)"
          value={props.node.dedup_confidence}
        />
      </Show>
    </dl>
  );
}

export function DeviceAliasSection(props: { node: InventoryNode }) {
  const macs = () => deviceAliasMacs(props.node);
  return (
    <Show when={macs().length > 0}>
      <section class="graph-panel-section">
        <h3>Known MACs</h3>
        <ul class="graph-node-mini-list">
          <For each={macs()}>
            {(mac) => (
              <li>
                <span>{mac}</span>
                <span>identity</span>
              </li>
            )}
          </For>
        </ul>
        <Show when={macs().length === 1}>
          <p class="graph-panel-empty">
            Only this identifier is recorded. No alias MACs are retained for it.
          </p>
        </Show>
      </section>
    </Show>
  );
}

export function TagSection(props: { node: InventoryNode }) {
  return (
    <Show when={(props.node.tags?.length ?? 0) > 0}>
      <section class="graph-panel-section">
        <h3>Tags</h3>
        <ul class="inventory-tag-list">
          <For each={props.node.tags}>{(tag) => <li>{tag}</li>}</For>
        </ul>
      </section>
    </Show>
  );
}

/**
 * The member devices of a non-device node, capped behind a disclosure so a
 * whole-inventory group cannot stall the panel. `edgesLoaded` distinguishes
 * "this node has no members" from "memberships were not part of this report".
 */
export function DerivedDeviceList(props: {
  kind: InventoryNodeKind;
  title: string;
  devices: InventoryNode[];
  edgesLoaded: boolean;
  provenance?: string;
}) {
  return (
    <section class="graph-panel-section">
      <h3>{props.title}</h3>
      <Show
        when={props.edgesLoaded}
        fallback={<p class="graph-panel-empty">{DERIVED_DEVICES_UNAVAILABLE}</p>}
      >
        <Show
          when={props.devices.length > 0}
          fallback={
            <p class="graph-panel-empty">
              No related devices in the loaded projection. This does not
              establish that the identifier is unassociated.
            </p>
          }
        >
          <CollapsibleNodeList
            items={props.devices.map((device) => ({
              key: device.id,
              primary:
                deviceAliasMacs(device).join(', ') || device.label || device.id,
              secondary: registrationLabel(device),
              note: joinedSummaryLine(device),
              body: <DeviceDetailRows node={device} />,
            }))}
            provenance={props.provenance}
          />
        </Show>
      </Show>
    </section>
  );
}

export interface DerivedListItem {
  key: string;
  primary: string;
  secondary: string;
  /**
   * Always visible beside the member row, so the compact join does not cost a
   * second click. `body` holds the full join behind the per-member disclosure.
   */
  note?: string | undefined;
  body: JSX.Element;
}

/**
 * The single disclosure implementation behind every derived-node list. The
 * member rows carry the joined detail for the kind they represent, so the
 * inventory and network graphs present the same interaction.
 */
export function CollapsibleNodeList(props: {
  items: DerivedListItem[];
  label?: string | undefined;
  /**
   * Noun for the disclosure. Defaults to the inventory wording, but the
   * projection surface lists identifiers rather than devices.
   */
  derivedLabel?: string | undefined;
  provenance?: string | undefined;
}) {
  const visible = () => props.items.slice(0, DERIVED_DEVICE_PREVIEW_LIMIT);
  const capped = () => props.items.length - visible().length;
  const noun = () =>
    props.label ??
    props.derivedLabel ??
    (props.items.length === 1 ? 'device' : 'devices');

  return (
    <details class="graph-derived-devices">
      <summary>
        Show {props.items.length} derived {noun()}
      </summary>
      <ul class="graph-node-mini-list graph-derived-device-list">
        <For each={visible()}>
          {(item) => (
            <li>
              <Show when={item.note}>
                <small class="graph-derived-note">{item.note}</small>
              </Show>
              <details>
                <summary>
                  <span>{item.primary}</span>
                  <span>{item.secondary}</span>
                </summary>
                {item.body}
              </details>
            </li>
          )}
        </For>
      </ul>
      <Show when={capped() > 0}>
        <p class="graph-panel-empty">
          Showing {DERIVED_DEVICE_PREVIEW_LIMIT} of {props.items.length} derived{' '}
          {noun()}. Narrow the filters to review the rest.
        </p>
      </Show>
      <Show when={props.provenance}>
        <p class="graph-panel-empty">{props.provenance}</p>
      </Show>
    </details>
  );
}

/** Every identifier reachable from a non-device node, for scoped searches. */
export function derivedMacs(devices: InventoryNode[]): string[] {
  const macs = devices.flatMap((device) => deviceAliasMacs(device));
  return Array.from(new Set(macs));
}
