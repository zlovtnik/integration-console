import { batch, createSignal } from 'solid-js';
import type { OperationsPipeline } from '~/api/operations';

export const [pipeline, setPipeline] = createSignal<OperationsPipeline>();
export const [pipelineError, setPipelineError] = createSignal(false);

export function clearOperations(): void {
  batch(() => {
    setPipeline(undefined);
    setPipelineError(false);
  });
}
