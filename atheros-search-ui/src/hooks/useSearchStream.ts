import { batch } from 'solid-js';
import { ApiError } from '~/api/client';
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

type ErrorMapper = (error: unknown) => string;

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

function defaultErrorMapper(error: unknown): string {
  return (
    (error instanceof Error && error.message) ||
    'Cannot reach atheros-search - check API_BASE or service health.'
  );
}

export function useSearchStream() {
  let abortCtrl: AbortController | null = null;

  function applyParsed(parsed: SearchResult | StreamEnvelope): boolean {
    if (isSearchResult(parsed)) {
      setResults((items) => [...items, parsed]);
      return false;
    }

    if (parsed.result) setResults((items) => [...items, parsed.result!]);
    if (parsed.meta) setMeta(parsed.meta);
    return Boolean(parsed.done);
  }

  async function stream(
    request: SearchRequest,
    mapError: ErrorMapper = defaultErrorMapper,
  ) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    const current = abortCtrl;
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
      // Combine the user abort signal with a 10s client-side timeout
      const timeoutSignal = AbortSignal.timeout(10_000);
      const combinedSignal = AbortSignal.any
        ? AbortSignal.any([current.signal, timeoutSignal])
        : current.signal;

      const response = await fetch(`${env.apiBase}/v1/search/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ApiError(response.status, body || response.statusText);
      }
      if (!response.body) {
        throw new ApiError(
          response.status,
          'Streaming response body was empty.',
        );
      }

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '';
      let shouldStop = false;

      while (!shouldStop) {
        const { value, done } = await reader.read();
        if (done) {
          const parsed = readStreamLine(buffer.trim());
          if (parsed) shouldStop = applyParsed(parsed);
          break;
        }

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = readStreamLine(line.trim());
          if (!parsed) continue;
          shouldStop = applyParsed(parsed);
          if (shouldStop) break;
        }
      }
    } catch (streamError) {
      if (streamError instanceof Error && streamError.name === 'TimeoutError') {
        setError('Search request timed out. Please try again.');
      } else if (
        !(streamError instanceof Error && streamError.name === 'AbortError')
      ) {
        setError(mapError(streamError));
      }
    } finally {
      if (abortCtrl === current) {
        abortCtrl = null;
        setStreaming(false);
      }
    }
  }

  function cancel() {
    abortCtrl?.abort();
    abortCtrl = null;
    setStreaming(false);
  }

  return { stream, cancel };
}
