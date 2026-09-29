import { describe, expect, it } from 'vitest';
import type { InventoryEdge, InventoryNode } from '~/api/types';
import {
  buildInventoryRelationIndex,
  derivedDevicesTitle,
  deviceAliasMacs,
  relatedDevices,
  relatedRelations,
  summarizeDevices,
} from '~/utils/inventoryRelations';

function device(
  mac: string,
  overrides: Partial<InventoryNode> = {},
): InventoryNode {
  return {
    id: `device:${mac}`,
    kind: 'device',
    label: mac,
    mac,
    active: true,
    ...overrides,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: InventoryEdge['kind'],
): InventoryEdge {
  return { id, source, target, kind };
}

const owner: InventoryNode = {
  id: 'owner:security',
  kind: 'owner',
  label: 'security',
  owner_id: 'security',
  active: true,
};

const location: InventoryNode = {
  id: 'location:lab',
  kind: 'location_asset',
  label: 'lab',
  location_id: 'lab',
  active: true,
};

const cluster: InventoryNode = {
  id: 'cluster:c1',
  kind: 'cluster',
  label: 'Similarity c1',
  similarity_cluster_id: 'c1',
  active: true,
  tags: ['similarity:pending'],
};

const candidate: InventoryNode = {
  id: 'merge:c2',
  kind: 'merge_candidate',
  label: 'aa:.. / bb:..',
  similarity_cluster_id: 'c2',
  active: true,
};

const laptop = device('aa:11', {
    display_name: 'Laptop',
  owner_id: 'security',
  location_id: 'lab',
  registered: true,
  first_seen: '2026-09-01T00:00:00Z',
  last_seen: '2026-09-10T00:00:00Z',
  first_registered: '2026-09-02T00:00:00Z',
  known_macs: ['aa:11', 'aa:11:alt'],
});
const phone = device('bb:22', {
  owner_id: 'security',
  location_id: 'warehouse',
  registered: false,
  first_seen: '2026-08-01T00:00:00Z',
  last_seen: '2026-09-12T00:00:00Z',
});
const unowned = device('cc:33', { location_id: 'lab' });

const nodes = [owner, location, cluster, candidate, laptop, phone, unowned];

const edges = [
  edge('owns:1', 'owner:security', 'device:aa:11', 'owns'),
  edge('owns:2', 'owner:security', 'device:bb:22', 'owns'),
  edge('located_at:1', 'device:aa:11', 'location:lab', 'located_at'),
  edge('located_at:2', 'device:cc:33', 'location:lab', 'located_at'),
  edge('cluster_member:1', 'device:aa:11', 'cluster:c1', 'cluster_member'),
  edge('cluster_member:2', 'device:cc:33', 'cluster:c1', 'cluster_member'),
  edge('merge_candidate:1', 'merge:c2', 'device:aa:11', 'merge_candidate'),
  edge('merge_candidate:2', 'merge:c2', 'device:bb:22', 'merge_candidate'),
  edge('candidate_pair:1', 'device:aa:11', 'device:bb:22', 'candidate_pair'),
];

const index = buildInventoryRelationIndex(nodes, edges);
const macsOf = (id: string) => relatedDevices(index, id).map((node) => node.mac);

describe('buildInventoryRelationIndex', () => {
  it('derives owned devices from owner-source owns edges', () => {
    expect(macsOf('owner:security')).toEqual(['aa:11', 'bb:22']);
    expect(relatedRelations(index, 'owner:security')).toEqual(['owns']);
  });

  it('derives devices from target-side located_at edges', () => {
    expect(macsOf('location:lab')).toEqual(['aa:11', 'cc:33']);
  });

  it('derives cluster members from target-side cluster_member edges', () => {
    expect(macsOf('cluster:c1')).toEqual(['aa:11', 'cc:33']);
  });

  it('derives merge candidate devices from source-side merge_candidate edges', () => {
    expect(macsOf('merge:c2')).toEqual(['aa:11', 'bb:22']);
  });

  it('relates a device to its candidate pair in both directions', () => {
    expect(macsOf('device:aa:11')).toEqual(['bb:22']);
    expect(macsOf('device:bb:22')).toEqual(['aa:11']);
    expect(macsOf('device:cc:33')).toEqual([]);
  });

  it('never lists a device as its own derived device', () => {
    const self = buildInventoryRelationIndex(
      [device('aa:11')],
      [edge('cluster_member:1', 'device:aa:11', 'device:aa:11', 'cluster_member')],
    );
    expect(relatedDevices(self, 'device:aa:11')).toEqual([]);
  });

  it('reports no members for an owner with no owns edges', () => {
    const sparse = buildInventoryRelationIndex(
      [owner, device('dd:44')],
      [edge('owns:1', 'owner:security', 'device:dd:44', 'owns')],
    );
    expect(relatedDevices(sparse, 'owner:other')).toEqual([]);
  });

  it('ignores endpoints that are not in the loaded node list', () => {
    const partial = buildInventoryRelationIndex(
      [owner],
      [edge('owns:1', 'owner:security', 'device:missing', 'owns')],
    );
    expect(relatedDevices(partial, 'owner:security')).toEqual([]);
  });

  it('deduplicates a device reached by more than one relation', () => {
    const multi = buildInventoryRelationIndex(
      [owner, cluster, device('aa:11')],
      [
        edge('owns:1', 'owner:security', 'device:aa:11', 'owns'),
        edge('cluster_member:1', 'device:aa:11', 'cluster:c1', 'cluster_member'),
      ],
    );
    expect(relatedDevices(multi, 'owner:security')).toHaveLength(1);
    expect(relatedRelations(multi, 'owner:security')).toEqual(['owns']);
  });

  it('reports edgesLoaded so an empty response is distinguishable from no members', () => {
    expect(index.edgesLoaded).toBe(true);
    expect(buildInventoryRelationIndex(nodes, []).edgesLoaded).toBe(false);
  });
});

describe('deviceAliasMacs', () => {
  it('returns the recorded alias set', () => {
    expect(deviceAliasMacs(laptop)).toEqual(['aa:11', 'aa:11:alt']);
  });

  it('falls back to the identifier MAC when no aliases are recorded', () => {
    expect(deviceAliasMacs(device('ee:55'))).toEqual(['ee:55']);
  });

  it('returns nothing for a node with no MAC', () => {
    expect(deviceAliasMacs({ id: 'owner:x', kind: 'owner', label: 'x', active: true })).toEqual(
      [],
    );
  });
});

describe('summarizeDevices', () => {
  const summary = summarizeDevices([laptop, phone, unowned]);

  it('counts members and the registration split', () => {
    expect(summary.total).toBe(3);
    expect(summary.registered).toBe(1);
    expect(summary.unregistered).toBe(1);
    expect(summary.registrationUnknown).toBe(1);
  });

  it('counts registry-active rows, which is not an online status', () => {
    expect(summary.registryActive).toBe(3);
  });

  it('tallies owners and locations with counts', () => {
    expect(summary.owners).toBe('security (2)');
    expect(summary.locations).toBe('lab (2), warehouse (1)');
  });

  it('reports the earliest and latest observation windows', () => {
    expect(summary.earliestFirstSeen).toBe('2026-08-01T00:00:00Z');
    expect(summary.latestLastSeen).toBe('2026-09-12T00:00:00Z');
    expect(summary.earliestFirstRegistered).toBe('2026-09-02T00:00:00Z');
  });

  it('summarises an empty member set without inventing values', () => {
    const empty = summarizeDevices([]);
    expect(empty.total).toBe(0);
    expect(empty.owners).toBe('');
    expect(empty.earliestFirstSeen).toBeUndefined();
  });
});

describe('derivedDevicesTitle', () => {
  it('names owner, location, cluster, and merge candidate groups', () => {
    expect(derivedDevicesTitle('owner', 3)).toBe('Owned devices (3 devices)');
    expect(derivedDevicesTitle('location_asset', 1)).toBe(
      'Devices at this location (1 device)',
    );
    expect(derivedDevicesTitle('cluster', 2)).toBe(
      'Pending similarity members (2 devices)',
    );
    expect(derivedDevicesTitle('merge_candidate', 2)).toBe(
      'Candidate devices (2 devices)',
    );
  });

  it('keeps cluster wording as pending similarity, not a confirmed identity', () => {
    expect(derivedDevicesTitle('cluster', 1)).toContain('Pending similarity');
    expect(derivedDevicesTitle('cluster', 1)).not.toContain('Identity');
  });
});
