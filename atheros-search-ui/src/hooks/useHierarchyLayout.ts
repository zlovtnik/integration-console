import * as d3 from 'd3';
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { EdgeKind, GraphEdge, GraphHierarchy, GraphNode, NodeKind } from '~/api/types';
import { useGraphPresentation } from './graphPresentation';
import { nodeColor, nodeKindLabel, nodeRadius, edgeColor, edgeDash } from './useForceGraph';
import { scaleFor } from './useForceLayout';

export interface HierarchyNode extends GraphNode {
  x: number;
  y: number;
  layoutDepth: number;
}

export interface HierarchyLayout {
  nodes: HierarchyNode[];
  unattachedGroup: { x: number; y: number } | null;
  edges: GraphEdge[];
  issues: string[];
  missingRelationships: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

interface TreeRow {
  id: string;
  parentId: string | null;
  node?: GraphNode;
}

/** Build a deterministic forest. Invalid parent evidence stays visible as unattached. */
export function buildHierarchyLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  hierarchy?: GraphHierarchy,
): HierarchyLayout {
  const issues: string[] = [];
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) issues.push(`Duplicate node ${node.id}`);
    else byId.set(node.id, node);
  }
  const ids = [...byId.keys()].sort();
  const rootIds = new Set(hierarchy?.root_ids ?? []);
  if (hierarchy?.root_id) {
    rootIds.add(hierarchy.root_id);
    if (!byId.has(hierarchy.root_id)) issues.push(`Missing root ${hierarchy.root_id}`);
  }
  const parentOf = new Map<string, string>();
  const treePairs = new Set(edges.filter((edge) => edge.tree_role === 'tree'
    && (edge.kind === 'association' || edge.kind === 'observed_association'))
    .map((edge) => JSON.stringify([edge.source, edge.target].sort())));
  for (const id of ids) {
    const node = byId.get(id)!;
    const parent = node.parent_id;
    if (!parent || rootIds.has(id)) continue;
    if (!byId.has(parent)) issues.push(`Missing parent ${parent} for ${id}`);
    else if (!treePairs.has(JSON.stringify([id, parent].sort()))) issues.push(`No tree relationship for parent ${parent} of ${id}`);
    else parentOf.set(id, parent);
  }

  // Parent pointers, rather than raw edge direction, define presentation ancestry.
  // Association evidence commonly points from a device to its AP.
  const checked = new Set<string>();
  for (const id of ids) {
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current && !checked.has(current)) {
      if (path.has(current)) {
        issues.push(`Parent cycle at ${current}`);
        parentOf.delete(current);
        break;
      }
      path.add(current);
      current = parentOf.get(current);
    }
    for (const item of path) checked.add(item);
  }

  let virtualId = '__hierarchy_root__';
  while (byId.has(virtualId)) virtualId += '_';
  let unattachedId = '__hierarchy_unattached__';
  while (byId.has(unattachedId) || unattachedId === virtualId) unattachedId += '_';
  const unattached = ids.filter((id) => !parentOf.has(id) && byId.get(id)!.kind !== 'ap' && id !== hierarchy?.root_id);
  const rows: TreeRow[] = [{ id: virtualId, parentId: null }];
  if (unattached.length) rows.push({ id: unattachedId, parentId: virtualId });
  const unattachedIds = new Set(unattached);
  for (const id of ids) {
    rows.push({
      id,
      parentId: parentOf.get(id) ?? (unattachedIds.has(id) ? unattachedId : virtualId),
      node: byId.get(id)!,
    });
  }
  const root = d3.stratify<TreeRow>().id((row) => row.id).parentId((row) => row.parentId)(rows);
  root.sort((a, b) => {
    if (a.id === hierarchy?.root_id) return -1;
    if (b.id === hierarchy?.root_id) return 1;
    return (a.id ?? '').localeCompare(b.id ?? '');
  });
  const spacing = scaleFor(ids.length, 1000, 700);
  d3.tree<TreeRow>().nodeSize([spacing.siblingGap, spacing.depthGap])(root);
  const positioned: HierarchyNode[] = [];
  let unattachedGroup: HierarchyLayout['unattachedGroup'] = null;
  root.each((entry) => {
    const point = { x: (entry.depth - 1) * spacing.depthGap, y: entry.x ?? 0 };
    if (entry.id === unattachedId) unattachedGroup = point;
    if (entry.data.node) positioned.push({ ...entry.data.node, ...point, layoutDepth: entry.depth - 1 });
  });
  const validEdges = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .sort((a, b) => a.id.localeCompare(b.id));
  const missingRelationships = edges.length - validEdges.length;
  if (missingRelationships) issues.push(`${missingRelationships} relationships have missing endpoints`);
  const points = unattachedGroup ? [...positioned, unattachedGroup] : positioned;
  return {
    nodes: positioned,
    unattachedGroup,
    edges: validEdges,
    issues,
    missingRelationships,
    // Include glyphs and labels in the fit, including the Unattached group.
    bounds: {
      minX: (d3.min(points, (point) => point.x) ?? 0) - 80,
      maxX: (d3.max(points, (point) => point.x) ?? 0) + 80,
      minY: (d3.min(points, (point) => point.y) ?? 0) - 32,
      maxY: (d3.max(points, (point) => point.y) ?? 0) + 52,
    },
  };
}

