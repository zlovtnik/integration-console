import * as d3 from 'd3';
import { createEffect, createMemo, on, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from '~/api/types';
import {
  createSimNodes,
  countHiddenRelationships,
  finiteCoord,
  groupCentroids,
  partitionGraphEdges,
  scaleFor,
  seedGroupPositions,
  stableUnitValue,
  useForceLayout,
  type SimNodeDatum,
} from './useForceLayout';
import { useGraphPresentation } from './graphPresentation';
import type { GraphRenderNode } from './useGraphAggregate';

export type SimNode = SimNodeDatum<GraphRenderNode>;

export interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  kind: GraphEdge['kind'];
  weight?: number;
  label?: string;
  tree_role?: NonNullable<GraphEdge['tree_role']>;
}

export interface ForceGraphOptions {
  selectedNodeId?: Accessor<string | null>;
  onClearSelection?: () => void;
  pinnedNodeIds?: Accessor<Set<string>>;
  visibleKinds?: Accessor<Set<NodeKind>>;
  visibleEdgeKinds?: Accessor<Set<EdgeKind>>;
  layoutMode?: Accessor<'overview' | 'groups'>;
  hiddenRelationshipCount?: Accessor<number>;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
}

export function useForceGraph(
  svgRef: () => SVGSVGElement | undefined,
  nodes: () => GraphRenderNode[],
  edges: () => GraphEdge[],
  options: ForceGraphOptions = {},
) {
  let fitOnSimulationEnd = false;
  const layout = useForceLayout<GraphRenderNode, SimEdge>(svgRef, {
    pinnedNodeIds: options.pinnedNodeIds,
    maxFitScale: 1,
    onZoom: paintLabels,
    onInteraction: () => { fitOnSimulationEnd = false; },
  });
  const presentation = useGraphPresentation<SimNode>(
    svgRef,
    () => options.selectedNodeId?.() ?? null,
    () => options.onClearSelection?.(),
  );
  const hiddenRelationshipCount = createMemo(() => {
    const visibleKinds = options.visibleKinds?.();
    const visibleEdges = options.visibleEdgeKinds?.();
    return countHiddenRelationships(
      nodes(), edges(),
      (node) => node.kind === 'aggregate_group' || !visibleKinds || visibleKinds.has(node.kind),
      (edge) => !visibleEdges || visibleEdges.has(edge.kind),
      options.hiddenRelationshipCount?.() ?? 0,
    );
  });
  let visibilityEffectReady = false;

  function build() {
    presentation.reset();
    const prepared = layout.prepare(nodes());
    if (!prepared) return;
    const { svg, container, width, height, simNodes, nodeById } = prepared;
    const closed = partitionGraphEdges(simNodes, edges());
    if (import.meta.env.DEV && closed.hiddenRelationshipCount > 0) {
      console.assert(false, `${closed.hiddenRelationshipCount} graph relationships have missing endpoints`);
    }
    const simEdges: SimEdge[] = closed.edges
      .map((edge) => {
        const next: SimEdge = {
          id: edge.id,
          source: nodeById.get(edge.source)!,
          target: nodeById.get(edge.target)!,
          kind: edge.kind,
        };
        if (edge.weight !== undefined) next.weight = edge.weight;
        if (edge.label !== undefined) next.label = edge.label;
        if (edge.tree_role !== undefined) next.tree_role = edge.tree_role;
        return next;
      });

    const defs = presentation.prepare(svg);
    new Set(simEdges.map((edge) => edge.kind)).forEach((kind) => {
      defs
        .append('marker')
        .attr('id', `${presentation.prefix}-arrow-${kind}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 4)
        .attr('markerHeight', 4)
        .attr('markerUnits', 'userSpaceOnUse')
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', edgeColor(kind));
    });

    const link = container
      .append('g')
      .attr('class', 'graph-links')
      .selectAll<SVGPathElement, SimEdge>('path')
      .data(simEdges, (edge) => edge.id)
      .join('path')
      .attr('class', 'graph-link')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('data-tree-role', (edge) => edge.tree_role ?? (groupLayoutEdge(edge) ? 'tree' : 'secondary'))
      .attr('data-source-kind', (edge) => endpointKind(edge.source))
      .attr('data-target-kind', (edge) => endpointKind(edge.target))
      .attr('stroke', (edge) => edgeColor(edge.kind))
      .attr('fill', 'none')
      .attr('stroke-width', (edge) => Math.min(2.5, Math.max(0.75, edge.weight ?? 1)))
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-opacity', (edge) => edgeOpacity(edge.kind))
      .attr('stroke-dasharray', (edge) => edgeDash(edge.kind))
      .style('--edge-opacity', (edge) => edgeOpacity(edge.kind))
      .attr(
        'marker-end',
        (edge) => `url(#${presentation.prefix}-arrow-${edge.kind})`,
      );

    link
      .append('title')
      .text((edge) => edge.label || edge.kind.replaceAll('_', ' '));

    const dragBehavior = layout.createDragBehavior();

    const node = container
      .append('g')
      .attr('class', 'graph-nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (item) => item.id)
      .join('g')
      .attr('class', 'graph-node')
      .attr('data-kind', (item) => item.kind)
      .attr('data-node-id', (item) => item.id)
      .attr('data-label', (item) => item.label)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (item) => `${nodeKindLabel(item.kind)} ${item.label}`)
      .on('click', (_, item) => options.onNodeClick?.(item))
      .on('keydown', (event, item) => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' ' &&
          event.code !== 'Space'
        ) {
          return;
        }
        event.preventDefault();
        options.onNodeClick?.(item);
      });

    node.call(dragBehavior);

    presentation.decorate(node, {
      radius: nodeRadius,
      color: nodeColor,
      count: (item) =>
        item.kind === 'aggregate_group'
          ? item.occurrence_count
          : item.kind === 'cluster'
            ? item.cluster_size
            : undefined,
      alwaysLabel: (item) =>
        item.kind === 'ap' || item.kind === 'aggregate_group',
      onHover: options.onNodeHover,
    });

    node
      .filter((item) => hasSeverityHalo(item))
      .append('circle')
      .attr('class', 'graph-node-halo')
      .attr('r', (item) => nodeRadius(item) + 8)
      .attr('fill', 'none')
      .attr('stroke', (item) => severityHaloColor(item))
      .attr('stroke-width', 0.75)
      .attr('stroke-dasharray', (item) =>
        (item.risk_score ?? 0) > 0.5 ? '3 3' : 'none',
      )
      .attr('stroke-opacity', 0.65);

    const calibration = scaleFor(simNodes.length, width, height);
    const grouped = options.layoutMode?.() === 'groups';
    // Layout groups follow evidence edges, never node kind or a hierarchy's depth.
    const groups = relationshipGroups(simNodes, closed.edges.filter(groupLayoutEdge));
    const groupId = (item: SimNode) => groups.get(item.id) ?? item.id;
    const centers = groupCentroids(simNodes, groupId, width, height);
    // A grid of many disconnected components must not grow by 240px per row.
    // Keep component centers proportional to the viewport and node density.
    const centerPoints = [...centers.values()];
    const spanX = (d3.max(centerPoints, (point) => point.x) ?? 0) - (d3.min(centerPoints, (point) => point.x) ?? 0);
    const spanY = (d3.max(centerPoints, (point) => point.y) ?? 0) - (d3.min(centerPoints, (point) => point.y) ?? 0);
    const density = Math.max(1, Math.sqrt(simNodes.length / 120));
    const compactScale = Math.min(1, Math.max(320, width - 160) * density / Math.max(1, spanX), Math.max(240, height - 160) * density / Math.max(1, spanY));
    for (const center of centerPoints) {
      center.x = width / 2 + (center.x - width / 2) * compactScale;
      center.y = height / 2 + (center.y - height / 2) * compactScale;
    }
    simNodes.sort((a, b) => a.id.localeCompare(b.id));
    for (const item of simNodes) {
      const center = centers.get(groupId(item))!;
      if (item.fx != null || item.fy != null) continue;
      if (Math.abs(finiteCoord(item.x) - center.x) > width * 2 || Math.abs(finiteCoord(item.y) - center.y) > height * 2) {
        delete item.x;
        delete item.y;
        item.vx = 0;
        item.vy = 0;
      }
    }
    seedGroupPositions(simNodes, groupId, centers);
    const centroid = (item: SimNode) => centers.get(groupId(item)) ?? { x: width / 2, y: height / 2 };
    fitOnSimulationEnd = true;

    function paint() {
      link.attr('d', graphLinkPath);
      node.attr('transform', (item) => `translate(${finiteCoord(item.x)},${finiteCoord(item.y)})`);
      paintLabels(layout.zoomScale());
    }

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(grouped ? simEdges.filter(groupLayoutEdge) : simEdges)
          .id((item) => item.id)
          .distance((edge) => calibration.linkDistance(linkDistance(edge.kind)))
          .strength(grouped ? 0.35 : 0.4),
      )
      .force('charge', d3.forceManyBody().strength(calibration.charge).distanceMax(320))
      .force(
        'x',
        d3.forceX<SimNode>((item) => grouped ? centroid(item).x : width / 2).strength(grouped ? 0.18 : 0.08),
      )
      .force(
        'y',
        d3
          .forceY<SimNode>((item) => grouped ? centroid(item).y : height / 2)
          .strength(grouped ? 0.18 : 0.08),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<SimNode>((item) => nodeRadius(item) + Math.min(20, calibration.collidePad)).iterations(3),
      )
      .on('tick', paint)
      .on('end', () => {
        if (!fitOnSimulationEnd) return;
        fitOnSimulationEnd = false;
        layout.fitToGraph();
      });

    layout.setSimulation(simulation);
    // Paint a settled starting frame before fitting; tick() does not emit tick events.
    simulation.stop().tick(60);
    paint();
    layout.fitToGraph();
    simulation.restart();

    applyVisibility(false);
    applySelection();
    applyPinned();
    layout.markBuilt();
  }

  function applyVisibility(
    restartSimulation: boolean,
    visible = options.visibleKinds?.(),
    visibleEdgeKinds = options.visibleEdgeKinds?.(),
  ) {
    const el = svgRef();
    if (!el) return;

    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .style('display', (item) => (kindIsVisible(item.kind) ? null : 'none'));

    function kindIsVisible(kind: NodeKind): boolean {
      return kind === 'aggregate_group' || !visible || visible.has(kind);
    }

    function edgeIsVisible(edge: SimEdge): boolean {
      return (
        kindIsVisible(endpointKind(edge.source)) &&
        kindIsVisible(endpointKind(edge.target)) &&
        (!visibleEdgeKinds || visibleEdgeKinds.has(edge.kind))
      );
    }

    d3.select(el)
      .selectAll<SVGPathElement, SimEdge>('.graph-link')
      .style('display', (edge) => (edgeIsVisible(edge) ? null : 'none'))
      .attr('marker-end', (edge) =>
        edgeIsVisible(edge)
          ? `url(#${presentation.prefix}-arrow-${edge.kind})`
          : null,
      );

    presentation.paint();
    if (restartSimulation) layout.restart();
  }

  function paintLabels(scale: number) {
    const el = svgRef();
    if (!el) return;
    const zoom = Math.max(scale, 0.01);
    const occupied: { x: number; y: number; width: number }[] = [];
    d3.select(el).selectAll<SVGTextElement, SimNode>('.graph-node-label')
      .style('font-size', `${12 / zoom}px`)
      .attr('y', (item) => nodeRadius(item) + 15 / zoom)
      .classed('graph-node-label--suppressed', function (item) {
        if (this.parentElement?.style.display === 'none') return true;
        const x = finiteCoord(item.x) * zoom;
        const y = finiteCoord(item.y) * zoom + nodeRadius(item) * zoom + 15;
        const width = (this.textContent?.length ?? 0) * 7;
        const persistent = item.kind === 'ap' || item.kind === 'aggregate_group';
        if (!persistent && zoom < 0.7) return true;
        if (occupied.some((box) => Math.abs(box.y - y) < 18 && Math.abs(box.x - x) < (box.width + width) / 2 + 8)) return true;
        occupied.push({ x, y, width });
        return false;
      });
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const related = presentation.paint();
    if (selected && related.size) {
      fitOnSimulationEnd = false;
      queueMicrotask(() => layout.fitToGraph(related, 80));
    }
  }

  function applyPinned(
    pinned = options.pinnedNodeIds?.() ?? new Set<string>(),
  ) {
    const el = svgRef();
    if (!el) return;
    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .classed('pinned', (item) => pinned.has(item.id))
      .each((item) => {
        if (pinned.has(item.id)) {
          if (item.fx == null || item.fy == null) {
            item.fx = item.x ?? null;
            item.fy = item.y ?? null;
          }
          return;
        }

        item.fx = null;
        item.fy = null;
      });
  }

  function endpointKind(value: string | SimNode): NodeKind {
    if (typeof value === 'string') {
      return layout.nodeById().get(value)?.kind ?? 'device';
    }
    return value.kind;
  }

  onMount(build);
  createEffect(
    on(
      () => [options.visibleKinds?.(), options.visibleEdgeKinds?.()] as const,
      ([visible, visibleEdgeKinds]) => {
        applyVisibility(visibilityEffectReady, visible, visibleEdgeKinds);
        visibilityEffectReady = true;
      },
    ),
  );
  createEffect(on(() => options.selectedNodeId?.() ?? null, applySelection));
  createEffect(on(() => options.pinnedNodeIds?.(), applyPinned));

  return { rebuild: build, resetZoom: layout.resetZoom, zoomBy: layout.zoomBy, panBy: layout.panBy, zoomScale: layout.zoomScale, stop: layout.stop, hiddenRelationshipCount };
}

