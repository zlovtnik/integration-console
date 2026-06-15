import { describe, expect, it } from 'vitest';
import type { GraphNode } from '~/api/types';
import { createSimNodes, type SimNode } from '~/hooks/useForceGraph';

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
