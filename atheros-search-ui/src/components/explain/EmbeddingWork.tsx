import { For, Show } from 'solid-js';
import type { EmbeddingWork } from '~/api/types';
import { formatDate } from '~/components/graph/graphPanelUtils';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  leased: 'In progress',
  completed: 'Embedded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function statusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'explain-status explain-status--ok';
    case 'failed':
      return 'explain-status explain-status--danger';
    case 'leased':
      return 'explain-status explain-status--info';
    default:
      return 'explain-status explain-status--warn';
  }
}

/**
 * The embedding work queued against this exact document. A stored vector is not
 * the same as a current one: content_current is the check that matters, because
 * a document whose text changed leaves its old vector in place until the job
 * for the new hash completes.
 */
export function EmbeddingWorkList(props: {
  work: EmbeddingWork[];
  note?: string | undefined;
}) {
  return (
    <>
      <Show
        when={props.work.length > 0}
        fallback={
          <p class="graph-panel-empty" role="status">
            No embedding job has been queued for this document, so it is not
            reachable by dense or hybrid search.
          </p>
        }
      >
        <div class="graph-detail-list">
          <For each={props.work}>
            {(item) => (
              <div class="graph-detail-row">
                <dt>
                  <span class={statusClass(item.status)}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </dt>
                <dd>
                  <span class="mono">
                    {item.embedding_kind} / {item.embedding_model}
                  </span>
                  <span>
                    attempt {item.attempt_count} of {item.max_attempts}
                  </span>
                  <span>
                    {item.has_vector ? 'vector stored' : 'no vector stored'}
                  </span>
                  <span
                    class={
                      item.content_current
                        ? 'explain-corroborated'
                        : 'explain-uncorroborated'
                    }
                  >
                    {item.content_current
                      ? 'vector matches the current document'
                      : 'vector does not match the current document'}
                  </span>
                  <Show when={item.embedded_at}>
                    <span>embedded {formatDate(item.embedded_at)}</span>
                  </Show>
                  <Show when={item.completed_at}>
                    <span>completed {formatDate(item.completed_at)}</span>
                  </Show>
                  <Show when={item.next_attempt_at && item.status !== 'completed'}>
                    <span>next attempt {formatDate(item.next_attempt_at)}</span>
                  </Show>
                  <Show when={item.last_error}>
                    <span class="explain-error-text">{item.last_error}</span>
                  </Show>
                </dd>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.note}>
        <p class="caption">{props.note}</p>
      </Show>
    </>
  );
}
