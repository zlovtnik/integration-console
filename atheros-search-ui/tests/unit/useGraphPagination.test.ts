import { describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import { loadAllGraphPages } from '~/hooks/useGraphPagination';
import type { GraphResponse } from '~/api/types';

function page(ids: string[], cursor?: string): GraphResponse {
  return {
    nodes: ids.map((id) => ({ id, kind: 'device', label: id })),
    edges: [], generated_at: '2026-10-08T12:00:00Z', node_count: ids.length, edge_count: 0,
    ...(cursor ? { next_page_cursor: cursor } : {}),
    total_node_count: 4, total_edge_count: 0,
  };
}

describe('closed graph pagination', () => {
  it('continues through duplicate-only node pages when the cursor advances', async () => {
    const request = vi.spyOn(api, 'graphPage')
      .mockResolvedValueOnce(page(['a', 'c'], '1'))
      .mockResolvedValueOnce(page(['b'], '2'))
      .mockResolvedValueOnce(page(['c'], '3'))
      .mockResolvedValueOnce(page(['d']));
    const accumulated: string[][] = [];
    try {
      const outcome = await loadAllGraphPages({ scope: 'all' }, new AbortController().signal,
        (result) => accumulated.push(result.nodes.map((node) => node.id)));
      expect(outcome.complete).toBe(true);
      expect(outcome.pages).toBe(4);
      expect(accumulated.at(-1)).toEqual(['a', 'c', 'b', 'd']);
    } finally { request.mockRestore(); }
  });

  it('reports incomplete coverage when a continuation cursor repeats', async () => {
    const request = vi.spyOn(api, 'graphPage')
      .mockResolvedValueOnce(page(['a'], 'same'))
      .mockResolvedValueOnce(page(['a'], 'same'));
    try {
      const outcome = await loadAllGraphPages({ scope: 'all' }, new AbortController().signal, () => {});
      expect(outcome.complete).toBe(false);
      expect(outcome.pages).toBe(2);
    } finally { request.mockRestore(); }
  });
});
