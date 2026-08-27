import { describe, expect, it } from 'vitest';
import type { InventoryEdge, InventoryNode } from '~/api/types';
import {
  buildInventoryRenderModel,
  filterInventoryByMac,
  normalizeInventoryMac,
} from '~/hooks/useInventoryGraph';

function device(index: number, extras: Partial<InventoryNode> = {}): InventoryNode {
  return {
    id: `device:${index}`,
    kind: 'device',
    label: `device-${index}`,
    owner_id: 'security',
    location_id: 'floor-2',
    active: true,
    ...extras,
  };
}

describe('buildInventoryRenderModel', () => {
  it('collapses large inventory groups until expanded', () => {
    const nodes = Array.from({ length: 5 }, (_, index) => device(index));
    const edges: InventoryEdge[] = [
      {
        id: 'same:1',
        source: 'device:1',
        target: 'device:2',
        kind: 'same_device',
        weight: 0.9,
      },
    ];

    const collapsed = buildInventoryRenderModel(
      nodes,
      edges,
      'cmdb',
      new Set(),
      2,
    );

    expect(collapsed.aggregated).toBe(true);
    expect(collapsed.nodes).toHaveLength(1);
    expect(collapsed.nodes[0]).toMatchObject({
      id: 'aggregate:owner:security',
      aggregate_group_id: 'owner:security',
      member_count: 5,
    });
    expect(collapsed.edges).toHaveLength(0);

    const expanded = buildInventoryRenderModel(
      nodes,
      edges,
      'cmdb',
      new Set(['owner:security']),
      2,
    );

    expect(expanded.nodes).toHaveLength(5);
    expect(expanded.edges).toHaveLength(1);
  });

  it('normalizes MAC separators and case', () => {
    expect(normalizeInventoryMac('AA-BB:cc.dd ee ff')).toBe('aabbccddeeff');
  });

  it('filters loaded inventory by exact device MAC and related component', () => {
    const nodes: InventoryNode[] = [
      device(1, { mac: 'AA:BB:CC:DD:EE:FF' }),
      device(2, { known_macs: ['11-22-33-44-55-66'] }),
      device(3, { mac: '22:22:22:22:22:22' }),
      {
        id: 'owner:security',
        kind: 'owner',
        label: 'Security',
        active: true,
      },
      {
        id: 'location:floor-2',
        kind: 'location_asset',
        label: 'Floor 2',
        active: true,
      },
      {
        id: 'cluster:7',
        kind: 'cluster',
        label: 'Cluster 7',
        active: true,
      },
      {
        id: 'merge:12',
        kind: 'merge_candidate',
        label: 'Merge review',
        active: true,
      },
    ];
    const edges: InventoryEdge[] = [
      {
        id: 'owns:1',
        source: 'owner:security',
        target: 'device:1',
        kind: 'owns',
      },
      {
        id: 'located:1',
        source: 'device:1',
        target: 'location:floor-2',
        kind: 'located_at',
      },
      {
        id: 'cluster:1',
        source: 'device:1',
        target: 'cluster:7',
        kind: 'cluster_member',
      },
      {
        id: 'merge:1',
        source: 'merge:12',
        target: 'device:1',
        kind: 'merge_candidate',
      },
      {
        id: 'same:1',
        source: 'device:1',
        target: 'device:2',
        kind: 'same_device',
      },
    ];

    const filtered = filterInventoryByMac(nodes, edges, 'aa-bb-cc-dd-ee-ff');

    expect(filtered.active).toBe(true);
    expect(filtered.matchedNodeIds).toEqual(new Set(['device:1']));
    expect(new Set(filtered.nodes.map((node) => node.id))).toEqual(
      new Set([
        'device:1',
        'device:2',
        'owner:security',
        'location:floor-2',
        'cluster:7',
        'merge:12',
      ]),
    );
    expect(filtered.edges).toHaveLength(5);
  });

  it('matches known MACs and reports loaded no-match state', () => {
    const nodes = [device(1, { known_macs: ['11:22:33:44:55:66'] })];
    const matched = filterInventoryByMac(nodes, [], '112233445566');
    expect(matched.nodes.map((node) => node.id)).toEqual(['device:1']);

    const missing = filterInventoryByMac(nodes, [], 'aa:bb:cc:dd:ee:ff');
    expect(missing.active).toBe(true);
    expect(missing.nodes).toHaveLength(0);
    expect(missing.edges).toHaveLength(0);
    expect(missing.matchedNodeIds.size).toBe(0);
  });
});