export { createSimNodes };

export function groupLayoutEdge(edge: Pick<GraphEdge, 'kind' | 'tree_role'>): boolean {
  return edge.tree_role !== 'secondary' && !['rf_proximity', 'calibrated_range', 'vendor_link', 'same_channel', 'roaming', 'probe'].includes(edge.kind);
}

export function relationshipGroups(nodes: { id: string }[], edges: Pick<GraphEdge, 'source' | 'target'>[]): Map<string, string> {
  const parents = new Map(nodes.map((item) => [item.id, item.id]));
  function root(id: string): string {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current)!;
    while (id !== current) {
      const next = parents.get(id)!;
      parents.set(id, current);
      id = next;
    }
    return current;
  }
  for (const edge of edges) {
    if (!parents.has(edge.source) || !parents.has(edge.target)) continue;
    const a = root(edge.source);
    const b = root(edge.target);
    parents.set(a < b ? b : a, a < b ? a : b);
  }
  return new Map(nodes.map((item) => [item.id, root(item.id)]));
}

export function graphLinkPath(edge: SimEdge): string {
  const source = edge.source as SimNode;
  const target = edge.target as SimNode;
  const sx = finiteCoord(source.x);
  const sy = finiteCoord(source.y);
  const tx = finiteCoord(target.x);
  const ty = finiteCoord(target.y);
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy);
  if (length < 1) return `M${sx},${sy}C${sx + 24},${sy - 32} ${sx - 24},${sy - 32} ${sx},${sy}`;
  const bend = Math.min(24, length * 0.12) * (stableUnitValue(edge.id) < 0.5 ? -1 : 1);
  return `M${sx},${sy}Q${(sx + tx) / 2 - dy / length * bend},${(sy + ty) / 2 + dx / length * bend} ${tx},${ty}`;
}

