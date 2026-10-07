import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import type { GraphEdge, GraphResponse } from '~/api/types';
import { loadAllGraphPages } from '~/hooks/useGraphPagination';

export function rangeLabel(edge: GraphEdge, now = Date.now()): string {
  const range = edge.range;
  if (edge.kind !== 'calibrated_range' || !edge.source.startsWith('sensor:') ||
      !edge.target.startsWith('device:') || !range || Date.parse(range.valid_until) <= now) {
    return 'No calibrated range available';
  }
  return `Estimated ${range.meters.toFixed(1)} m (${range.lower_meters.toFixed(1)}-${range.upper_meters.toFixed(1)} m); ` +
    `${range.sample_count} samples; calibration ${range.calibration_version}; ${range.confidence}`;
}

/** Each relationship is an edge, not a device's exclusive parent. The table is
 * the accessible equivalent of the graph and preserves multiple AP sightings. */
export function WirelessTopology() {
  const [identity, setIdentity] = createSignal(false);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const [graph, { refetch }] = createResource(() => ({ includeIdentity: identity() }), async ({ includeIdentity }) => {
    controller?.abort();
    controller = new AbortController();
    let response: GraphResponse = { nodes: [], edges: [], node_count: 0, edge_count: 0, generated_at: '' };
    const outcome = await loadAllGraphPages({ projection: 'stream', include_identity: includeIdentity }, controller.signal, (page) => {
      response = { nodes: page.nodes, edges: page.edges, node_count: page.nodes.length,
        edge_count: page.edges.length, generated_at: page.generatedAt };
    });
    if (!outcome.complete) response.next_page_cursor = 'incomplete';
    return response;
  });
  const labels = createMemo(() => new Map(graph()?.nodes.map((node) => [node.id, node.label]) ?? []));
  const topology = createMemo(() => graph()?.edges.filter((edge) => edge.kind !== 'identity_membership') ?? []);
  const identities = createMemo(() => graph()?.edges.filter((edge) => edge.kind === 'identity_membership') ?? []);
  return <section class="report-controls" aria-label="Wireless topology">
    <h2>Wireless topology</h2>
    <p>Observations describe devices seen with an access point, not proof of a connection or ownership.
      Layout spacing does not represent physical distance. Range estimates are sensor-to-device only.</p>
    <label><input type="checkbox" checked={identity()} onChange={(event) => setIdentity(event.currentTarget.checked)} />
      Show reviewed identity memberships as a separate layer</label>
    <button type="button" class="btn btn-secondary" onClick={() => void refetch()}>Refresh topology</button>
    <Show when={graph.loading}><p role="status">Loading topology...</p></Show>
    <Show when={graph.error}><p role="alert">Topology is unavailable. Retry after the projection is enabled.</p></Show>
    <Show when={graph()}>{(data) => <>
      <p>{data().node_count} entities and {data().edge_count} relationships in this page.</p>
      <Show when={data().next_page_cursor}><p>This is a partial view. Additional relationships exist.</p></Show>
      <table><caption>Topology relationships and radio evidence</caption>
        <thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Evidence window</th><th>Freshness and estimated range</th></tr></thead>
        <tbody><For each={topology()}>{(edge) => <tr>
          <td>{labels().get(edge.source) ?? edge.source}</td><td>{edge.label ?? edge.kind}</td>
          <td>{labels().get(edge.target) ?? edge.target}</td>
          <td>{edge.evidence_start ?? 'Current configuration'} {edge.evidence_end ? `to ${edge.evidence_end}` : ''}</td>
          <td>{edge.projection_watermark ?? 'No observation watermark'}<br />
            <Show when={edge.kind === 'calibrated_range'}>{rangeLabel(edge)}</Show></td>
        </tr>}</For></tbody>
      </table>
      <Show when={identity()}><h3>Reviewed identity layer</h3>
        <p>Membership reflects a reviewed identity decision. It does not establish physical proximity.</p>
        <table><caption>Identity memberships</caption><thead><tr><th>Identity cluster</th><th>Device</th></tr></thead>
          <tbody><For each={identities()}>{(edge) => <tr><td>{labels().get(edge.source) ?? edge.source}</td>
            <td>{labels().get(edge.target) ?? edge.target}</td></tr>}</For></tbody></table>
      </Show>
      <Show when={data().nodes.length === 0}><p>No stream projection is available yet.</p></Show>
    </>}</Show>
  </section>;
}
