import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approvedCall,
  hostBridge,
  safeMetadata,
  workspacePath,
} from '~/dq/bridge';

afterEach(() => vi.useRealTimers());
function fixture(request = vi.fn().mockResolvedValue({ items: [] })) {
  const frame = { postMessage: vi.fn() } as unknown as Window;
  const navigate = vi.fn();
  const ready = vi.fn();
  const bridge = hostBridge({
    frame: () => frame,
    channel: 'channel-1',
    origin: window.location.origin,
    navigate,
    ready,
    projection: vi.fn(),
    request,
  });
  const message = (
    overrides: Record<string, unknown> = {},
    source: Window = frame,
    origin = window.location.origin,
  ) =>
    new MessageEvent('message', {
      source,
      origin,
      data: {
        version: 1,
        channel: 'channel-1',
        type: 'request',
        request_id: 'id-1',
        operation: 'catalog',
        payload: {},
        ...overrides,
      },
    });
  return { frame, navigate, ready, bridge, message, request };
}
describe('DQ host boundary', () => {
  it('rejects forged identities, origins, channels, IDs, credentials and oversized payloads', async () => {
    const f = fixture();
    for (const event of [
      f.message({}, window),
      f.message({}, f.frame, 'https://evil.test'),
      f.message({ channel: 'other' }),
      f.message({ version: 2 }),
      f.message({ request_id: '../x' }),
      f.message({ payload: { token: 'secret' } }),
      f.message({ payload: { value: 'x'.repeat(65536) } }),
    ])
      await f.bridge.receive(event);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.frame.postMessage).not.toHaveBeenCalled();
    f.bridge.dispose();
  });
  it('rejects unknown operations and duplicate IDs without executing twice', async () => {
    const f = fixture();
    await f.bridge.receive(f.message());
    await f.bridge.receive(f.message());
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.bridge.receive(
      f.message({
        request_id: 'id-2',
        operation: 'fetch',
        payload: { url: 'https://evil.test' },
      }),
    );
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.frame.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: 'Unsupported DQ operation.' }),
      window.location.origin,
    );
    f.bridge.dispose();
  });
  it('aborts on timeout and teardown and suppresses late replies', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let finish: ((value: unknown) => void) | undefined;
    const request = vi.fn().mockImplementation((_call, received) => {
      signal = received;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const f = fixture(request);
    const pending = f.bridge.receive(f.message());
    await vi.advanceTimersByTimeAsync(10001);
    expect(signal?.aborted).toBe(true);
    f.bridge.dispose();
    finish?.({ items: [] });
    await pending;
    expect(f.frame.postMessage).not.toHaveBeenCalled();
    const g = fixture(request);
    const second = g.bridge.receive(g.message());
    g.bridge.dispose();
    expect(signal?.aborted).toBe(true);
    finish?.({ items: [] });
    await second;
    expect(g.frame.postMessage).not.toHaveBeenCalled();
  });
  it('allows only scoped operations and workspace navigation', async () => {
    expect(approvedCall('catalog', { namespace: 'outside' })).toBeUndefined();
    expect(approvedCall('cancel', { id: '../run' })).toBeUndefined();
    expect(
      approvedCall('admit', {
        processor_id: 'atheros.dedup',
        processor_version: 'v1',
        operation: 'reconcile_decision',
        parameters: {},
        idempotency_key: 'id',
      }),
    ).toBeUndefined();
    expect(workspacePath('/dq/runs/run-1')).toBe(true);
    expect(workspacePath('//evil.test/dq')).toBe(false);
    expect(workspacePath('/dq/runs/..')).toBe(false);
    const f = fixture();
    await f.bridge.receive(
      f.message({ operation: 'navigate', payload: { path: '/dq/runs/run-1' } }),
    );
    expect(f.navigate).toHaveBeenCalledWith('/dq/runs/run-1');
    f.bridge.dispose();
    expect(safeMetadata({ Authorization: 'Bearer secret' })).toBe(false);
    expect(safeMetadata({ parameters: { access_token: 'secret' } })).toBe(
      false,
    );
  });
});
