import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '~/api/client';

type HealthState = 'ok' | 'warn' | 'error';

export function ApiStatus() {
  const [status, setStatus] = createSignal<HealthState>('warn');

  async function check() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);

    try {
      await api.healthz(controller.signal);
      setStatus('ok');
    } catch (error) {
      setStatus((error as Error).name === 'AbortError' ? 'warn' : 'error');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  onMount(() => {
    void check();
    const interval = window.setInterval(check, 30_000);
    onCleanup(() => window.clearInterval(interval));
  });

  const label = () =>
    ({
      ok: 'API status: healthy',
      warn: 'API status: degraded',
      error: 'API status: unreachable',
    })[status()];

  return (
    <button
      type="button"
      class={`api-status api-status--${status()}`}
      aria-label={label()}
      title={label()}
    />
  );
}
