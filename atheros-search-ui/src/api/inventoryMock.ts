import type {
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryResponse,
} from './types';

const MOCK_NODES: InventoryNode[] = [
  {
    id: 'owner:facilities',
    kind: 'owner',
    label: 'Facilities',
    active: true,
    tags: ['department:operations'],
  },
  {
    id: 'owner:security',
    kind: 'owner',
    label: 'Security Operations',
    active: true,
    tags: ['department:security'],
  },
  {
    id: 'location:lab-east',
    kind: 'location_asset',
    label: 'Lab East',
    active: true,
    location_id: 'lab-east',
    tags: ['site:lab'],
  },
  {
    id: 'location:floor-2',
    kind: 'location_asset',
    label: 'Floor 2',
    active: true,
    location_id: 'floor-2',
    tags: ['site:office'],
  },
  {
    id: 'cluster:radio-a',
    kind: 'cluster',
    label: 'Radio fingerprint A',
    active: true,
    similarity_cluster_id: 'radio-a',
    tags: ['similarity:open'],
  },
  {
    id: 'device:ap-lab-east-1',
    kind: 'device',
    label: 'lab-east-ap-1',
    mac: '70:88:6b:11:22:01',
    known_macs: ['70:88:6b:11:22:01'],
    display_name: 'Lab East AP 1',
    owner_id: 'facilities',
    location_id: 'lab-east',
    first_registered: '2026-05-14T15:24:00Z',
    last_seen: '2026-06-15T19:44:12Z',
    active: true,
    similarity_cluster_id: 'radio-a',
    tags: ['ap', 'managed'],
  },
  {
    id: 'device:badge-printer',
    kind: 'device',
    label: 'badge-printer',
    mac: '50:9a:4c:aa:34:10',
    known_macs: ['50:9a:4c:aa:34:10', '7a:20:9e:42:bd:01'],
    display_name: 'Badge Printer',
    owner_id: 'security',
    location_id: 'floor-2',
    first_registered: '2026-04-21T09:12:00Z',
    last_seen: '2026-06-12T21:02:33Z',
    active: false,
    similarity_cluster_id: 'printer-randomized',
    tags: ['printer', 'randomized-mac'],
  },
  {
    id: 'device:badge-printer-rand',
    kind: 'device',
    label: 'badge-printer-rand',
    mac: '7a:20:9e:42:bd:01',
    known_macs: ['7a:20:9e:42:bd:01'],
    display_name: 'Badge Printer randomized MAC',
    owner_id: 'security',
    location_id: 'floor-2',
    first_registered: '2026-06-10T13:36:20Z',
    last_seen: '2026-06-12T21:02:33Z',
    active: true,
    similarity_cluster_id: 'printer-randomized',
    tags: ['printer', 'merge-review'],
  },
  {
    id: 'merge:badge-printer',
    kind: 'merge_candidate',
    label: 'Badge printer identity merge',
    active: true,
    dedup_confidence: 0.91,
    similarity_cluster_id: 'printer-randomized',
    tags: ['merge-review'],
  },
];

const MOCK_EDGES: InventoryEdge[] = [
  {
    id: 'owns:facilities:ap-lab-east-1',
    source: 'owner:facilities',
    target: 'device:ap-lab-east-1',
    kind: 'owns',
  },
  {
    id: 'located:lab-east:ap-lab-east-1',
    source: 'device:ap-lab-east-1',
    target: 'location:lab-east',
    kind: 'located_at',
  },
  {
    id: 'cluster:radio-a:ap-lab-east-1',
    source: 'device:ap-lab-east-1',
    target: 'cluster:radio-a',
    kind: 'cluster_member',
    weight: 0.82,
  },
  {
    id: 'owns:security:badge-printer',
    source: 'owner:security',
    target: 'device:badge-printer',
    kind: 'owns',
  },
  {
    id: 'owns:security:badge-printer-rand',
    source: 'owner:security',
    target: 'device:badge-printer-rand',
    kind: 'owns',
  },
  {
    id: 'located:floor-2:badge-printer',
    source: 'device:badge-printer',
    target: 'location:floor-2',
    kind: 'located_at',
  },
  {
    id: 'located:floor-2:badge-printer-rand',
    source: 'device:badge-printer-rand',
    target: 'location:floor-2',
    kind: 'located_at',
  },
  {
    id: 'candidate:badge-printer:a',
    source: 'merge:badge-printer',
    target: 'device:badge-printer',
    kind: 'merge_candidate',
    weight: 0.91,
  },
  {
    id: 'candidate:badge-printer:b',
    source: 'merge:badge-printer',
    target: 'device:badge-printer-rand',
    kind: 'merge_candidate',
    weight: 0.91,
  },
  {
    id: 'same-device:badge-printer',
    source: 'device:badge-printer',
    target: 'device:badge-printer-rand',
    kind: 'same_device',
    weight: 0.91,
  },
];

function includesAny(
  values: string[] | undefined,
  filter: string[] | undefined,
) {
  if (!filter || filter.length === 0) return true;
  return values?.some((value) => filter.includes(value)) ?? false;
}

function nodePassesFilters(node: InventoryNode, filters: InventoryFilters) {
  if (filters.active_only && !node.active) return false;
  if (!includesAny(node.tags, filters.tags)) return false;
  if (
    filters.location_ids?.length &&
    node.kind === 'device' &&
    (!node.location_id || !filters.location_ids.includes(node.location_id))
  ) {
    return false;
  }
  if (
    filters.owner_ids?.length &&
    node.kind === 'device' &&
    (!node.owner_id || !filters.owner_ids.includes(node.owner_id))
  ) {
    return false;
  }
  if (
    node.kind === 'merge_candidate' &&
    filters.min_dedup_confidence !== undefined &&
    (node.dedup_confidence ?? 0) < filters.min_dedup_confidence
  ) {
    return false;
  }
  return true;
}

export function mockInventoryResponse(
  filters: InventoryFilters,
): InventoryResponse {
  const limit = filters.limit ?? 400;
  const nodes = MOCK_NODES.filter((node) => nodePassesFilters(node, filters));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = MOCK_EDGES.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const limitedNodes = nodes.slice(0, limit);
  const limitedNodeIds = new Set(limitedNodes.map((node) => node.id));
  const limitedEdges = edges.filter(
    (edge) =>
      limitedNodeIds.has(edge.source) && limitedNodeIds.has(edge.target),
  );

  return {
    nodes: limitedNodes,
    edges: limitedEdges,
    generated_at: new Date().toISOString(),
    node_count: limitedNodes.length,
    edge_count: limitedEdges.length,
    total_registered_count: nodes.filter((node) => node.kind === 'device')
      .length,
  };
}
