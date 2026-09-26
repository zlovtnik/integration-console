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
import { useGraphPresentation } from './graphPresentation';

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
  onClearSelection?: () => void;
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
  const presentation = useGraphPresentation<InventorySimNode>(
    svgRef,
    () => options.selectedNodeId?.() ?? null,
    () => options.onClearSelection?.(),
  );
  let visibilityEffectReady = false;

  function build() {
    presentation.reset();
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
    const renderedEdges = model.edges.filter(
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

    const defs = presentation.prepare(svg);
    [
      'owns',
      'located_at',
      'cluster_member',
      'merge_candidate',
      'same_device',
    ].forEach((kind) => {
      defs
        .append('marker')
        .attr('id', `${presentation.prefix}-arrow-${kind}`)
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
      .style('--edge-opacity', '0.45')
      .attr(
        'marker-end',
        (edge) => `url(#${presentation.prefix}-arrow-${edge.kind})`,
      );

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

    presentation.decorate(node, {
      radius: inventoryNodeRadius,
      color: inventoryNodeColor,
      count: (item) => item.member_count,
      alwaysLabel: (item) =>
        ['owner', 'location_asset', 'cluster', 'aggregate_group'].includes(
          item.kind,
        ),
    });

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

    function kindIsVisible(kind: InventoryNodeKind): boolean {
      return kind === 'aggregate_group' || visibleKinds.has(kind);
    }

    d3.select(el)
      .selectAll<SVGGElement, InventorySimNode>('.inventory-node')
      .style('display', (item) => (kindIsVisible(item.kind) ? null : 'none'));

    function edgeIsVisible(edge: InventorySimEdge): boolean {
      return (
        kindIsVisible(endpointKind(edge.source)) &&
        kindIsVisible(endpointKind(edge.target))
      );
    }

    d3.select(el)
      .selectAll<SVGLineElement, InventorySimEdge>('.inventory-link')
      .style('display', (edge) => (edgeIsVisible(edge) ? null : 'none'))
      .attr('marker-end', (edge) =>
        edgeIsVisible(edge)
          ? `url(#${presentation.prefix}-arrow-${edge.kind})`
          : null,
      );

    presentation.paint();
    if (restartSimulation) layout.restart();
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const related = presentation.paint();
    if (selected && related.size)
      queueMicrotask(() => layout.fitToGraph(related, 80));
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
      kind: 'aggregate_group',
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
  node: InventoryRenderNode,
  grouping: InventoryGrouping,
): string {
  if (node.aggregate_group_id) return node.aggregate_group_id;
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

export function inventoryNodeColor(
  node: Pick<InventoryRenderNode, 'kind'>,
): string {
  switch (node.kind) {
    case 'device':
      return 'var(--graph-device)';
    case 'owner':
      return 'var(--graph-info)';
    case 'location_asset':
      return 'var(--graph-ok)';
    case 'cluster':
      return 'var(--graph-cluster)';
    case 'aggregate_group':
      return 'var(--color-text-tertiary)';
    case 'merge_candidate':
      return 'var(--graph-warn)';
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
    case 'aggregate_group':
      return 'Visual group';
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
      return 'var(--graph-info)';
    case 'located_at':
      return 'var(--graph-ok)';
    case 'cluster_member':
      return 'var(--graph-cluster)';
    case 'merge_candidate':
      return 'var(--graph-warn)';
    case 'same_device':
      return 'var(--graph-danger)';
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
