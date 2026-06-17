import { batch, createSignal } from 'solid-js';
import {
  ApiError,
  apiErrorFromResponse,
  normalizeSearchMeta,
  normalizeSearchResult,
  prepareSearchRequest,
} from '~/api/client';
import { env } from '~/env';
import {
  appendResult,
  clearResults,
  results,
  setError,
  setLoading,
  setMeta,
  setStreaming,
} from '~/stores/searchStore';
import type { SearchRequest, SearchResponse, SearchResult } from '~/api/types';

type StreamEnvelope = {
  type?: 'result' | 'meta' | 'done';
  result?: SearchResult;
  meta?: Partial<SearchResponse>;
  done?: boolean;
};

type ErrorMapper = (error: unknown) => string;

function isRawSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.source_key === 'string' || typeof obj.sourceKey === 'string'
  );
}

function resultIdentity(result: SearchResult): string {
  return (
    result.source_key ||
    [
      result.source_table,
      result.source_mac,
      result.location_id,
      result.sensor_id,
      result.observed_at,
      result.detail_json,
    ]
      .filter(Boolean)
      .join('|')
  );
}

function readStreamLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
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
  const [retrying, setRetrying] = createSignal(false);

  function isEnvelope(value: unknown): value is StreamEnvelope {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      obj.type !== undefined || obj.meta !== undefined || obj.done !== undefined
    );
  }

  function applyParsed(
    parsed: unknown,
    seenKeys: Set<string>,
  ): { done: boolean; envelopeProtocol: boolean } {
    if (isRawSearchResult(parsed)) {
      const result = normalizeSearchResult(parsed);
      const key = resultIdentity(result);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        appendResult(result);
      }
      return { done: false, envelopeProtocol: false };
    }

    // Not a raw result and not an envelope — skip silently.
    if (!isEnvelope(parsed)) {
      return { done: false, envelopeProtocol: false };
    }

    if (parsed.type === 'result' && isRawSearchResult(parsed.result)) {
      const result = normalizeSearchResult(parsed.result);
      const key = resultIdentity(result);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        appendResult(result);
      }
      return { done: false, envelopeProtocol: true };
    }

    if (isRawSearchResult(parsed.result)) {
      const result = normalizeSearchResult(parsed.result);
      const key = resultIdentity(result);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        appendResult(result);
      }
    }
    if (parsed.meta) setMeta(normalizeSearchMeta(parsed.meta));
    return {
      done: Boolean(parsed.done || parsed.type === 'done'),
      envelopeProtocol: true,
    };
  }

  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let timeout: number | undefined;
      const cleanup = () => {
        if (timeout !== undefined) window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      if (signal.aborted) {
        abort();
        return;
      }

      signal.addEventListener('abort', abort, { once: true });
      timeout = window.setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
    });
  }

  function signalWithTimeout(signal: AbortSignal, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
      timeoutMs,
    );
    const abort = () =>
      controller.abort(new DOMException('Aborted', 'AbortError'));

    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });

    controller.signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      },
      { once: true },
    );

    return controller.signal;
  }

  async function streamOnce(
    request: SearchRequest,
    current: AbortController,
    seenKeys: Set<string>,
  ): Promise<{ completed: boolean; envelopeProtocol: boolean }> {
    const response = await fetch(`${env.apiBase}/v1/search/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prepareSearchRequest(request, 'search-stream')),
      signal: signalWithTimeout(current.signal, 30_000),
    });

    if (!response.ok) {
      throw await apiErrorFromResponse(response);
    }
    if (!response.body) {
      throw new ApiError(response.status, 'Streaming response body was empty.');
    }

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = '';
    let completed = false;
    let envelopeProtocol = false;

    while (!completed) {
      const { value, done } = await reader.read();
      if (done) {
        const parsed = readStreamLine(buffer.trim());
        if (parsed) {
          const applied = applyParsed(parsed, seenKeys);
          completed = applied.done;
          envelopeProtocol ||= applied.envelopeProtocol;
        }
        break;
      }

      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = readStreamLine(line.trim());
        if (!parsed) continue;
        const applied = applyParsed(parsed, seenKeys);
        completed = applied.done;
        envelopeProtocol ||= applied.envelopeProtocol;
        if (completed) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }

    return {
      completed: completed || !envelopeProtocol,
      envelopeProtocol,
    };
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
      setRetrying(false);
      setStreaming(true);
      setError(null);
      setMeta(initialMeta);
    });

    try {
      const seenKeys = new Set<string>();
      let completed = false;

      for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
        if (attempt > 0) {
          setRetrying(true);
          await wait(250 * 2 ** (attempt - 1), current.signal);
        }

        const result = await streamOnce(request, current, seenKeys);
        completed = result.completed;

        if (!completed && result.envelopeProtocol && attempt < 2) {
          continue;
        }
        break;
      }

      if (!completed && !current.signal.aborted) {
        if (results.length > 0) {
          // Partial results are better than nothing; nudge instead of error.
          setError(
            'Search stream ended before completion. Showing partial results.',
          );
        } else {
          setError(
            'Search stream ended before completion. No results available.',
          );
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
        setRetrying(false);
        setStreaming(false);
      }
    }
  }

  function cancel() {
    abortCtrl?.abort();
    abortCtrl = null;
    setRetrying(false);
    setStreaming(false);
  }

  return { stream, cancel, retrying };
}
