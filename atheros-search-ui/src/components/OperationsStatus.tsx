import { For } from 'solid-js';
import { A } from '@solidjs/router';
import { pipeline, pipelineError } from '~/stores/operationsStore';

export function measurement(value: number | null | undefined): string {
  return value === null || value === undefined
    ? 'Unknown'
    : value.toLocaleString();
}

export function measuredTime(value: string | null | undefined): string {
  return value || 'Unknown';
}

export function OperationStatus(props: { value?: string | null | undefined }) {
  return (
    <span class="operation-status" data-status={props.value || 'unknown'}>
      {props.value || 'unknown'}
    </span>
  );
}

export function PipelineStrip() {
  return (
    <section class="pipeline-strip" aria-label="Global pipeline status">
      <A href="/ingestion">Pipeline</A>
      <OperationStatus
        value={pipelineError() ? 'unavailable' : pipeline()?.status}
      />
      <For each={pipeline()?.stages}>
        {(stage) => (
          <span class="pipeline-stage">
            {stage.label}: <OperationStatus value={stage.status} />
          </span>
        )}
      </For>
      <span class="caption">Global measurements</span>
    </section>
  );
}
