import { batch } from 'solid-js';
import { env } from '~/env';
import {
  clearResults,
  setError,
  setLoading,
  setMeta,
  setResults,
  setStreaming,
} from '~/stores/searchStore';
import type { SearchRequest, SearchResponse, SearchResult } from '~/api/types';

type StreamEnvelope = {
  result?: SearchResult;
  meta?: Partial<SearchResponse>;
  done?: boolean;
};

function isSearchResult(value: unknown): value is SearchResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source_key' in value &&
    typeof (value as SearchResult).source_key === 'string'
  );
}

function readStreamLine(line: string): SearchResult | StreamEnvelope | null {
  try {
    return JSON.parse(line) as SearchResult | StreamEnvelope;
  } catch {
    return null;
  }
}

export function useSearchStream() {
  let abortCtrl: AbortController | null = null;

  async function stream(request: SearchRequest) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    const initialMeta: Partial<SearchResponse> = { fallback_reason: '' };
    if (request.mode) initialMeta.mode_used = request.mode;

    batch(() => {
      clearResults();
      setLoading(false);
      setStreaming(true);
      setError(null);
      setMeta(initialMeta);
    });

    try {
      const response = await fetch(`${env.apiBase}/v1/search/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.apiToken ? { Authorization: `Bearer ${env.apiToken}` } : {}),
        },
        body: JSON.stringify(request),
        signal: abortCtrl.signal,
      });

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      if (!response.body) throw new Error('Streaming response body was empty.');

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = readStreamLine(line.trim());
          if (!parsed) continue;

          if (isSearchResult(parsed)) {
            setResults((items) => [...items, parsed]);
          } else {
            if (parsed.result) setResults((items) => [...items, parsed.result!]);
            if (parsed.meta) setMeta(parsed.meta);
            if (parsed.done) break;
          }
        }
      }
    } catch (streamError) {
      if ((streamError as Error).name !== 'AbortError') {
        setError((streamError as Error).message);
      }
    } finally {
      setStreaming(false);
    }
  }

  function cancel() {
    abortCtrl?.abort();
    abortCtrl = null;
    setStreaming(false);
  }

  return { stream, cancel };
}
