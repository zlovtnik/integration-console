import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import * as d3 from 'd3';
import type { GraphEdge, GraphNode, GraphHierarchy } from '~/api/types';
import { buildHierarchyLayout, hierarchyFitTransform, useHierarchyLayout } from '~/hooks/useHierarchyLayout';

vi.mock('d3', async (original) => {
  const actual = await original<typeof d3>();
  return { ...actual, forceSimulation: vi.fn(actual.forceSimulation) };
});

const hierarchy: GraphHierarchy = { root_id: 'ap:root', root_ids: ['ap:root'], truncated: false };
function fanout(count: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const clients: GraphNode[] = Array.from({ length: count }, (_, index) => ({
    id: `device:${String(index).padStart(4, '0')}`, kind: 'device', label: `Device ${index}`,
    parent_id: hierarchy.root_id, depth: 1,
  }));
  return {
    nodes: [{ id: hierarchy.root_id, kind: 'ap', label: 'Root AP', depth: 0 }, ...clients],
    edges: clients.map((node) => ({ id: `edge:${node.id}`, source: node.id, target: hierarchy.root_id,
      kind: 'association', tree_role: 'tree' })),
  };
}

describe('hierarchy layout', () => {
  it.each([20, 200])('fits %i children with the AP at minimum depth', (count) => {
    const fixture = fanout(count);
    const layout = buildHierarchyLayout(fixture.nodes, fixture.edges, hierarchy);
    const root = layout.nodes.find((node) => node.id === hierarchy.root_id)!;
    expect(root.x).toBe(Math.min(...layout.nodes.map((node) => node.x)));
    expect(root.layoutDepth).toBe(0);
    expect(layout.nodes.filter((node) => node.id !== root.id).every((node) => node.x > root.x)).toBe(true);
    expect(new Set(layout.nodes.map((node) => `${node.x},${node.y}`)).size).toBe(count + 1);
    const transform = hierarchyFitTransform(layout, 1000, 700);
    for (const node of layout.nodes) {
      const [x, y] = transform.apply([node.x, node.y]);
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1000);
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(700);
    }
    expect(buildHierarchyLayout([...fixture.nodes].reverse(), [...fixture.edges].reverse(), hierarchy)).toEqual(layout);
  });

  it('uses presentation parents despite device-to-AP evidence and secondary cycles', () => {
    const fixture = fanout(2);
    const initial = buildHierarchyLayout(fixture.nodes, fixture.edges, hierarchy);
    fixture.edges.push({ id: 'peer', source: fixture.nodes[1]!.id, target: fixture.nodes[2]!.id,
      kind: 'rf_proximity', tree_role: 'secondary' });
    expect(buildHierarchyLayout(fixture.nodes, fixture.edges, hierarchy).nodes).toEqual(initial.nodes);
  });

  it('keeps multiple AP roots, unattached, missing-parent and cyclic nodes visible and reports repairs', () => {
    const nodes: GraphNode[] = [
      { id: 'ap:root', kind: 'ap', label: 'Primary AP' },
      { id: 'ap:second', kind: 'ap', label: 'Second AP' },
      { id: 'unattached', kind: 'device', label: 'Unattached' },
      { id: 'missing', kind: 'device', label: 'Missing parent', parent_id: 'absent' },
      { id: 'cycle:a', kind: 'device', label: 'Cycle A', parent_id: 'cycle:b' },
      { id: 'cycle:b', kind: 'device', label: 'Cycle B', parent_id: 'cycle:a' },
    ];
    const layout = buildHierarchyLayout(nodes, [
      { id: 'dangling', source: 'missing', target: 'absent', kind: 'association' },
      { id: 'cycle', source: 'cycle:a', target: 'cycle:b', kind: 'association', tree_role: 'tree' },
    ], hierarchy);
    expect(layout.nodes).toHaveLength(nodes.length);
    expect(layout.unattachedGroup).not.toBeNull();
    expect(layout.issues.join(' ')).toContain('Missing parent');
    expect(layout.issues.join(' ')).toContain('Parent cycle');
    expect(layout.missingRelationships).toBe(1);
    expect(layout.nodes.filter((node) => node.kind === 'ap').every((node) => node.x === 0)).toBe(true);
  });

  it('does not use a secondary relationship as ancestry even with an inconsistent parent pointer', () => {
    const fixture = fanout(1);
    fixture.edges[0]!.tree_role = 'secondary';
    const layout = buildHierarchyLayout(fixture.nodes, fixture.edges, hierarchy);
    expect(layout.issues.join(' ')).toContain('No tree relationship');
    expect(layout.unattachedGroup).not.toBeNull();
  });

  it('places an explicitly focused device root at depth zero without an Unattached label', () => {
    const focused: GraphHierarchy = { root_id: 'device:root', root_ids: ['device:root'], truncated: false };
    const nodes: GraphNode[] = [
      { id: 'device:root', kind: 'device', label: 'Focused client' },
      { id: 'ap:parent', kind: 'ap', label: 'Associated AP', parent_id: 'device:root' },
    ];
    const edges: GraphEdge[] = [{ id: 'association', source: 'device:root', target: 'ap:parent', kind: 'association', tree_role: 'tree' }];
    const layout = buildHierarchyLayout(nodes, edges, focused);
    expect(layout.nodes.find((node) => node.id === focused.root_id)?.x).toBe(0);
    expect(layout.unattachedGroup).toBeNull();
  });

  it('builds the mounted SVG without invoking forceSimulation', () => {
    const spy = vi.mocked(d3.forceSimulation);
    spy.mockClear();
    const fixture = fanout(20);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    let dispose = () => {};
    createRoot((cleanup) => {
      dispose = cleanup;
      const graph = useHierarchyLayout(() => svg, () => fixture.nodes, () => fixture.edges, {
        hierarchy: () => hierarchy, selectedNodeId: () => null, pinnedNodeIds: () => new Set(),
        visibleKinds: () => new Set(['ap', 'device']), visibleEdgeKinds: () => new Set(['association']),
        showSecondary: () => false, onClearSelection: () => {}, onNodeClick: () => {},
      });
      graph.rebuild();
    });
    expect(svg.querySelectorAll('.graph-node')).toHaveLength(21);
    expect(spy).not.toHaveBeenCalled();
    dispose(); svg.remove();
  });
});
