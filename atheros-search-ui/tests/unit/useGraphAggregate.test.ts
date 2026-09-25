import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '~/api/types';
import { buildGraphRenderModel } from '~/hooks/useGraphAggregate';

function device(index: number): GraphNode {
  return {
    id: `device:${index}`,
    kind: 'device',
    label: `device-${index}`,
  };
}

function ap(bssid: string): GraphNode {
  return {
    id: `ap:${bssid}`,
    kind: 'ap',
    label: bssid,
  };
}

function association(source: string, target: string): GraphEdge {
  return {
    id: `observed:${source}:${target}`,
    source,
    target,
    kind: 'association',
    weight: 1,
  };
}

describe('buildGraphRenderModel', () => {
  it('returns the source graph untouched below the threshold', () => {
    const nodes = [device(1), ap('aa:aa:aa:aa:aa:aa')];
    const edges = [association('device:1', 'ap:aa:aa:aa:aa:aa:aa')];

    const model = buildGraphRenderModel(nodes, edges, new Set(), 10);

    expect(model.aggregated).toBe(false);
    expect(model.nodes).toBe(nodes);
    expect(model.edges).toBe(edges);
  });

  it('bundles devices per access point above the threshold', () => {
    const nodes = [
      device(1),
      device(2),
      device(3),
      ap('aa:aa:aa:aa:aa:aa'),
    ];
    const edges = [
      association('device:1', 'ap:aa:aa:aa:aa:aa:aa'),
      association('device:2', 'ap:aa:aa:aa:aa:aa:aa'),
      association('device:3', 'ap:aa:aa:aa:aa:aa:aa'),
    ];

    const model = buildGraphRenderModel(nodes, edges, new Set(), 2);

    expect(model.aggregated).toBe(true);
    const aggregate = model.nodes.find((node) =>
      node.id.startsWith('aggregate:'),
    );
    expect(aggregate).toBeDefined();
    expect(aggregate?.label).toContain('(3)');
    expect(model.nodes).toHaveLength(2);
    expect(model.edges).toHaveLength(1);
    const edge = model.edges[0];
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe('association');
    expect(edge?.source?.startsWith('aggregate:')).toBe(true);
  });

  it('expands a bundled group when its access point is expanded', () => {
    const nodes = [
      device(1),
      device(2),
      ap('aa:aa:aa:aa:aa:aa'),
    ];
    const edges = [
      association('device:1', 'ap:aa:aa:aa:aa:aa:aa'),
      association('device:2', 'ap:aa:aa:aa:aa:aa:aa'),
    ];

    const model = buildGraphRenderModel(
      nodes,
      edges,
      new Set(['ap:aa:aa:aa:aa:aa:aa']),
      1,
    );

    expect(model.aggregated).toBe(true);
    expect(model.nodes).toHaveLength(3);
    expect(model.edges).toHaveLength(2);
  });

  it('keeps devices without an association edge loose', () => {
    const nodes = [device(1), device(2), ap('aa:aa:aa:aa:aa:aa')];
    const edges: GraphEdge[] = [];

    const model = buildGraphRenderModel(nodes, edges, new Set(), 1);

    const loose = model.nodes.filter((node) => node.kind === 'device');
    expect(loose).toHaveLength(2);
  });
});