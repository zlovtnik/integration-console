import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import { api } from '~/api/client';
import type { DedupRun, DedupRunRequest } from '~/api/types';

export function dedupRunTerminal(status: string) {
  return ['succeeded', 'failed', 'cancelled'].includes(status);
}

export function useDedupRun() {
  const [runId, setRunId] = createSignal<string>();
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal('');
  const [statusError, setStatusError] = createSignal('');
  let active = true;
  let controller: AbortController | undefined;
  let invocation: { fingerprint: string; key: string } | undefined;
  const [run, { refetch, mutate }] = createResource<
    DedupRun | undefined,
    string
  >(runId, async (id, info) => {
    controller?.abort();
    controller = new AbortController();
    setStatusError('');
    try {
      const next = await api.dedupRun(id, controller.signal);
      return info.value?.run_id === next.run_id &&
        info.value.state_revision > next.state_revision
        ? info.value
        : next;
    } catch (error) {
      if (active && !(error instanceof Error && error.name === 'AbortError'))
        setStatusError('Run status is unavailable.');
      return info.value;
    }
  });

  createEffect(() => {
    const current = run();
    if (!current || statusError() || dedupRunTerminal(current.status)) return;
    const timer = window.setTimeout(() => void refetch(), 3000);
    onCleanup(() => window.clearTimeout(timer));
  });

  onCleanup(() => {
    active = false;
    controller?.abort();
  });

  async function submit(request: Omit<DedupRunRequest, 'idempotency_key'>) {
    if (submitting()) return;
    const fingerprint = JSON.stringify(request);
    if (
      !invocation ||
      invocation.fingerprint !== fingerprint ||
      (run() && dedupRunTerminal(run()!.status))
    ) {
      invocation = { fingerprint, key: crypto.randomUUID() };
    }
    setSubmitting(true);
    setSubmitError('');
    controller?.abort();
    controller = new AbortController();
    try {
      const admitted = await api.admitDedupRun(
        { ...request, idempotency_key: invocation.key },
        controller.signal,
      );
      if (!active) return;
      mutate(admitted);
      setRunId(admitted.run_id);
    } catch (error) {
      if (active && !(error instanceof Error && error.name === 'AbortError')) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : 'DQ processing request failed.',
        );
      }
    } finally {
      if (active) setSubmitting(false);
    }
  }

  return {
    run,
    submitting,
    submitError,
    statusError,
    submit,
    refresh: refetch,
  };
}
