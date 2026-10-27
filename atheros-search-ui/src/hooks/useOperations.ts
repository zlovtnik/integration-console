import { createEffect, onCleanup } from 'solid-js';
import { api } from '~/api/client';
import { auditGeneration } from '~/auth/auditState';
import { authStatus } from '~/auth/session';
import { setPipeline, setPipelineError } from '~/stores/operationsStore';

/** One shell poller shared by the strip and ingestion page. */
export function usePipeline(): void {
  createEffect(() => {
    const generation = auditGeneration();
    if (authStatus() !== 'authenticated') return;
    let controller: AbortController | undefined;
    async function refresh() {
      if (controller) return;
      controller = new AbortController();
      try {
        const value = await api.operationsPipeline(controller.signal);
        if (generation === auditGeneration()) {
          setPipeline(value);
          setPipelineError(false);
        }
      } catch {
        if (generation === auditGeneration() && !controller.signal.aborted) {
          setPipeline(undefined);
          setPipelineError(true);
        }
      } finally {
        controller = undefined;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    onCleanup(() => {
      window.clearInterval(timer);
      controller?.abort();
    });
  });
}