export function nodeRadius(node: GraphNode): number {
  if (node.kind === 'cluster') {
    return 14 + Math.min(Math.max(0, (node.cluster_size ?? 1) - 1) * 1.5, 12);
  }
  if (node.kind === 'aggregate_group') {
    return 13 + Math.min((node.occurrence_count ?? 1) * 0.4, 10);
  }
  if (node.kind === 'ap') return 18;
  if (node.kind === 'client') return 7;
  if (node.kind === 'shadow_alert' || node.kind === 'alert') return 10;
  return 9;
}

export function nodeColor(node: Pick<GraphNode, 'kind'>): string {
  switch (node.kind) {
    case 'device':
      return 'var(--graph-device)';
    case 'cluster':
      return 'var(--graph-cluster)';
    case 'ap':
      return 'var(--graph-info)';
    case 'client':
      return 'var(--graph-ok)';
    case 'shadow_alert':
      return 'var(--graph-danger)';
    case 'alert':
      return 'var(--graph-warn)';
    case 'embedding':
      return 'var(--graph-cluster)';
    case 'aggregate_group':
      return 'var(--color-text-tertiary)';
    default:
      return 'var(--color-text-tertiary)';
  }
}

export function nodeKindLabel(kind: NodeKind): string {
  switch (kind) {
    case 'shadow_alert':
      return 'Shadow alert';
    case 'ap':
      return 'Access point';
    case 'aggregate_group':
      return 'Visual group';
    default:
      return kind.replaceAll('_', ' ');
  }
}

