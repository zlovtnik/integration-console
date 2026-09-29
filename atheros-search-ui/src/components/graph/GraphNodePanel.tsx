import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { Pin, PinOff, X } from 'lucide-solid';
import type { GraphNode } from '~/api/types';
import {
  graphEdges,
  graphFilters,
  graphNodes,
  pinnedNodeIds,
  togglePin,
} from '~/stores/graphStore';
import { nodeKindLabel, edgeKindLabel } from '~/hooks/useForceGraph';
import { DetailRow } from './graphPanelUtils';
import {
  CollapsibleNodeList,
  type DerivedListItem,
} from './NodeDetailSections';
import {
  buildGraphRelationIndex,
  isDeviceLike,
  relatedDevices,
  relatedNodes,
  relatedOfKind,
  summarizeGraphNodes,
  type GraphDeviceSummary,
  type GraphRelation,
} from '~/utils/graphRelations';

function weightBasisLabel(basis: string | undefined): string | undefined {
  switch (basis) {
    case 'frame_count':
      return 'frames observed';
    case 'cluster_confidence':
      return 'cluster confidence';
    case 'vendor_match':
      return 'shared vendor OUIs';
    case 'time_overlap_windows':
      return 'shared access points';
    case 'probe_overlap':
      return 'probed SSIDs in common';
    case 'channel_overlap':
      return 'channels in common';
    case 'unspecified':
    case undefined:
    case '':
      return undefined;
    default:
      return basis.replaceAll('_', ' ');
  }
}

/**
 * Edge weight and basis now live on the relation entry rather than the edge
 * object, because the shared index keeps only the far endpoint.
 */
function edgeWeightDetail(relation: GraphRelation): string | undefined {
  const parts: string[] = [];
  const weight = relation.weight;
  if (weight !== undefined && weight > 0) {
    parts.push(String(Math.round(weight * 100) / 100));
  }
  const basis = weightBasisLabel(relation.weight_basis);
  if (basis) parts.push(basis);
  else if (relation.label) parts.push(relation.label);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function compact(values: (string | undefined)[]): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  );
}

function eventSourceMacs(node: GraphNode): string[] {
  const explicit = compact(node.event_source_macs ?? []);
  if (explicit.length > 0) return explicit;
  return compact([node.mac]);
}

function eventSSIDs(node: GraphNode): string[] {
  const graphSSID = graphFilters.ssid?.trim();
  if (graphSSID) return [graphSSID];

  const explicit = compact(node.event_ssids ?? []);
  if (explicit.length > 0) return explicit;
  return compact([node.ssid]);
}

function eventSearchHref(node: GraphNode): string {
  const params = new URLSearchParams({
    q: '*',
    kind: 'SEARCH_KIND_EVENT',
    mode: 'SEARCH_MODE_SPARSE',
    k: '200',
  });
  for (const mac of eventSourceMacs(node)) params.append('mac', mac);
  for (const loc of graphFilters.location_ids ?? []) params.append('loc', loc);
  for (const sensor of graphFilters.sensor_ids ?? [])
    params.append('sensor', sensor);
  if (graphFilters.observed_after)
    params.set('after', graphFilters.observed_after);
  if (graphFilters.observed_before)
    params.set('before', graphFilters.observed_before);
  const ssids = eventSSIDs(node);
  const ssid = ssids.length === 1 ? ssids[0] : undefined;
  if (ssid) params.set('ssid', ssid);
  return `/?${params.toString()}`;
}

function hasEventScope(node: GraphNode): boolean {
  return eventSourceMacs(node).length > 0 || eventSSIDs(node).length === 1;
}

function alertEvidenceString(node: GraphNode, key: string): string | undefined {
  const value = node.alert_evidence?.[key];
  return typeof value === 'string' ? value : undefined;
}

function alertEvidenceNumber(node: GraphNode, key: string): number | undefined {
  const value = node.alert_evidence?.[key];
  return typeof value === 'number' ? value : undefined;
}

