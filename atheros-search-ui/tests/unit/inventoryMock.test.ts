import { describe, expect, it } from 'vitest';
import { mockInventoryResponse } from '~/api/inventoryMock';

function ids(filters: Parameters<typeof mockInventoryResponse>[0]): string[] {
  return mockInventoryResponse(filters).nodes.map((node) => node.id);
}

describe('mockInventoryResponse', () => {
  it('keeps only non-device nodes associated with owner-filtered devices', () => {
    const nodeIds = ids({ grouping: 'registry', owner_ids: ['facilities'] });

    expect(nodeIds).toContain('owner:facilities');
    expect(nodeIds).toContain('location:lab-east');
    expect(nodeIds).toContain('cluster:radio-a');
    expect(nodeIds).toContain('device:ap-lab-east-1');
    expect(nodeIds).not.toContain('owner:security');
    expect(nodeIds).not.toContain('location:floor-2');
    expect(nodeIds).not.toContain('merge:badge-printer');
  });

  it('keeps merge candidates associated with location-filtered devices', () => {
    const nodeIds = ids({ grouping: 'registry', location_ids: ['floor-2'] });

    expect(nodeIds).toContain('owner:security');
    expect(nodeIds).toContain('location:floor-2');
    expect(nodeIds).toContain('device:badge-printer');
    expect(nodeIds).toContain('device:badge-printer-rand');
    expect(nodeIds).toContain('merge:badge-printer');
    expect(nodeIds).not.toContain('owner:facilities');
    expect(nodeIds).not.toContain('location:lab-east');
    expect(nodeIds).not.toContain('cluster:radio-a');
  });

  it('clamps negative limits before slicing nodes', () => {
    const response = mockInventoryResponse({
      grouping: 'registry',
      limit: -1,
    });

    expect(response.nodes).toHaveLength(0);
    expect(response.edges).toHaveLength(0);
  });
});
