import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { Pin, PinOff, X } from 'lucide-solid';
import type { GraphNode } from '~/api/types';
import { graphEdges, graphNodes, pinnedNodeIds, togglePin } from '~/stores/graphStore';
import { nodeKindLabel } from '~/hooks/useForceGraph';

function formatDate(value: string | undefined): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatValue(value: string | number | boolean | undefined): string {
  if (value === undefined || value === '') return 'n/a';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function sourceKey(node: GraphNode): string {
  if (node.mac) return node.mac;
  return node.id.slice(node.id.indexOf(':') + 1);
}

function DetailRow(props: {
  label: string;
  value?: string | number | boolean | undefined;
  date?: boolean;
}) {
  return (
    <div class="graph-detail-row">
      <dt>{props.label}</dt>
      <dd>{props.date ? formatDate(String(props.value ?? '')) : formatValue(props.value)}</dd>
    </div>
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
  const nodesById = createMemo(() => {
    const next = new Map<string, GraphNode>();
    for (const node of graphNodes()) next.set(node.id, node);
    return next;
  });

  const clusterMembers = createMemo(() =>
    graphEdges()
      .filter(
        (edge) =>
          edge.kind === 'cluster_member' && edge.target === props.node.id,
      )
      .map((edge) => nodesById().get(edge.source))
      .filter((node): node is GraphNode => Boolean(node)),
  );

  const deviceClusters = createMemo(() =>
    graphEdges()
      .filter(
        (edge) =>
          edge.kind === 'cluster_member' && edge.source === props.node.id,
      )
      .map((edge) => nodesById().get(edge.target))
      .filter((node): node is GraphNode => Boolean(node)),
  );

  const associatedAP = createMemo(() => {
    const edge = graphEdges().find(
      (item) =>
        item.kind === 'association' && item.source === props.node.id,
    );
    return edge ? nodesById().get(edge.target) : undefined;
  });

  const connectedClients = createMemo(() =>
    graphEdges()
      .filter(
        (edge) =>
          edge.kind === 'association' && edge.target === props.node.id,
      )
      .map((edge) => nodesById().get(edge.source))
      .filter((node): node is GraphNode => Boolean(node)),
  );

  const pinned = () => pinnedNodeIds().has(props.node.id);
  const key = () => sourceKey(props.node);
  const query = () => props.node.mac ?? props.node.label;

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
            <Show when={pinned()} fallback={<Pin size={16} aria-hidden="true" />}>
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
      </Show>

      <Show when={props.node.kind === 'ap'}>
        <section class="graph-panel-section">
          <h3>Access point</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Enabled" value={props.node.enabled} />
            <DetailRow label="Connected clients" value={connectedClients().length} />
          </dl>
        </section>
        <NodeLinkList title="Clients" nodes={connectedClients()} />
      </Show>

      <Show when={props.node.kind === 'client'}>
        <section class="graph-panel-section">
          <h3>Client</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Probe count" value={props.node.probe_count} />
          </dl>
        </section>
        <NodeLinkList
          title="Associated AP"
          nodes={associatedAP() ? [associatedAP()!] : []}
        />
      </Show>

      <Show when={props.node.kind === 'shadow_alert'}>
        <section class="graph-panel-section">
          <h3>Shadow alert</h3>
          <dl class="graph-detail-list">
            <DetailRow label="Reason" value={props.node.reason} />
            <DetailRow
              label="Occurrences"
              value={props.node.occurrence_count}
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
          <A
            class="btn btn-secondary"
            href={`/explain/${encodeURIComponent(key())}?query=${encodeURIComponent(
              query(),
            )}&kind=SEARCH_KIND_DEVICE`}
          >
            Explain
          </A>
          <A
            class="btn btn-secondary"
            href={`/?q=${encodeURIComponent(query())}&kind=SEARCH_KIND_EVENT`}
          >
            Search events
          </A>
        </div>
      </section>
    </aside>
  );
}
