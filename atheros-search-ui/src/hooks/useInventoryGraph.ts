import * as d3 from 'd3';
import { createEffect, on, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type {
  InventoryEdge,
  InventoryFilters,
  InventoryNode,
  InventoryNodeKind,
} from '~/api/types';
import {
  finiteCoord,
  stableUnitValue,
  useForceLayout,
  type SimNodeDatum,
} from './useForceLayout';
import { circlePath, polygonPath } from '~/utils/graphShapes';

const DEFAULT_AGGREGATE_THRESHOLD = 400;

export type InventoryGrouping = InventoryFilters['grouping'];

export interface InventoryRenderNode extends InventoryNode {
  aggregate_group_id?: string;
  member_count?: number;
}

export type InventorySimNode = SimNodeDatum<InventoryRenderNode>;

export interface InventorySimEdge extends d3.SimulationLinkDatum<InventorySimNode> {
  id: string;
  source: string | InventorySimNode;
  target: string | InventorySimNode;
  kind: InventoryEdge['kind'];
  weight?: number;
}

export interface InventoryGraphOptions {
  selectedNodeId?: Accessor<string | null>;
  pinnedNodeIds?: Accessor<Set<string>>;
  visibleKinds?: Accessor<Set<InventoryNodeKind>>;
  grouping?: Accessor<InventoryGrouping>;
  expandedGroupIds?: Accessor<Set<string>>;
  aggregateThreshold?: number;
  onNodeClick?: (node: InventorySimNode) => void;
  onAggregateClick?: (groupId: string) => void;
}

interface RenderModel {
  nodes: InventoryRenderNode[];
  edges: InventoryEdge[];
  aggregated: boolean;
}

export function useInventoryGraph(
  svgRef: () => SVGSVGElement | undefined,
  nodes: () => InventoryNode[],
  edges: () => InventoryEdge[],
  options: InventoryGraphOptions = {},
) {
  const layout = useForceLayout<InventoryRenderNode, InventorySimEdge>(svgRef, {
    pinnedNodeIds: options.pinnedNodeIds,
  });
  let visibilityEffectReady = false;
  let renderedEdges: InventoryEdge[] = [];

  function build() {
    const model = buildInventoryRenderModel(
      nodes(),
      edges(),
      options.grouping?.() ?? 'registry',
      options.expandedGroupIds?.() ?? new Set<string>(),
      options.aggregateThreshold ?? DEFAULT_AGGREGATE_THRESHOLD,
    );
    const prepared = layout.prepare(model.nodes);
    if (!prepared) return;
    const { svg, container, width, height, simNodes, nodeById } = prepared;
    renderedEdges = model.edges.filter(
      (edge) => nodeById.has(edge.source) && nodeById.has(edge.target),
    );
    const simEdges = renderedEdges.map((edge): InventorySimEdge => {
      const next: InventorySimEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
      };
      if (edge.weight !== undefined) next.weight = edge.weight;
      return next;
    });

    const defs = svg.append('defs');
    [
      'owns',
      'located_at',
      'cluster_member',
      'merge_candidate',
      'same_device',
    ].forEach((kind) => {
      defs
        .append('marker')
        .attr('id', `inventory-arrow-${kind}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 4)
        .attr('markerHeight', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', inventoryEdgeColor(kind));
    });

    const link = container
      .append('g')
      .attr('class', 'graph-links inventory-links')
      .selectAll<SVGLineElement, InventorySimEdge>('line')
      .data(simEdges, (edge) => edge.id)
      .join('line')
      .attr('class', 'graph-link inventory-link')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('stroke', (edge) => inventoryEdgeColor(edge.kind))
      .attr('stroke-width', (edge) => Math.max(0.7, (edge.weight ?? 1) * 1.1))
      .attr('stroke-opacity', 0.45)
      .attr('marker-end', (edge) => `url(#inventory-arrow-${edge.kind})`);

    link.append('title').text((edge) => edge.kind.replaceAll('_', ' '));

    const node = container
      .append('g')
      .attr('class', 'graph-nodes inventory-nodes')
      .selectAll<SVGGElement, InventorySimNode>('g')
      .data(simNodes, (item) => item.id)
      .join('g')
      .attr('class', 'graph-node inventory-node')
      .classed('inactive', (item) => !item.active)
      .classed('aggregate', (item) => Boolean(item.aggregate_group_id))
      .classed('merge-review', (item) => item.kind === 'merge_candidate')
      .attr('data-kind', (item) => item.kind)
      .attr('data-node-id', (item) => item.id)
      .attr('data-label', (item) => item.label)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (item) => inventoryNodeAriaLabel(item))
      .on('click', (_, item) => {
        if (item.aggregate_group_id) {
          options.onAggregateClick?.(item.aggregate_group_id);
          return;
        }
        options.onNodeClick?.(item);
      })
      .on('keydown', (event, item) => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' ' &&
          event.code !== 'Space'
        ) {
          return;
        }
        event.preventDefault();
        if (item.aggregate_group_id) {
          options.onAggregateClick?.(item.aggregate_group_id);
          return;
        }
        options.onNodeClick?.(item);
      });

    node.call(layout.createDragBehavior());

    node
      .append('circle')
      .attr('class', 'graph-node-ring inventory-node-ring')
      .attr('r', (item) => inventoryNodeRadius(item) + 4)
      .attr('fill', 'none')
      .attr('stroke', (item) => inventoryNodeColor(item))
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.25);

    node
      .append('path')
      .attr('class', 'graph-node-body inventory-node-body')
      .attr('d', inventoryNodeShapePath)
      .attr('fill', (item) => `${inventoryNodeColor(item)}28`)
      .attr('stroke', (item) => inventoryNodeColor(item))
      .attr('stroke-width', 1.5);

    node
      .filter((item) => item.kind === 'merge_candidate')
      .append('circle')
      .attr('class', 'inventory-merge-halo')
      .attr('r', (item) => inventoryNodeRadius(item) + 9)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-warn)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 3')
      .attr('stroke-opacity', 0.8);

    node
      .append('text')
      .attr('x', (item) => inventoryNodeRadius(item) + 5)
      .attr('y', 0)
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', 9)
      .attr('fill', 'var(--color-text-secondary)')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .text((item) => truncate(item.label, 24));

    let fitOnSimulationEnd = true;
    const simulation = d3
      .forceSimulation<InventorySimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<InventorySimNode, InventorySimEdge>(simEdges)
          .id((item) => item.id)
          .distance((edge) => inventoryLinkDistance(edge.kind))
          .strength(0.34),
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force(
        'group',
        forceInventoryGroups(
          simNodes,
          options.grouping?.() ?? 'registry',
          width,
          height,
        ),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<InventorySimNode>(
          (item) => inventoryNodeRadius(item) + 16,
        ),
      )
      .on('tick', () => {
        link
          .attr('x1', (edge) =>
            finiteCoord((edge.source as InventorySimNode).x),
          )
          .attr('y1', (edge) =>
            finiteCoord((edge.source as InventorySimNode).y),
          )
          .attr('x2', (edge) =>
            finiteCoord((edge.target as InventorySimNode).x),
          )
          .attr('y2', (edge) =>
            finiteCoord((edge.target as InventorySimNode).y),
          );
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
    if (!el || !visible) return;
    const visibleKinds = visible;

    d3.select(el)
      .selectAll<SVGGElement, InventorySimNode>('.inventory-node')
      .style('display', (item) =>
        visibleKinds.has(item.kind) ? null : 'none',
      );

    function edgeIsVisible(edge: InventorySimEdge): boolean {
      return (
        visibleKinds.has(endpointKind(edge.source)) &&
        visibleKinds.has(endpointKind(edge.target))
      );
    }

    d3.select(el)
      .selectAll<SVGLineElement, InventorySimEdge>('.inventory-link')
      .style('display', (edge) => (edgeIsVisible(edge) ? null : 'none'))
      .attr('marker-end', (edge) =>
        edgeIsVisible(edge) ? `url(#inventory-arrow-${edge.kind})` : null,
      );

    if (restartSimulation) layout.restart();
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const el = svgRef();
    if (!el) return;
    const related = new Set<string>();
    if (selected) {
      related.add(selected);
      for (const edge of renderedEdges) {
        if (edge.source === selected) related.add(edge.target);
        if (edge.target === selected) related.add(edge.source);
      }
    }

    d3.select(el)
      .selectAll<SVGGElement, InventorySimNode>('.inventory-node')
      .classed('selected', (item) => item.id === selected)
      .classed(
        'related',
        (item) =>
          selected !== null && item.id !== selected && related.has(item.id),
      )
      .classed('dimmed', (item) => selected !== null && !related.has(item.id));

    d3.select(el)
      .selectAll<SVGLineElement, InventorySimEdge>('.inventory-link')
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

    if (selected) queueMicrotask(() => layout.fitToGraph(related, 80));
  }

  function applyPinned(
    pinned = options.pinnedNodeIds?.() ?? new Set<string>(),
  ) {
    const el = svgRef();
    if (!el) return;
    d3.select(el)
      .selectAll<SVGGElement, InventorySimNode>('.inventory-node')
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

  function endpointKind(value: string | InventorySimNode): InventoryNodeKind {
    if (typeof value === 'string') {
      return layout.nodeById().get(value)?.kind ?? 'device';
    }
    return value.kind;
  }

  function endpointId(value: string | InventorySimNode): string {
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

export function buildInventoryRenderModel(
  nodes: InventoryNode[],
  edges: InventoryEdge[],
  grouping: InventoryGrouping,
  expandedGroupIds: Set<string>,
  aggregateThreshold = DEFAULT_AGGREGATE_THRESHOLD,
): RenderModel {
  if (nodes.length <= aggregateThreshold) {
    return { nodes, edges, aggregated: false };
  }

  const sourceById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, InventoryNode[]>();
  const renderedNodes: InventoryRenderNode[] = [];

  for (const node of nodes) {
    if (node.kind !== 'device') {
      renderedNodes.push(node);
      continue;
    }
    const key = inventoryGroupId(node, grouping);
    const groupNodes = groups.get(key) ?? [];
    groupNodes.push(node);
    groups.set(key, groupNodes);
  }

  const nodeIdMap = new Map<string, string>();
  for (const [groupId, members] of groups) {
    if (expandedGroupIds.has(groupId) || members.length === 1) {
      for (const member of members) {
        renderedNodes.push(member);
        nodeIdMap.set(member.id, member.id);
      }
      continue;
    }

    const summaryId = `aggregate:${groupId}`;
    const summary: InventoryRenderNode = {
      id: summaryId,
      kind: 'cluster',
      label: `${inventoryGroupLabel(groupId, grouping, sourceById)} (${members.length})`,
      active: members.some((member) => member.active),
      aggregate_group_id: groupId,
      member_count: members.length,
      tags: ['aggregate'],
    };
    renderedNodes.push(summary);
    for (const member of members) nodeIdMap.set(member.id, summaryId);
  }

  const renderedIds = new Set(renderedNodes.map((node) => node.id));
  const remappedEdges = new Map<string, InventoryEdge>();
  for (const edge of edges) {
    const source = nodeIdMap.get(edge.source) ?? edge.source;
    const target = nodeIdMap.get(edge.target) ?? edge.target;
    if (source === target) continue;
    if (!renderedIds.has(source) || !renderedIds.has(target)) continue;
    const id = `${edge.kind}:${source}:${target}`;
    if (remappedEdges.has(id)) continue;
    remappedEdges.set(id, { ...edge, id, source, target });
  }

  return {
    nodes: renderedNodes,
    edges: Array.from(remappedEdges.values()),
    aggregated: true,
  };
}

function inventoryGroupId(
  node: InventoryNode,
  grouping: InventoryGrouping,
): string {
  if (grouping === 'similarity') {
    if (node.kind === 'cluster') {
      return `similarity:${node.similarity_cluster_id || node.id.replace('cluster:', '')}`;
    }
    return `similarity:${node.similarity_cluster_id || 'unclustered'}`;
  }
  if (grouping === 'cmdb') {
    if (node.kind === 'owner') return node.id;
    if (node.kind === 'location_asset') return node.id;
    if (node.owner_id) return `owner:${node.owner_id}`;
    if (node.location_id) return `location:${node.location_id}`;
    return 'owner:unassigned';
  }
  if (node.kind === 'device') {
    return node.active ? 'registry:active' : 'registry:inactive';
  }
  return `registry:${node.kind}`;
}

function inventoryGroupLabel(
  groupId: string,
  grouping: InventoryGrouping,
  nodeById: Map<string, InventoryNode>,
): string {
  if (groupId === 'registry:active') return 'Active devices';
  if (groupId === 'registry:inactive') return 'Inactive devices';
  if (grouping === 'similarity') {
    return groupId.replace('similarity:', 'Cluster ');
  }
  if (groupId.startsWith('owner:')) {
    const ownerId = groupId.replace('owner:', '');
    return nodeById.get(groupId)?.label ?? ownerId;
  }
  if (groupId.startsWith('location:')) {
    const locationId = groupId.replace('location:', '');
    return nodeById.get(groupId)?.label ?? locationId;
  }
  return groupId;
}

function forceInventoryGroups(
  nodes: InventorySimNode[],
  grouping: InventoryGrouping,
  width: number,
  height: number,
): d3.Force<InventorySimNode, InventorySimEdge> {
  const groupIds = Array.from(
    new Set(nodes.map((node) => inventoryGroupId(node, grouping))),
  );
  const centers = new Map<string, { x: number; y: number }>();
  const radius = Math.max(80, Math.min(width, height) * 0.32);
  const centerX = width / 2;
  const centerY = height / 2;

  groupIds.forEach((groupId, index) => {
    if (grouping === 'cmdb') {
      const angle = (index / Math.max(1, groupIds.length)) * Math.PI * 2;
      centers.set(groupId, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
      return;
    }

    const seed = stableUnitValue(groupId);
    const angle = seed * Math.PI * 2;
    const distance = radius * (0.45 + seed * 0.55);
    centers.set(groupId, {
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    });
  });

  let simulationNodes = nodes;
  const force = (alpha: number) => {
    for (const node of simulationNodes) {
      const center = centers.get(inventoryGroupId(node, grouping)) ?? {
        x: centerX,
        y: centerY,
      };
      node.vx =
        (node.vx ?? 0) + (center.x - (node.x ?? center.x)) * alpha * 0.08;
      node.vy =
        (node.vy ?? 0) + (center.y - (node.y ?? center.y)) * alpha * 0.08;
    }
  };
  force.initialize = (nextNodes: InventorySimNode[]) => {
    simulationNodes = nextNodes;
  };
  return force;
}

export function inventoryNodeRadius(node: InventoryRenderNode): number {
  if (node.aggregate_group_id) {
    return 12 + Math.min((node.member_count ?? 1) * 0.9, 18);
  }
  if (node.kind === 'cluster') return 12;
  if (node.kind === 'owner' || node.kind === 'location_asset') return 10;
  if (node.kind === 'merge_candidate') return 9;
  return 7;
}

function inventoryNodeShapePath(node: InventoryRenderNode): string {
  const r = inventoryNodeRadius(node);
  switch (node.kind) {
    case 'device':
      return `M0,${-r}L${r},0L0,${r}L${-r},0Z`;
    case 'owner':
      return polygonPath(r * 1.08, 5);
    case 'location_asset':
      return `M${-r},${-r}L${r},${-r}L${r},${r}L${-r},${r}Z`;
    case 'cluster':
      return polygonPath(r, 6);
    case 'merge_candidate':
      return polygonPath(r * 1.15, 3, Math.PI / 2);
    default:
      return circlePath(r);
  }
}

export function inventoryNodeColor(
  node: Pick<InventoryRenderNode, 'kind'>,
): string {
  switch (node.kind) {
    case 'device':
      return 'var(--color-accent)';
    case 'owner':
      return 'var(--color-info)';
    case 'location_asset':
      return 'var(--color-ok)';
    case 'cluster':
      return 'var(--score-dense)';
    case 'merge_candidate':
      return 'var(--color-warn)';
    default:
      return 'var(--color-text-tertiary)';
  }
}

export function inventoryNodeKindLabel(kind: InventoryNodeKind): string {
  switch (kind) {
    case 'location_asset':
      return 'Location';
    case 'merge_candidate':
      return 'Merge candidate';
    default:
      return kind.replaceAll('_', ' ');
  }
}

function inventoryNodeAriaLabel(node: InventoryRenderNode): string {
  if (node.aggregate_group_id) {
    return `${node.member_count ?? 0} device group ${node.label}`;
  }
  return `${inventoryNodeKindLabel(node.kind)} ${node.label}`;
}

function inventoryEdgeColor(kind: string): string {
  switch (kind) {
    case 'owns':
      return 'var(--color-info)';
    case 'located_at':
      return 'var(--color-ok)';
    case 'cluster_member':
      return 'var(--score-dense)';
    case 'merge_candidate':
      return 'var(--color-warn)';
    case 'same_device':
      return 'var(--color-danger)';
    default:
      return 'var(--color-border)';
  }
}

function inventoryLinkDistance(kind: string): number {
  switch (kind) {
    case 'cluster_member':
      return 54;
    case 'same_device':
    case 'merge_candidate':
      return 64;
    case 'owns':
    case 'located_at':
      return 88;
    default:
      return 96;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
