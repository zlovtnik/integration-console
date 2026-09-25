import type { GraphEdge, GraphNode } from '~/api/types';

export const GRAPH_AGGREGATE_THRESHOLD = 400;

export interface GraphRenderModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  aggregated: boolean;
}

interface AggregateGroup {
  id: string;
  members: GraphNode[];
}

function deviceAPId(node: GraphNode, edgesByNode: Map<string, GraphEdge[]>): string | undefined {
  const edges = edgesByNode.get(node.id);
  if (!edges) return undefined;
  for (const edge of edges) {
    if (edge.kind !== 'association') continue;
    if (edge.source === node.id) return edge.target;
    if (edge.target === node.id) return edge.source;
  }
  return undefined;
}

export function buildGraphRenderModel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedAPIds: Set<string>,
  threshold = GRAPH_AGGREGATE_THRESHOLD,
): GraphRenderModel {
  if (nodes.length <= threshold) {
    return { nodes, edges, aggregated: false };
  }

  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
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
    const apID = deviceAPId(node, edgesByNode);
    if (!apID) {
      looseDevices.push(node);
      continue;
    }
    const group = groups.get(apID) ?? { id: apID, members: [] };
    group.members.push(node);
    groups.set(apID, group);
  }

  const renderedNodes: GraphNode[] = [
    ...aps,
    ...clusters,
    ...alerts,
    ...looseDevices,
  ];
  const nodeIdMap = new Map<string, string>();
  for (const [apID, group] of groups) {
    if (expandedAPIds.has(apID) || group.members.length === 1) {
      for (const member of group.members) {
        renderedNodes.push(member);
        nodeIdMap.set(member.id, member.id);
      }
      continue;
    }
    const summaryId = `aggregate:${apID}`;
    const summary: GraphNode = {
      id: summaryId,
      kind: 'cluster',
      label: `devices near ${apID.replace('ap:', '')} (${group.members.length})`,
      bssid: apID.replace('ap:', ''),
      tags: ['aggregate'],
    };
    renderedNodes.push(summary);
    for (const member of group.members) nodeIdMap.set(member.id, summaryId);
  }

  const renderedIds = new Set(renderedNodes.map((node) => node.id));
  const remappedEdges = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const source = nodeIdMap.get(edge.source) ?? edge.source;
    const target = nodeIdMap.get(edge.target) ?? edge.target;
    if (source === target) continue;
    if (!renderedIds.has(source) || !renderedIds.has(target)) continue;
    const id = `${edge.kind}:${source}:${target}`;
    if (remappedEdges.has(id)) continue;
    remappedEdges.set(id, { ...edge, id, source, target });
  }

  return {
    nodes: renderedNodes,
    edges: Array.from(remappedEdges.values()),
    aggregated: true,
  };
}