import { createSignal, Show } from 'solid-js';
import { useDedupRun, dedupRunTerminal } from '~/hooks/useDedupRun';
import { inventoryFilters } from '~/stores/inventoryStore';

export function DedupProcessing() {
  const [scope, setScope] = createSignal(
    inventoryFilters.location_ids?.length === 1
      ? inventoryFilters.location_ids[0]!
      : '*',
  );
  const [policy, setPolicy] = createSignal('');
  const [limit, setLimit] = createSignal(100);
  const processing = useDedupRun();
  const running = () =>
    !!processing.run() && !dedupRunTerminal(processing.run()!.status);

  return (
    <section class="dedup-processing" aria-labelledby="dedup-processing-title">
      <h3 id="dedup-processing-title">
        DQ processing <span class="graph-stat">Beta</span>
      </h3>
      <p>
        Prepare candidate proposals for review. The backend selects shadow or
        enabled mode for the authorized scope. Human decisions remain final.
      </p>
      <form
        class="dedup-bulk-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void processing.submit({
            operation: 'prepare_candidates',
            authorized_scope: scope().trim(),
            policy_version: policy().trim(),
            max_candidates: limit(),
          });
        }}
      >
        <label class="field">
          <span>Authorized location or *</span>
          <input
            required
            value={scope()}
            onInput={(event) => setScope(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>Approved policy version</span>
          <input
            required
            value={policy()}
            onInput={(event) => setPolicy(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>Maximum candidates</span>
          <input
            type="number"
            min="1"
            max="1000"
            required
            value={limit()}
            onInput={(event) => setLimit(event.currentTarget.valueAsNumber)}
          />
        </label>
        <button
          class="btn btn-secondary"
          type="submit"
          disabled={processing.submitting() || running()}
        >
          {processing.submitting() ? 'Submitting...' : 'Prepare candidates'}
        </button>
      </form>
      <Show when={processing.submitError()}>
        <p role="alert">
          {processing.submitError()} Retry preserves the invocation identity.
        </p>
      </Show>
      <Show when={processing.statusError()}>
        <p role="alert">
          {processing.statusError()}{' '}
          <button
            type="button"
            class="btn btn-secondary"
            onClick={() => void processing.refresh()}
          >
            Retry status
          </button>
        </p>
      </Show>
      <Show when={processing.run()}>
        {(run) => (
          <div aria-live="polite">
            <p>
              <strong>Run {run().run_id}</strong> / {run().processor_version} /{' '}
              {run().execution_mode} / {run().status}
            </p>
            <p>
              {run().status === 'succeeded'
                ? 'Run completed.'
                : 'Processing status: ' + run().status + '.'}{' '}
              {run().projection_applied
                ? 'Projection applied.'
                : 'Projection application is not confirmed.'}
            </p>
            <Show when={run().sanitized_error}>
              <p role="alert">
                {run().error_code}: {run().sanitized_error}
              </p>
            </Show>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={processing.run.loading}
              onClick={() => void processing.refresh()}
            >
              Refresh run status
            </button>
          </div>
        )}
      </Show>
    </section>
  );
}