function explainHref(node: GraphNode): string | null {
  if (!node.explain_source_key) return null;
  const params = new URLSearchParams({
    query: node.mac ?? node.label,
    kind: node.explain_kind ?? 'SEARCH_KIND_DEVICE',
    return: window.location.pathname + window.location.search,
  });
  return `/explain/${encodeURIComponent(node.explain_source_key)}?${params.toString()}`;
}

/**
 * The joined detail the network projection can actually support. `GraphNode`
 * carries no owner, registration, or alias MAC data, so those rows are omitted
 * rather than reported as unknown; the registry join lives in the inventory
 * projection.
 */
function GraphNodeDetailRows(props: { node: GraphNode }) {
  return (
    <dl class="graph-detail-list">
      <DetailRow label="Display name" value={props.node.display_name} />
      <DetailRow label="MAC" value={props.node.mac} />
      <DetailRow label="Username" value={props.node.username} />
      <DetailRow label="Hostname" value={props.node.hostname} />
      <DetailRow label="OS hint" value={props.node.os_hint} />
      <DetailRow label="SSID" value={props.node.ssid} />
      <DetailRow label="BSSID" value={props.node.bssid} />
      <DetailRow label="Location" value={props.node.location_id} />
      <DetailRow label="Sensor" value={props.node.sensor_id} />
      <DetailRow label="First seen" value={props.node.first_seen} date />
      <DetailRow label="Last seen" value={props.node.last_seen} date />
    </dl>
  );
}

function derivedItems(
  nodes: GraphNode[],
  secondary: (node: GraphNode) => string,
): DerivedListItem[] {
  return nodes.map((node) => ({
    key: node.id,
    primary: node.mac ?? node.label,
    secondary: secondary(node),
    body: <GraphNodeDetailRows node={node} />,
  }));
}

function GraphSummaryRows(props: { summary: GraphDeviceSummary }) {
  return (
    <dl class="graph-detail-list">
      <DetailRow label="Derived identifiers" value={props.summary.total} />
      <DetailRow label="Locations" value={props.summary.locations} />
      <DetailRow label="Sensors" value={props.summary.sensors} />
      <DetailRow label="SSIDs" value={props.summary.ssids} />
      <DetailRow label="Tags" value={props.summary.tags} />
      <DetailRow
        label="Earliest first seen"
        value={props.summary.earliestFirstSeen}
        date
      />
      <DetailRow
        label="Latest last seen"
        value={props.summary.latestLastSeen}
        date
      />
    </dl>
  );
}

/**
 * The shared derived-identifier surface. Rolls the members up into summary rows
 * and keeps the per-identifier join behind one disclosure, matching the
 * inventory panels.
 */
function RelatedIdentifiersSection(props: {
  title: string;
  devices: GraphNode[];
  summary: GraphDeviceSummary;
  edgesLoaded: boolean;
  label?: string;
}) {
  return (
    <section class="graph-panel-section">
      <h3>{props.title}</h3>
      <Show
        when={props.edgesLoaded}
        fallback={
          <p class="graph-panel-empty">
            Derived identifiers are unavailable here. This response carried no
            graph relationships, so memberships are unknown rather than empty.
          </p>
        }
      >
        <Show
          when={props.devices.length > 0}
          fallback={
            <p class="graph-panel-empty">
              No related identifiers in the loaded projection. This does not
              establish that the node is unassociated.
            </p>
          }
        >
          <GraphSummaryRows summary={props.summary} />
          <CollapsibleNodeList
            label={props.label}
            items={derivedItems(props.devices, (node) =>
              nodeKindLabel(node.kind),
            )}
            derivedLabel={props.devices.length === 1 ? 'identifier' : 'identifiers'}
            provenance="Derived from the projection loaded for the current filters. This is not the whole graph."
          />
        </Show>
      </Show>
    </section>
  );
}

