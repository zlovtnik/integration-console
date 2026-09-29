import type {
  InventoryEdge,
  InventoryNode,
  InventoryNodeKind,
} from '~/api/types';

/**
 * Relations that can resolve to a device node. The API emits these edges with
 * an asymmetric direction, so the consumer must respect the kind:
 *
 * - `owns`             owner -> device              (anchor on the source)
 * - `merge_candidate`  merge candidate -> device    (anchor on the source)
 * - `located_at`       device -> location           (anchor on the target)
 * - `cluster_member`   device -> cluster            (anchor on the target)
 * - `candidate_pair`   device <-> device
 * - `same_device`      device <-> device (declared; not currently emitted)
 */
export type InventoryRelationKind =
  | 'owns'
  | 'located_at'
  | 'cluster_member'
  | 'merge_candidate'
  | 'candidate_pair'
  | 'same_device';

/** Kinds whose device endpoint is the source, making the source the anchor. */
const SOURCE_ANCHORED: readonly string[] = ['owns', 'merge_candidate'];

const DEVICE_RELATION_EDGES: readonly string[] = [
  'owns',
  'located_at',
  'cluster_member',
  'merge_candidate',
  'candidate_pair',
  'same_device',
];

const DEVICE_PAIR_EDGES: readonly string[] = [
  'candidate_pair',
  'same_device',
];

export interface InventoryRelationIndex {
  nodesById: Map<string, InventoryNode>;
  /** Node id -> device nodes related to it, in first-seen edge order. */
  devicesByNodeId: Map<string, InventoryNode[]>;
  /** Node id -> the edge kinds that produced its derived devices. */
  relationsByNodeId: Map<string, Set<InventoryRelationKind>>;
  /**
   * False when the source response carried no edges at all. Callers must show
   * an "unavailable" state rather than implying a node has no members.
   */
  edgesLoaded: boolean;
}

/**
 * Builds the id-keyed index used by every node detail surface. Call this once
 * per nodes/edges change; it is deliberately not memoised inside a component so
 * that surfaces sharing different stores (graph vs dedupe queue) can pass their
 * own node and edge lists.
 */
export function buildInventoryRelationIndex(
  nodes: InventoryNode[],
  edges: InventoryEdge[],
): InventoryRelationIndex {
  const nodesById = new Map<string, InventoryNode>();
  const devicesByNodeId = new Map<string, InventoryNode[]>();
  const relationsByNodeId = new Map<string, Set<InventoryRelationKind>>();

  for (const node of nodes) nodesById.set(node.id, node);

  function record(
    nodeId: string,
    device: InventoryNode,
    kind: InventoryRelationKind,
  ) {
    // A self-referential edge must not make a device its own member.
    if (device.id === nodeId) return;
    const devices = devicesByNodeId.get(nodeId) ?? [];
    if (!devices.some((item) => item.id === device.id)) devices.push(device);
    devicesByNodeId.set(nodeId, devices);
    const relations = relationsByNodeId.get(nodeId) ?? new Set();
    relations.add(kind);
    relationsByNodeId.set(nodeId, relations);
  }

  for (const edge of edges) {
    if (!DEVICE_RELATION_EDGES.includes(edge.kind)) continue;

    if (DEVICE_PAIR_EDGES.includes(edge.kind)) {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (source?.kind === 'device' && target?.kind === 'device') {
        record(edge.source, target, edge.kind as InventoryRelationKind);
        record(edge.target, source, edge.kind as InventoryRelationKind);
      }
      continue;
    }

    const nodeId = SOURCE_ANCHORED.includes(edge.kind)
      ? edge.source
      : edge.target;
    const device = nodesById.get(
      SOURCE_ANCHORED.includes(edge.kind) ? edge.target : edge.source,
    );
    if (device?.kind === 'device') {
      record(nodeId, device, edge.kind as InventoryRelationKind);
    }
  }

  return {
    nodesById,
    devicesByNodeId,
    relationsByNodeId,
    edgesLoaded: edges.length > 0,
  };
}

export function relatedDevices(
  index: InventoryRelationIndex,
  nodeId: string,
): InventoryNode[] {
  return index.devicesByNodeId.get(nodeId) ?? [];
}

export function relatedRelations(
  index: InventoryRelationIndex,
  nodeId: string,
): InventoryRelationKind[] {
  return Array.from(index.relationsByNodeId.get(nodeId) ?? []);
}

/**
 * Alias MACs for an identity. The API populates `known_macs` for device nodes
 * only, and in practice the column holds just the identifier's own MAC, so a
 * single entry means "no aliases recorded" rather than "one alias".
 */
export function deviceAliasMacs(node: InventoryNode): string[] {
  const known = (node.known_macs ?? [])
    .map((mac) => mac.trim())
    .filter(Boolean);
  if (known.length > 0) return Array.from(new Set(known));
  return node.mac ? [node.mac] : [];
}

export interface DeviceSummary {
  total: number;
  registered: number;
  unregistered: number;
  registrationUnknown: number;
  registryActive: number;
  owners: string;
  locations: string;
  earliestFirstSeen?: string | undefined;
  latestLastSeen?: string | undefined;
  earliestFirstRegistered?: string | undefined;
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

function earliest(
  values: (string | undefined)[],
): string | undefined {
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
 * Rolls a set of device nodes up into the single values a non-device node can
 * honestly present in place of the per-device detail rows.
 */
export function summarizeDevices(devices: InventoryNode[]): DeviceSummary {
  return {
    total: devices.length,
    registered: devices.filter((device) => device.registered === true).length,
    unregistered: devices.filter((device) => device.registered === false)
      .length,
    registrationUnknown: devices.filter(
      (device) => device.registered === undefined,
    ).length,
    registryActive: devices.filter((device) => device.active).length,
    owners: tally(devices.map((device) => device.owner_id)),
    locations: tally(devices.map((device) => device.location_id)),
    earliestFirstSeen: earliest(devices.map((device) => device.first_seen)),
    latestLastSeen: latest(devices.map((device) => device.last_seen)),
    earliestFirstRegistered: earliest(
      devices.map((device) => device.first_registered),
    ),
  };
}

/**
 * Heading for the derived-device list. Cluster nodes are labelled as pending
 * similarity because their id is a merge-candidate id, not a confirmed
 * identity cluster.
 */
export function derivedDevicesTitle(
  kind: InventoryNodeKind,
  total: number,
): string {
  const count = `${total} ${total === 1 ? 'device' : 'devices'}`;
  switch (kind) {
    case 'owner':
      return `Owned devices (${count})`;
    case 'location_asset':
      return `Devices at this location (${count})`;
    case 'cluster':
      return `Pending similarity members (${count})`;
    case 'merge_candidate':
      return `Candidate devices (${count})`;
    default:
      return `Related devices (${count})`;
  }
}
