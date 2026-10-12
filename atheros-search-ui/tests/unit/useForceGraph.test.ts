import { describe, expect, it } from 'vitest';
import type { GraphNode } from '~/api/types';
import { createSimNodes, graphLinkPath, relationshipGroups, type SimNode } from '~/hooks/useForceGraph';
import { fitGraphTransform } from '~/hooks/useForceLayout';

const graphNode: GraphNode = {
  id: 'device:aa:bb:cc:dd:ee:ff',
  kind: 'device',
  label: 'lab-client',
};

describe('createSimNodes', () => {
  it('preserves pinned finite positions across rebuilds', () => {
    const previous = new Map<string, SimNode>([
      [
        graphNode.id,
        {
          ...graphNode,
          x: 132.4,
          y: 48.8,
        },
      ],
    ]);

    const [node] = createSimNodes(
      [graphNode],
      new Set([graphNode.id]),
      previous,
    );

    expect(node?.fx).toBeCloseTo(132.4, 1);
    expect(node?.fy).toBeCloseTo(48.8, 1);
    expect(node?.x).toBeCloseTo(132.4, 1);
    expect(node?.y).toBeCloseTo(48.8, 1);
  });

  it('prefers pinned fx and fy coordinates across rebuilds', () => {
    const previous = new Map<string, SimNode>([
      [
        graphNode.id,
        {
          ...graphNode,
          x: 10,
          y: 20,
          fx: 132.4,
          fy: 48.8,
        },
      ],
    ]);

    const [node] = createSimNodes(
      [graphNode],
      new Set([graphNode.id]),
      previous,
    );

    expect(node?.fx).toBeCloseTo(132.4, 1);
    expect(node?.fy).toBeCloseTo(48.8, 1);
    expect(node?.x).toBeCloseTo(132.4, 1);
    expect(node?.y).toBeCloseTo(48.8, 1);
  });

  it('seeds unpinned nodes without fixing them', () => {
    const previous = new Map<string, SimNode>([
      [
        graphNode.id,
        {
          ...graphNode,
          x: 132.4,
          y: 48.8,
        },
      ],
    ]);

    const [node] = createSimNodes([graphNode], new Set(), previous);

    expect(node?.fx).toBeUndefined();
    expect(node?.fy).toBeUndefined();
    expect(node?.x).toBeCloseTo(132.4, 1);
    expect(node?.y).toBeCloseTo(48.8, 1);
  });
});

describe('organic graph geometry', () => {
  it('groups connected observations consistently regardless of input order', () => {
    const nodes = ['ap:a', 'device:a', 'ap:b', 'device:b', 'isolated'].map((id) => ({ id }));
    const edges = [
      { source: 'device:a', target: 'ap:a' },
      { source: 'ap:b', target: 'device:b' },
      { source: 'missing', target: 'ap:a' },
    ];
    const groups = relationshipGroups(nodes, edges);
    expect(groups.get('device:a')).toBe(groups.get('ap:a'));
    expect(groups.get('device:b')).toBe(groups.get('ap:b'));
    expect(groups.get('ap:a')).not.toBe(groups.get('ap:b'));
    expect(groups.get('isolated')).toBe('isolated');
    expect(relationshipGroups([...nodes].reverse(), [...edges].reverse())).toEqual(groups);
  });

  it('fits finite negative coordinates into the actual viewport with padding', () => {
    const positions = [{ x: -450, y: -320 }, { x: 750, y: 600 }, { x: NaN, y: Infinity }];
    for (const [width, height] of [[1200, 680], [280, 400]]) {
      const transform = fitGraphTransform(positions, width!, height!, 48, 1)!;
      expect(transform.k).toBeGreaterThan(0.1);
      expect(transform.k).toBeLessThanOrEqual(1);
      for (const node of positions.slice(0, 2)) {
        const [x, y] = transform.apply([node.x, node.y]);
        expect(x).toBeGreaterThanOrEqual(47.99);
        expect(x).toBeLessThanOrEqual(width! - 47.99);
        expect(y).toBeGreaterThanOrEqual(47.99);
        expect(y).toBeLessThanOrEqual(height! - 47.99);
      }
    }
  });

  it('centers a single node at 100% and rejects empty or invalid bounds', () => {
    const transform = fitGraphTransform([{ x: -5142, y: 20 }], 1000, 600, 48, 1)!;
    expect(transform.apply([-5142, 20])).toEqual([500, 300]);
    expect(transform.k).toBe(1);
    expect(fitGraphTransform([], 1000, 600, 48)).toBeNull();
    expect(fitGraphTransform([{ x: NaN, y: 0 }], 1000, 600, 48)).toBeNull();
    expect(fitGraphTransform([{ x: 0, y: 0 }], 0, 600, 48)).toBeNull();
  });

  it('renders finite curves for normal and self relationships', () => {
    const node = { ...graphNode, x: 10, y: 20 };
    for (const target of [node, { ...node, x: 200, y: -120 }]) {
      const path = graphLinkPath({ id: 'link', source: node, target, kind: 'association' });
      expect(path).toMatch(/^M10,20[QC]/);
      expect(path).not.toMatch(/NaN|Infinity/);
    }
  });
});
