import { authenticatedFetch } from '~/api/client';
import { env } from '~/env';

export const bridgeVersion = 1;
export const metadataLimit = 65536;
const id = /^[A-Za-z0-9_.-]{1,200}$/;
const segment = (value: unknown): value is string =>
  typeof value === 'string' &&
  id.test(value) &&
  value !== '.' &&
  value !== '..';
export function safeMetadata(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    return (
      !!json &&
      new TextEncoder().encode(json).length <= metadataLimit &&
      !/"(?:authorization|access_token|refresh_token|service_token|bearer|token|lease_token)"\s*:|Bearer\s/i.test(
        json,
      )
    );
  } catch {
    return false;
  }
}
export function workspacePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (['/dq', '/dq/', '/dq/processors', '/dq/atheros/dedup'].includes(value))
    return true;
  const parts = value.split('/');
  return (
    parts[1] === 'dq' &&
    ((parts.length === 4 &&
      ['runs', 'artifacts'].includes(parts[2]!) &&
      segment(parts[3])) ||
      (parts.length === 6 &&
        parts[2] === 'processors' &&
        segment(parts[3]) &&
        segment(parts[4]) &&
        parts[5] === 'invoke'))
  );
}
export type UIContext = {
  enabled: boolean;
  beta_enabled: boolean;
  approved_remote_origin: string;
  bridge_version: number;
};
type Call = { path: string; method: 'GET' | 'POST'; body?: unknown };
export function approvedCall(
  operation: string,
  payload: Record<string, unknown>,
): Call | undefined {
  const keys = Object.keys(payload);
  const only = (...allowed: string[]) =>
    keys.every((key) => allowed.includes(key));
  switch (operation) {
    case 'context':
      if (only()) return { path: '/v1/dq/context', method: 'GET' };
      break;
    case 'catalog':
      if (only()) return { path: '/v1/dq/processors', method: 'GET' };
      break;
    case 'version':
      if (
        only('id', 'version') &&
        segment(payload.id) &&
        segment(payload.version)
      )
        return {
          path: `/v1/dq/processor-versions/${payload.id}/${payload.version}`,
          method: 'GET',
        };
      break;
    case 'run':
    case 'artifact':
      if (only('id') && segment(payload.id))
        return {
          path: `/v1/dq/${operation === 'run' ? 'runs' : 'artifacts'}/${payload.id}`,
          method: 'GET',
        };
      break;
    case 'cancel':
    case 'replay':
    case 'access':
      if (
        only('id', ...(operation === 'replay' ? ['idempotency_key'] : [])) &&
        segment(payload.id) &&
        (operation !== 'replay' || segment(payload.idempotency_key))
      )
        return {
          path: `/v1/dq/${operation === 'access' ? 'artifacts' : 'runs'}/${payload.id}/${operation}`,
          method: 'POST',
          body:
            operation === 'replay'
              ? { idempotency_key: payload.idempotency_key }
              : {},
        };
      break;
    case 'admit':
      if (
        only(
          'processor_id',
          'processor_version',
          'operation',
          'parameters',
          'idempotency_key',
        ) &&
        segment(payload.processor_id) &&
        segment(payload.processor_version) &&
        segment(payload.operation) &&
        segment(payload.idempotency_key) &&
        payload.parameters &&
        typeof payload.parameters === 'object' &&
        !Array.isArray(payload.parameters) &&
        (payload.processor_id !== 'atheros.dedup' ||
          payload.operation === 'prepare_candidates')
      )
        return { path: '/v1/dq/runs', method: 'POST', body: payload };
  }
  return undefined;
}

export async function fetchDQ(
  call: Call,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await authenticatedFetch(env.apiBase + call.path, {
    method: call.method,
    headers: { 'Content-Type': 'application/json' },
    body: call.body === undefined ? null : JSON.stringify(call.body),
    redirect: 'error',
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Admission capacity is exhausted. Retry later.'
        : 'DQ request unavailable or unauthorized.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DQ metadata is unavailable.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > metadataLimit) {
        await reader.cancel();
        throw new Error('DQ metadata exceeds 64 KiB.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!safeMetadata(value)) throw new Error('Invalid DQ metadata.');
  return value;
}

export function hostBridge(options: {
  frame: () => Window | null;
  channel: string;
  origin: string;
  navigate: (path: string) => void;
  ready: () => void;
  projection: () => void;
  request?: typeof fetchDQ;
}) {
  const seen = new Set<string>();
  const pending = new Set<AbortController>();
  let disposed = false;
  const send = (value: object) => {
    if (!disposed && safeMetadata(value))
      options.frame()?.postMessage(value, options.origin);
  };
  const receive = async (event: MessageEvent) => {
    if (
      disposed ||
      !options.frame() ||
      event.source !== options.frame() ||
      event.origin !== options.origin ||
      !safeMetadata(event.data)
    )
      return;
    const message = event.data;
    if (
      !message ||
      message.version !== bridgeVersion ||
      message.channel !== options.channel ||
      message.type !== 'request' ||
      !segment(message.request_id) ||
      typeof message.operation !== 'string' ||
      !message.payload ||
      typeof message.payload !== 'object' ||
      Array.isArray(message.payload)
    )
      return;
    if (
      Object.keys(message).some(
        (key) =>
          ![
            'version',
            'channel',
            'type',
            'request_id',
            'operation',
            'payload',
          ].includes(key),
      ) ||
      seen.has(message.request_id) ||
      seen.size >= 4096 ||
      pending.size >= 32
    )
      return;
    seen.add(message.request_id);
    const reply = (payload: unknown, error?: string) =>
      send({
        version: bridgeVersion,
        channel: options.channel,
        type: 'response',
        request_id: message.request_id,
        payload,
        error,
      });
    if (message.operation === 'navigate') {
      if (
        Object.keys(message.payload).length !== 1 ||
        !workspacePath(message.payload.path)
      ) {
        reply(null, 'Invalid navigation.');
        return;
      }
      options.navigate(message.payload.path);
      reply({});
      return;
    }
    const call = approvedCall(message.operation, message.payload);
    if (!call) {
      reply(null, 'Unsupported DQ operation.');
      return;
    }
    const controller = new AbortController();
    pending.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const result = await (options.request || fetchDQ)(
        call,
        controller.signal,
      );
      if (controller.signal.aborted || disposed) return;
      if (message.operation === 'context') options.ready();
      const run = result as {
        operation?: string;
        projection_applied?: boolean;
      };
      if (run?.operation === 'prepare_candidates' && run.projection_applied)
        options.projection();
      reply(result);
    } catch {
      if (!disposed)
        reply(
          null,
          controller.signal.aborted
            ? 'DQ request timed out.'
            : 'DQ request failed. Retry later.',
        );
    } finally {
      window.clearTimeout(timer);
      pending.delete(controller);
    }
  };
  return {
    receive,
    route: (path: string) => {
      if (workspacePath(path))
        send({
          version: bridgeVersion,
          channel: options.channel,
          type: 'route',
          path,
        });
    },
    dispose: () => {
      disposed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
      seen.clear();
    },
  };
}
