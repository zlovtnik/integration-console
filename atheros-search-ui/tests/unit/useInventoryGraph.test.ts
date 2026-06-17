import { describe, expect, it } from 'vitest';
import type { InventoryEdge, InventoryNode } from '~/api/types';
import { buildInventoryRenderModel } from '~/hooks/useInventoryGraph';

function device(index: number): InventoryNode {
  return {
    id: `device:${index}`,
    kind: 'device',
    label: `device-${index}`,
    owner_id: 'security',
    location_id: 'floor-2',
    active: true,
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
});
