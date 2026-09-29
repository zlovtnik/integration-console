import type { GraphEdge, GraphNode } from '~/api/types';

export interface GraphRelation {
  node: GraphNode;
  kind: GraphEdge['kind'];
  /** The endpoint on the far side of the edge from the selected node. */
  via: string;
  weight?: number;
  weight_basis?: string;
  label?: string;
}

export interface GraphRelationIndex {
  nodesById: Map<string, GraphNode>;
  relatedByNodeId: Map<string, GraphRelation[]>;
  /**
   * False when the response carried no edges at all, so a panel can say the
   * relationships were not part of this report instead of implying zero.
   */
  edgesLoaded: boolean;
}

/**
 * Node kinds that represent an observed identifier. Clients are identifiers
 * scoped to one SSID; devices are identifiers in the identity projection.
 */
export function isDeviceLike(node: GraphNode): boolean {
  return node.kind === 'device' || node.kind === 'client';
}

/**
 * Builds the id-keyed adjacency index behind every network-graph detail panel.
 * Kept as a pure function so the derivation is unit-testable without a DOM.
 */
export function buildGraphRelationIndex(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphRelationIndex {
  const nodesById = new Map<string, GraphNode>();
  const relatedByNodeId = new Map<string, GraphRelation[]>();

  for (const node of nodes) nodesById.set(node.id, node);

  function record(fromId: string, edge: GraphEdge, otherId: string) {
    const other = nodesById.get(otherId);
    if (!other || other.id === fromId) return;
    const list = relatedByNodeId.get(fromId) ?? [];
    if (!list.some((item) => item.node.id === other.id && item.kind === edge.kind)) {
      const relation: GraphRelation = {
        node: other,
        kind: edge.kind,
        via: other.id,
      };
      if (edge.weight !== undefined) relation.weight = edge.weight;
      if (edge.weight_basis !== undefined) {
        relation.weight_basis = edge.weight_basis;
      }
      if (edge.label !== undefined) relation.label = edge.label;
      list.push(relation);
    }
    relatedByNodeId.set(fromId, list);
  }

  for (const edge of edges) {
    record(edge.source, edge, edge.target);
    record(edge.target, edge, edge.source);
  }

  return { nodesById, relatedByNodeId, edgesLoaded: edges.length > 0 };
}

export function relatedNodes(
  index: GraphRelationIndex,
  nodeId: string,
): GraphRelation[] {
  return index.relatedByNodeId.get(nodeId) ?? [];
}

export function relatedOfKind(
  index: GraphRelationIndex,
  nodeId: string,
  kind: GraphEdge['kind'],
): GraphNode[] {
  return relatedNodes(index, nodeId)
    .filter((item) => item.kind === kind)
    .map((item) => item.node);
}

export function relatedDevices(
  index: GraphRelationIndex,
  nodeId: string,
): GraphRelation[] {
  return relatedNodes(index, nodeId).filter((item) => isDeviceLike(item.node));
}

export interface GraphDeviceSummary {
  total: number;
  locations: string;
  sensors: string;
  ssids: string;
  earliestFirstSeen?: string | undefined;
  latestLastSeen?: string | undefined;
  tags: string;
}

function tally(values: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) =>
      right[1] === left[1]
        ? left[0].localeCompare(right[0])
        : right[1] - left[1],
    )
    .map(([key, count]) => `${key} (${count})`)
    .join(', ');
}

function earliest(values: (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function latest(values: (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

/**
 * Rolls derived network-graph nodes up into the single values that stand in
 * for the per-device detail rows. The network projection carries no owner,
 * registration, or alias MAC data, so those are deliberately absent rather than
 * reported as unknown.
 */
export function summarizeGraphNodes(nodes: GraphNode[]): GraphDeviceSummary {
  return {
    total: nodes.length,
    locations: tally(nodes.map((node) => node.location_id)),
    sensors: tally(nodes.map((node) => node.sensor_id)),
    ssids: tally(nodes.flatMap((node) => node.event_ssids ?? [node.ssid])),
    earliestFirstSeen: earliest(nodes.map((node) => node.first_seen)),
    latestLastSeen: latest(nodes.map((node) => node.last_seen)),
    tags: tally(nodes.flatMap((node) => node.tags ?? [])),
  };
}