function highSeverity(item: SimNode): boolean {
  return item.alert_severity === 'high' || item.alert_severity === 'critical';
}

function hasSeverityHalo(item: SimNode): boolean {
  return (item.risk_score ?? 0) > 0.5 || highSeverity(item);
}

function severityHaloColor(item: SimNode): string {
  if ((item.risk_score ?? 0) > 0.5) return 'var(--graph-danger)';
  return 'var(--graph-warn)';
}

export function edgeKindLabel(kind: EdgeKind): string {
  switch (kind) {
    case 'association':
      return 'Observed AP context';
    case 'cluster_member':
      return 'Identity cluster member';
    case 'rf_proximity':
      return 'RF proximity';
    case 'same_channel':
      return 'Same channel';
    case 'vendor_link':
      return 'Shared vendor OUI';
    case 'alert_ref':
      return 'Alert reference';
    default:
      return kind.replaceAll('_', ' ');
  }
}

export function edgeColor(kind: string): string {
  switch (kind) {
    case 'association':
      return 'var(--graph-accent)';
    case 'probe':
      return 'var(--graph-ok)';
    case 'cluster_member':
      return 'var(--graph-cluster)';
    case 'shadow':
      return 'var(--graph-danger)';
    case 'alert_ref':
      return 'var(--graph-warn)';
    case 'rf_proximity':
      return 'var(--graph-info)';
    case 'roaming':
      return 'var(--graph-accent)';
    case 'same_channel':
      return 'var(--graph-info)';
    case 'vendor_link':
      return 'var(--graph-ok)';
    default:
      return 'var(--color-border)';
  }
}

function linkDistance(kind: string): number {
  switch (kind) {
    case 'cluster_member':
      return 60;
    case 'association':
      return 90;
    case 'probe':
      return 110;
    case 'shadow':
    case 'alert_ref':
      return 130;
    default:
      return 150;
  }
}

export function edgeDash(kind: string): string | null {
  if (kind === 'roaming' || kind === 'probe') return '6 3';
  if (['same_channel', 'vendor_link', 'rf_proximity'].includes(kind))
    return '2 5';
  return null;
}

export function edgeOpacity(kind: string): number {
  const values: Record<string, number> = {
    association: 0.65,
    cluster_member: 0.55,
    roaming: 0.45,
    same_channel: 0.22,
    vendor_link: 0.22,
    rf_proximity: 0.22,
    probe: 0.4,
    shadow: 0.72,
    alert_ref: 0.62,
  };
  // Keep even secondary relationships above 3:1 against the dark canvas.
  // The existing dash patterns and labels continue to distinguish their kind.
  return Math.max(0.6, values[kind] ?? 1);
}
