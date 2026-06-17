import * as d3 from 'd3';
import { createEffect, on, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { GraphEdge, GraphNode, NodeKind } from '~/api/types';
import {
  createSimNodes,
  finiteCoord,
  stableUnitValue,
  useForceLayout,
  type SimNodeDatum,
} from './useForceLayout';
import { circlePath, polygonPath } from '~/utils/graphShapes';

export type SimNode = SimNodeDatum<GraphNode>;

export interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  kind: GraphEdge['kind'];
  weight?: number;
  label?: string;
}

export interface ForceGraphOptions {
  selectedNodeId?: Accessor<string | null>;
  pinnedNodeIds?: Accessor<Set<string>>;
  visibleKinds?: Accessor<Set<NodeKind>>;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
}

export function useForceGraph(
  svgRef: () => SVGSVGElement | undefined,
  nodes: () => GraphNode[],
  edges: () => GraphEdge[],
  options: ForceGraphOptions = {},
) {
  const layout = useForceLayout<GraphNode, SimEdge>(svgRef, {
    pinnedNodeIds: options.pinnedNodeIds,
  });
  let visibilityEffectReady = false;

  function build() {
    const prepared = layout.prepare(nodes());
    if (!prepared) return;
    const { svg, container, width, height, simNodes, nodeById } = prepared;
    const simEdges: SimEdge[] = edges()
      .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
      .map((edge) => {
        const next: SimEdge = {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
        };
        if (edge.weight !== undefined) next.weight = edge.weight;
        if (edge.label !== undefined) next.label = edge.label;
        return next;
      });

    const defs = svg.append('defs');
    [
      'association',
      'probe',
      'cluster_member',
      'shadow',
      'alert_ref',
      'rf_proximity',
      'roaming',
      'same_channel',
      'vendor_link',
    ].forEach((kind) => {
      defs
        .append('marker')
        .attr('id', `arrow-${kind}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 4)
        .attr('markerHeight', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', edgeColor(kind));
    });

    const link = container
      .append('g')
      .attr('class', 'graph-links')
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges, (edge) => edge.id)
      .join('line')
      .attr('class', 'graph-link')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('data-source-kind', (edge) => endpointKind(edge.source))
      .attr('data-target-kind', (edge) => endpointKind(edge.target))
      .attr('stroke', (edge) => edgeColor(edge.kind))
      .attr('stroke-width', (edge) => Math.max(0.5, (edge.weight ?? 1) * 0.8))
      .attr('stroke-opacity', 0.5)
      .attr('marker-end', (edge) => `url(#arrow-${edge.kind})`);

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
      })
      .on('mouseenter', (_, item) => options.onNodeHover?.(item))
      .on('mouseleave', () => options.onNodeHover?.(null));

    node.call(dragBehavior);

    node
      .append('circle')
      .attr('class', 'graph-node-ring')
      .attr('r', (item) => nodeRadius(item) + 4)
      .attr('fill', 'none')
      .attr('stroke', (item) => nodeColor(item))
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.25);

    node
      .append('path')
      .attr('class', 'graph-node-body')
      .attr('d', nodeShapePath)
      .attr('fill', (item) => `${nodeColor(item)}28`)
      .attr('stroke', (item) => nodeColor(item))
      .attr('stroke-width', 1.5);

    node
      .filter((item) => (item.risk_score ?? 0) > 0.5)
      .append('circle')
      .attr('class', 'graph-node-halo')
      .attr('r', (item) => nodeRadius(item) + 8)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-danger)')
      .attr('stroke-width', 0.75)
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.65);

    node
      .append('text')
      .attr('x', (item) => nodeRadius(item) + 5)
      .attr('y', 0)
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', 9)
      .attr('fill', 'var(--color-text-secondary)')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .text((item) => truncate(item.label, 22));

    let fitOnSimulationEnd = true;
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((item) => item.id)
          .distance((edge) => linkDistance(edge.kind))
          .strength(0.4),
      )
      .force('charge', d3.forceManyBody().strength(-210))
      .force(
        'x',
        d3.forceX<SimNode>((item) => nodeLaneX(item, width)).strength(0.16),
      )
      .force(
        'y',
        d3
          .forceY<SimNode>((item, index) => nodeLaneY(item, index, height))
          .strength(0.08),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<SimNode>((item) => nodeRadius(item) + 14),
      )
      .on('tick', () => {
        link
          .attr('x1', (edge) => finiteCoord((edge.source as SimNode).x))
          .attr('y1', (edge) => finiteCoord((edge.source as SimNode).y))
          .attr('x2', (edge) => finiteCoord((edge.target as SimNode).x))
          .attr('y2', (edge) => finiteCoord((edge.target as SimNode).y));
        node.attr(
          'transform',
          (item) => `translate(${finiteCoord(item.x)},${finiteCoord(item.y)})`,
        );
      })
      .on('end', () => {
        if (!fitOnSimulationEnd) return;
        fitOnSimulationEnd = false;
        layout.fitToGraph();
      });

    layout.setSimulation(simulation);

    applyVisibility(false);
    applySelection();
    applyPinned();
    layout.markBuilt();
  }

  function applyVisibility(
    restartSimulation: boolean,
    visible = options.visibleKinds?.(),
  ) {
    const el = svgRef();
    if (!el) return;
    if (!visible) return;
    const visibleKinds = visible;

    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .style('display', (item) =>
        visibleKinds.has(item.kind) ? null : 'none',
      );

    function edgeIsVisible(edge: SimEdge): boolean {
      return (
        visibleKinds.has(endpointKind(edge.source)) &&
        visibleKinds.has(endpointKind(edge.target))
      );
    }

    d3.select(el)
      .selectAll<SVGLineElement, SimEdge>('.graph-link')
      .style('display', (edge) => (edgeIsVisible(edge) ? null : 'none'))
      .attr('marker-end', (edge) =>
        edgeIsVisible(edge) ? `url(#arrow-${edge.kind})` : null,
      );

    if (restartSimulation) layout.restart();
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const el = svgRef();
    if (!el) return;
    const related = new Set<string>();
    if (selected) {
      related.add(selected);
      for (const edge of edges()) {
        if (edge.source === selected) related.add(edge.target);
        if (edge.target === selected) related.add(edge.source);
      }
    }

    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .classed('selected', (item) => item.id === selected)
      .classed(
        'related',
        (item) =>
          selected !== null && item.id !== selected && related.has(item.id),
      )
      .classed('dimmed', (item) => selected !== null && !related.has(item.id));

    d3.select(el)
      .selectAll<SVGLineElement, SimEdge>('.graph-link')
      .classed('selected', (edge) => {
        if (!selected) return false;
        return (
          endpointId(edge.source) === selected ||
          endpointId(edge.target) === selected
        );
      })
      .classed('dimmed', (edge) => {
        if (!selected) return false;
        return (
          endpointId(edge.source) !== selected &&
          endpointId(edge.target) !== selected
        );
      });

    if (selected) {
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

  function endpointId(value: string | SimNode): string {
    return typeof value === 'string' ? value : value.id;
  }

  onMount(build);
  createEffect(
    on(
      () => options.visibleKinds?.(),
      (visible) => {
        applyVisibility(visibilityEffectReady, visible);
        visibilityEffectReady = true;
      },
    ),
  );
  createEffect(on(() => options.selectedNodeId?.() ?? null, applySelection));
  createEffect(on(() => options.pinnedNodeIds?.(), applyPinned));

  return { rebuild: build, resetZoom: layout.resetZoom, stop: layout.stop };
}

export { createSimNodes };

function nodeLaneX(node: GraphNode, width: number): number {
  const lanes: Record<NodeKind, number> = {
    cluster: 0.18,
    device: 0.34,
    client: 0.52,
    ap: 0.72,
    shadow_alert: 0.88,
    alert: 0.88,
    embedding: 0.5,
  };
  return width * (lanes[node.kind] ?? 0.5);
}

function nodeLaneY(node: GraphNode, index: number, height: number): number {
  const band = Math.max(160, height * 0.78);
  const top = Math.max(32, (height - band) / 2);
  const spread = stableUnitValue(node.id || `${node.kind}:${index}`);
  return top + spread * band;
}

export function nodeRadius(node: GraphNode): number {
  if (node.kind === 'cluster') {
    return 10 + Math.min((node.cluster_size ?? 1) * 1.5, 12);
  }
  if (node.kind === 'ap') return 10;
  if (node.kind === 'shadow_alert' || node.kind === 'alert') return 8;
  return 7;
}

function nodeShapePath(node: GraphNode): string {
  const r = nodeRadius(node);
  switch (node.kind) {
    case 'device':
      return `M0,${-r}L${r},0L0,${r}L${-r},0Z`;
    case 'cluster':
      return polygonPath(r, 6);
    case 'ap':
      return polygonPath(r * 1.15, 3, -Math.PI / 2);
    case 'client':
      return `M${-r},${-r}L${r},${-r}L${r},${r}L${-r},${r}Z`;
    case 'shadow_alert':
      return polygonPath(r * 1.1, 8);
    case 'alert':
      return polygonPath(r * 1.15, 3, Math.PI / 2);
    default:
      return circlePath(r);
  }
}

export function nodeColor(node: Pick<GraphNode, 'kind'>): string {
  switch (node.kind) {
    case 'device':
      return 'var(--color-accent)';
    case 'cluster':
      return 'var(--score-dense)';
    case 'ap':
      return 'var(--color-info)';
    case 'client':
      return 'var(--color-ok)';
    case 'shadow_alert':
      return 'var(--color-danger)';
    case 'alert':
      return 'var(--color-warn)';
    case 'embedding':
      return 'var(--score-dense)';
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
    default:
      return kind.replaceAll('_', ' ');
  }
}

function edgeColor(kind: string): string {
  switch (kind) {
    case 'association':
      return 'var(--color-accent)';
    case 'probe':
      return 'var(--color-ok)';
    case 'cluster_member':
      return 'var(--score-dense)';
    case 'shadow':
      return 'var(--color-danger)';
    case 'alert_ref':
      return 'var(--color-warn)';
    case 'rf_proximity':
      return 'var(--color-info)';
    case 'roaming':
      return 'var(--color-border-focus)';
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
