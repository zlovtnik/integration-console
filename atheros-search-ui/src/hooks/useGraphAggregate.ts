import type { GraphEdge, GraphNode } from '~/api/types';
import { partitionGraphEdges } from './useForceLayout';

export const GRAPH_AGGREGATE_THRESHOLD = 400;

export interface GraphRenderNode extends GraphNode {
  aggregate_group_id?: string;
}

export interface GraphRenderModel {
  nodes: GraphRenderNode[];
  edges: GraphEdge[];
  aggregated: boolean;
  hiddenRelationshipCount: number;
}

interface AggregateGroup {
  id: string;
  members: GraphNode[];
}

function deviceAPId(node: GraphNode, edgesByNode: Map<string, GraphEdge[]>, nodeById: Map<string, GraphNode>): string | undefined {
  const edges = edgesByNode.get(node.id);
  if (!edges) return undefined;
  const apIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== 'association') continue;
    const other = edge.source === node.id ? edge.target : edge.source;
    if (nodeById.get(other)?.kind === 'ap') apIds.add(other);
  }
  if (node.parent_id && apIds.has(node.parent_id)) return node.parent_id;
  return Array.from(apIds).sort()[0];
}

export function buildGraphRenderModel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedAPIds: Set<string>,
  threshold = GRAPH_AGGREGATE_THRESHOLD,
): GraphRenderModel {
  const closed = partitionGraphEdges(nodes, edges);
  if (nodes.length <= threshold) {
    return { nodes, edges, aggregated: false, hiddenRelationshipCount: closed.hiddenRelationshipCount };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const edge of closed.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      const bucket = edgesByNode.get(endpoint) ?? [];
      bucket.push(edge);
      edgesByNode.set(endpoint, bucket);
    }
  }

  const aps: GraphNode[] = [];
  const clusters: GraphNode[] = [];
  const alerts: GraphNode[] = [];
  const looseDevices: GraphNode[] = [];
  const groups = new Map<string, AggregateGroup>();

  for (const node of nodes) {
    if (node.kind !== 'device') {
      if (node.kind === 'ap') aps.push(node);
      else if (node.kind === 'cluster') clusters.push(node);
      else alerts.push(node);
      continue;
    }
    const apID = deviceAPId(node, edgesByNode, nodeById);
    if (!apID) {
      looseDevices.push(node);
      continue;
    }
    const group = groups.get(apID) ?? { id: apID, members: [] };
    group.members.push(node);
    groups.set(apID, group);
  }

  const renderedNodes: GraphRenderNode[] = [
    ...aps.map((node) => ({ ...node, aggregate_group_id: node.id })),
    ...clusters,
    ...alerts,
    ...looseDevices,
  ];
  const nodeIdMap = new Map<string, string>();
  for (const [apID, group] of Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (expandedAPIds.has(apID) || group.members.length === 1) {
      for (const member of group.members) {
        renderedNodes.push({ ...member, aggregate_group_id: apID });
        nodeIdMap.set(member.id, member.id);
      }
      continue;
    }
    const summaryId = `aggregate:${apID}`;
    const summary: GraphRenderNode = {
      id: summaryId,
      kind: 'aggregate_group',
      label: `devices near ${apID.replace('ap:', '')} (${group.members.length})`,
      bssid: apID.replace('ap:', ''),
      occurrence_count: group.members.length,
      aggregate_group_id: apID,
      tags: ['aggregate'],
    };
    renderedNodes.push(summary);
    for (const member of group.members) nodeIdMap.set(member.id, summaryId);
  }

  const renderedIds = new Set(renderedNodes.map((node) => node.id));
  const remappedEdges = new Map<string, GraphEdge>();
  for (const edge of closed.edges) {
    const source = nodeIdMap.get(edge.source) ?? edge.source;
    const target = nodeIdMap.get(edge.target) ?? edge.target;
    if (source === target) continue;
    if (!renderedIds.has(source) || !renderedIds.has(target)) {
      throw new Error(`Graph aggregation lost a relationship endpoint: ${edge.id}`);
    }
    const id = `${edge.kind}:${source}:${target}`;
    if (remappedEdges.has(id)) continue;
    remappedEdges.set(id, { ...edge, id, source, target });
  }

  return {
    nodes: renderedNodes,
    edges: Array.from(remappedEdges.values()),
    aggregated: true,
    hiddenRelationshipCount: closed.hiddenRelationshipCount,
  };
}