function NodeLinkList(props: { title: string; nodes: GraphNode[] }) {
  return (
    <Show when={props.nodes.length > 0}>
      <section class="graph-panel-section">
        <h3>{props.title}</h3>
        <ul class="graph-node-mini-list">
          <For each={props.nodes}>
            {(node) => (
              <li>
                <span>{node.label}</span>
                <span>{nodeKindLabel(node.kind)}</span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

export function GraphNodePanel(props: {
  node: GraphNode;
  onClose: () => void;
}) {
  const index = createMemo(() =>
    buildGraphRelationIndex(graphNodes(), graphEdges()),
  );

  const clusterMembers = createMemo(() =>
    relatedOfKind(index(), props.node.id, 'cluster_member'),
  );
  const deviceClusters = createMemo(() =>
    clusterMembers().filter((node) => node.kind === 'cluster'),
  );
  const associatedNodes = createMemo(() =>
    relatedOfKind(index(), props.node.id, 'association'),
  );
  const associatedAPs = createMemo(() =>
    associatedNodes().filter((node) => node.kind === 'ap'),
  );
  const connectedIdentifiers = createMemo(() =>
    associatedNodes().filter((node) => isDeviceLike(node)),
  );
  const derivedIdentifiers = createMemo(() =>
    relatedDevices(index(), props.node.id).map((item) => item.node),
  );
  const derivedSummary = createMemo(() =>
    summarizeGraphNodes(derivedIdentifiers()),
  );
  const relatedLinks = createMemo(() => relatedNodes(index(), props.node.id));

  const pinned = () => pinnedNodeIds().has(props.node.id);
  const explanation = createMemo(() => explainHref(props.node));

  return (
    <aside
      class="graph-node-panel"
      aria-labelledby="graph-node-panel-title"
      role="complementary"
    >
      <div class="graph-panel-heading">
        <div>
          <p class="caption">{nodeKindLabel(props.node.kind)}</p>
          <h2 id="graph-node-panel-title" class="heading-2">
            {props.node.label}
          </h2>
        </div>
        <div class="graph-panel-actions">
          <button
            type="button"
            class="icon-btn"
            aria-label={pinned() ? 'Unpin node' : 'Pin node'}
            title={pinned() ? 'Unpin node' : 'Pin node'}
            onClick={() => togglePin(props.node.id)}
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
            aria-label="Close node details"
            onClick={() => props.onClose()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <section class="graph-panel-section">
        <dl class="graph-detail-list">
          <DetailRow label="MAC" value={props.node.mac} />
          <DetailRow label="SSID" value={props.node.ssid} />
          <DetailRow label="BSSID" value={props.node.bssid} />
          <DetailRow label="Location" value={props.node.location_id} />
          <DetailRow label="Sensor" value={props.node.sensor_id} />
          <DetailRow label="First seen" value={props.node.first_seen} date />
          <DetailRow label="Last seen" value={props.node.last_seen} date />
          <DetailRow
            label="Latest projected observation"
            value={props.node.created_at}
            date
          />
        </dl>
      </section>

      <Show when={props.node.kind === 'device'}>
        <section class="graph-panel-section">
          <h3>Device</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Display name" value={props.node.display_name} />
            <DetailRow label="Username" value={props.node.username} />
            <DetailRow label="Hostname" value={props.node.hostname} />
            <DetailRow label="OS hint" value={props.node.os_hint} />
          </dl>
        </section>
        <NodeLinkList title="Clusters" nodes={deviceClusters()} />
        <NodeLinkList
          title="Observed AP context in this projection"
          nodes={associatedAPs()}
        />
        <RelatedIdentifiersSection
          title="Derived identifiers"
          devices={derivedIdentifiers()}
          summary={derivedSummary()}
          edgesLoaded={index().edgesLoaded}
        />
      </Show>

      <Show when={props.node.kind === 'cluster'}>
        <section class="graph-panel-section">
          <h3>Cluster</h3>
          <dl class="graph-detail-list">
            <DetailRow label="MAC count" value={props.node.cluster_size} />
            <DetailRow
              label="Centroid samples"
              value={props.node.centroid_sample_count}
            />
            <DetailRow
              label="Centroid updated"
              value={props.node.centroid_updated_at}
              date
            />
          </dl>
        </section>
        <NodeLinkList title="Member MACs" nodes={clusterMembers()} />
        <RelatedIdentifiersSection
          title="Derived identifiers"
          devices={derivedIdentifiers()}
          summary={derivedSummary()}
          edgesLoaded={index().edgesLoaded}
        />
      </Show>

      <Show when={props.node.kind === 'ap'}>
        <section class="graph-panel-section">
          <h3>Access point</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Enabled" value={props.node.enabled} />
            <DetailRow
              label="Observed identifiers in loaded projection"
              value={connectedIdentifiers().length}
            />
            <DetailRow label="Risk score" value={props.node.risk_score} />
            <DetailRow label="Alert" value={props.node.alert_type} />
            <DetailRow label="Severity" value={props.node.alert_severity} />
          </dl>
        </section>
        <NodeLinkList title="Observed identifiers" nodes={connectedIdentifiers()} />
        <RelatedIdentifiersSection
          title="Derived identifiers"
          devices={connectedIdentifiers()}
          summary={summarizeGraphNodes(connectedIdentifiers())}
          edgesLoaded={index().edgesLoaded}
          label="identifiers"
        />
      </Show>

      <Show when={props.node.kind === 'client'}>
        <section class="graph-panel-section">
          <h3>Client</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Probe count" value={props.node.probe_count} />
          </dl>
        </section>
        <NodeLinkList
          title="Observed AP context in this projection"
          nodes={associatedAPs()}
        />
        <RelatedIdentifiersSection
          title="Derived identifiers"
          devices={derivedIdentifiers()}
          summary={derivedSummary()}
          edgesLoaded={index().edgesLoaded}
        />
      </Show>

      <Show when={props.node.kind === 'shadow_alert'}>
        <section class="graph-panel-section">
          <h3>Shadow alert</h3>
          <dl class="graph-detail-list">
            <DetailRow
              label="Reason"
              value={
                alertEvidenceString(props.node, 'reason') ?? props.node.reason
              }
            />
            <DetailRow
              label="Occurrences"
              value={
                alertEvidenceNumber(props.node, 'occurrence_count') ??
                props.node.occurrence_count
              }
            />
            <DetailRow label="Signal" value={props.node.signal_dbm} />
            <DetailRow label="Resolved" value={props.node.resolved_at} date />
          </dl>
        </section>
      </Show>

      <Show when={props.node.kind === 'alert'}>
        <section class="graph-panel-section">
          <h3>Alert</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Type" value={props.node.alert_type} />
            <DetailRow label="Score" value={props.node.score} />
            <DetailRow label="Created" value={props.node.created_at} date />
            <DetailRow label="Resolved" value={props.node.resolved_at} date />
          </dl>
        </section>
      </Show>

      <section class="graph-panel-section">
        <h3>Actions</h3>
        <div class="graph-panel-links">
          <Show when={explanation()}>
            {(href) => (
              <A class="btn btn-secondary" href={href()}>
                Explain
              </A>
            )}
          </Show>
          <Show when={hasEventScope(props.node)}>
            <A class="btn btn-secondary" href={eventSearchHref(props.node)}>
              Search events
            </A>
          </Show>
        </div>
      </section>

      <section class="graph-panel-section">
        <h3>Related links</h3>
        <Show
          when={relatedLinks().length > 0}
          fallback={<p class="graph-panel-empty">No linked nodes.</p>}
        >
          <ul class="graph-node-mini-list">
            <For each={relatedLinks()}>
              {(item) => (
                <li>
                  <span>{item.node.label}</span>
                  <span>
                    {edgeKindLabel(item.kind)}
                    <Show when={edgeWeightDetail(item)}>
                      {(detail) => (
                        <small class="graph-edge-detail">{detail()}</small>
                      )}
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </aside>
  );
}
