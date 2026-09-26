import { batch } from 'solid-js';
import { api } from '~/api/client';
import type { GraphEdge, GraphFilters, GraphNode, GraphResponse } from '~/api/types';

export interface GraphPageAccumulator {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
  generatedAt: string;
}

export interface PageOutcome {
  complete: boolean;
  pages: number;
  loadedNodes: number;
  totalNodes: number;
  totalEdges: number;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES = 400;

/**
 * Fetch every page of a scope:"all" graph request, deduplicating nodes and
 * edges by ID. Aborts promptly when the signal fires (filter change), and
 * reports whether the accumulated data covers the filtered inventory.
 */
export async function loadAllGraphPages(
  filters: GraphFilters,
  signal: AbortSignal,
  onPage: (accumulator: GraphPageAccumulator) => void,
): Promise<PageOutcome> {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let totalNodes = 0;
  let totalEdges = 0;
  let generatedAt = '';
  let pages = 0;
  let cursor: string | undefined;

  for (;;) {
    if (signal.aborted) {
      return {
        complete: false,
        pages,
        loadedNodes: nodes.length,
        totalNodes,
        totalEdges,
      };
    }
    const response: GraphResponse = await api.graphPage(
      { ...filters, scope: 'all', page_size: filters.page_size ?? DEFAULT_PAGE_SIZE },
      cursor,
      signal,
    );
    pages += 1;

    let added = false;
    for (const node of response.nodes) {
      if (nodeIds.has(node.id)) continue;
      nodeIds.add(node.id);
      nodes.push(node);
      added = true;
    }
    for (const edge of response.edges) {
      if (edgeIds.has(edge.id)) continue;
      edgeIds.add(edge.id);
      edges.push(edge);
      added = true;
    }
    if (response.total_node_count !== undefined) totalNodes = response.total_node_count;
    if (response.total_edge_count !== undefined) totalEdges = response.total_edge_count;
    if (!generatedAt) generatedAt = response.generated_at;

    batch(() => {
      onPage({
        nodes: [...nodes],
        edges: [...edges],
        totalNodes,
        totalEdges,
        generatedAt,
      });
    });

    cursor = response.next_page_cursor ?? undefined;
    if (!cursor) {
      return {
        complete: true,
        pages,
        loadedNodes: nodes.length,
        totalNodes,
        totalEdges,
      };
    }
    if (pages >= MAX_PAGES) {
      throw new Error(
        `Graph pagination did not complete after ${MAX_PAGES} pages.`,
      );
    }
    if (!added && pages > 1) {
      // Defensive: a cursor that yields no new rows should have ended the
      // sequence. Treat it as incomplete rather than looping forever.
      return {
        complete: false,
        pages,
        loadedNodes: nodes.length,
        totalNodes,
        totalEdges,
      };
    }
  }
}