export function hierarchyFitTransform(layout: HierarchyLayout, width: number, height: number) {
  const { minX, maxX, minY, maxY } = layout.bounds;
  const padding = Math.min(scaleFor(layout.nodes.length, width, height).fitPadding, width / 4, height / 4);
  const scale = Math.max(0.0001, Math.min(2,
    (width - 2 * padding) / Math.max(1, maxX - minX),
    (height - 2 * padding) / Math.max(1, maxY - minY),
  ));
  return d3.zoomIdentity.translate(
    width / 2 - (minX + maxX) / 2 * scale,
    height / 2 - (minY + maxY) / 2 * scale,
  ).scale(scale);
}

interface HierarchyOptions {
  hierarchy: Accessor<GraphHierarchy | undefined>;
  selectedNodeId: Accessor<string | null>;
  pinnedNodeIds: Accessor<Set<string>>;
  visibleKinds: Accessor<Set<NodeKind>>;
  visibleEdgeKinds: Accessor<Set<EdgeKind>>;
  showSecondary: Accessor<boolean>;
  onClearSelection: () => void;
  onNodeClick: (node: HierarchyNode) => void;
}

export function useHierarchyLayout(
  svgRef: () => SVGSVGElement | undefined,
  nodes: Accessor<GraphNode[]>,
  edges: Accessor<GraphEdge[]>,
  options: HierarchyOptions,
) {
  const [hiddenRelationshipCount, setHiddenRelationshipCount] = createSignal(0);
  const [issues, setIssues] = createSignal<string[]>([]);
  const presentation = useGraphPresentation<HierarchyNode>(svgRef, options.selectedNodeId, options.onClearSelection);
  let layout: HierarchyLayout | null = null;
  let zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let frame: number | undefined;
  const pinnedPositions = new Map<string, { x: number; y: number }>();

  function viewport() {
    const el = svgRef();
    const bounds = el?.getBoundingClientRect();
    return { width: Math.max(bounds?.width ?? 0, 320), height: Math.max(bounds?.height ?? 0, 240) };
  }

  function resetZoom() {
    const el = svgRef();
    if (!el || !zoom || !layout) return;
    const { width, height } = viewport();
    zoom.extent([[0, 0], [width, height]]);
    d3.select(el).call(zoom.transform, hierarchyFitTransform(layout, width, height));
  }

  function applyVisibility() {
    const el = svgRef();
    if (!el || !layout) return;
    const visibleKinds = options.visibleKinds();
    const edgeKinds = options.visibleEdgeKinds();
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    let hidden = layout.missingRelationships;
    d3.select(el).selectAll<SVGGElement, HierarchyNode>('.graph-node')
      .style('display', (node) => visibleKinds.has(node.kind) ? null : 'none');
    d3.select(el).selectAll<SVGElement, GraphEdge>('.graph-link')
      .style('display', (edge) => {
        const visible = visibleKinds.has(byId.get(edge.source)!.kind)
          && visibleKinds.has(byId.get(edge.target)!.kind)
          && edgeKinds.has(edge.kind)
          && (edge.tree_role === 'tree' || options.showSecondary());
        if (!visible) hidden += 1;
        return visible ? null : 'none';
      });
    setHiddenRelationshipCount(hidden);
    presentation.paint();
  }

  function rebuild() {
    const el = svgRef();
    if (!el) return;
    presentation.reset();
    layout = buildHierarchyLayout(nodes(), edges(), options.hierarchy());
    for (const node of layout.nodes) {
      const position = options.pinnedNodeIds().has(node.id) ? pinnedPositions.get(node.id) : undefined;
      if (position) Object.assign(node, position);
    }
    setIssues(layout.issues);
    const svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('data-layout', 'hierarchy');
    presentation.prepare(svg);
    const container = svg.append('g').attr('class', 'graph-viewport');
    const { width, height } = viewport();
    const initial = hierarchyFitTransform(layout, width, height);
    // Explicit extent avoids d3-zoom's SVG viewBox.baseVal path (absent in
    // jsdom and when the element has no viewBox).
    zoom = d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .clickDistance(4)
      .scaleExtent([Math.min(0.001, initial.k), 6])
      .on('zoom', (event) => container.attr('transform', event.transform));
    svg.call(zoom);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const links = container.append('g').attr('class', 'graph-links');
    links.selectAll<SVGLineElement, GraphEdge>('line').data(layout.edges.filter((edge) => edge.tree_role === 'tree'))
      .join('line').attr('class', 'graph-link').attr('data-tree-role', 'tree')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('x1', (edge) => byId.get(edge.source)!.x).attr('y1', (edge) => byId.get(edge.source)!.y)
      .attr('x2', (edge) => byId.get(edge.target)!.x).attr('y2', (edge) => byId.get(edge.target)!.y)
      .attr('stroke', (edge) => edgeColor(edge.kind)).attr('stroke-width', 1.5);
    links.selectAll<SVGPathElement, GraphEdge>('path').data(layout.edges.filter((edge) => edge.tree_role !== 'tree'))
      .join('path').attr('class', 'graph-link graph-link--secondary').attr('data-tree-role', 'secondary')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('d', (edge) => {
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        return `M${source.x},${source.y}Q${(source.x + target.x) / 2 + 40},${(source.y + target.y) / 2 - 30} ${target.x},${target.y}`;
      }).attr('fill', 'none').attr('stroke', (edge) => edgeColor(edge.kind))
      .attr('stroke-dasharray', (edge) => edgeDash(edge.kind) || '3 4').attr('stroke-width', 1);
    links.selectAll<SVGElement, GraphEdge>('.graph-link').append('title').text((edge) => edge.label ?? edge.kind.replaceAll('_', ' '));
    if (layout.unattachedGroup) container.append('text').attr('class', 'graph-hierarchy-group')
      .attr('x', layout.unattachedGroup.x).attr('y', layout.unattachedGroup.y).text('Unattached');
    const node = container.append('g').attr('class', 'graph-nodes')
      .selectAll<SVGGElement, HierarchyNode>('g').data(layout.nodes, (item) => item.id).join('g')
      .attr('class', 'graph-node').attr('data-kind', (item) => item.kind)
      .attr('data-node-id', (item) => item.id).attr('data-label', (item) => item.label)
      .attr('data-depth', (item) => item.layoutDepth)
      .attr('transform', (item) => `translate(${item.x},${item.y})`)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (item) => `${nodeKindLabel(item.kind)} ${item.label}`)
      .on('click', (_, item) => options.onNodeClick(item))
      .on('keydown', (event, item) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        options.onNodeClick(item);
      });
    presentation.decorate(node, {
      radius: nodeRadius, color: nodeColor,
      count: (item) => item.kind === 'cluster' ? item.cluster_size : undefined,
      alwaysLabel: (item) => item.kind === 'ap',
    });
    node.call(d3.drag<SVGGElement, HierarchyNode>().clickDistance(4).on('drag', (event, item) => {
      item.x = event.x;
      item.y = event.y;
      if (options.pinnedNodeIds().has(item.id)) pinnedPositions.set(item.id, { x: item.x, y: item.y });
      node.attr('transform', (entry) => `translate(${entry.x},${entry.y})`);
      links.selectAll<SVGLineElement, GraphEdge>('line')
        .attr('x1', (edge) => byId.get(edge.source)!.x).attr('y1', (edge) => byId.get(edge.source)!.y)
        .attr('x2', (edge) => byId.get(edge.target)!.x).attr('y2', (edge) => byId.get(edge.target)!.y);
      links.selectAll<SVGPathElement, GraphEdge>('path').attr('d', (edge) => {
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        return `M${source.x},${source.y}Q${(source.x + target.x) / 2 + 40},${(source.y + target.y) / 2 - 30} ${target.x},${target.y}`;
      });
    }));
    applyVisibility();
    applyPins();
    resetZoom();
  }

  function applyPins() {
    const el = svgRef();
    if (el) d3.select(el).selectAll<SVGGElement, HierarchyNode>('.graph-node')
      .classed('pinned', (node) => options.pinnedNodeIds().has(node.id))
      .each((node) => {
        if (options.pinnedNodeIds().has(node.id)) pinnedPositions.set(node.id, { x: node.x, y: node.y });
        else pinnedPositions.delete(node.id);
      });
  }

  function stop() {
    resizeObserver?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  }

  onMount(() => {
    rebuild();
    if (typeof ResizeObserver !== 'undefined' && svgRef()) {
      resizeObserver = new ResizeObserver(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resetZoom);
      });
      resizeObserver.observe(svgRef()!);
    }
  });
  createEffect(on(() => [nodes(), edges(), options.hierarchy()] as const, rebuild, { defer: true }));
  createEffect(on(() => [options.visibleKinds(), options.visibleEdgeKinds(), options.showSecondary()] as const, applyVisibility));
  createEffect(on(options.selectedNodeId, () => { presentation.paint(); }));
  createEffect(on(options.pinnedNodeIds, applyPins));
  onCleanup(stop);
  return { rebuild, resetZoom, stop, hiddenRelationshipCount, issues };
}
