import { createMemo, createResource, For, Show, onCleanup } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { api } from '~/api/client';
import {
  inventoryFilters,
  setInventoryFilters,
  setSelectedInventoryNodeId,
} from '~/stores/inventoryStore';
import type { InventoryFilters } from '~/api/types';
import { formatDateTime } from '~/utils/formatDateTime';
import { ReportStatus } from '~/components/ReportStatus';
import {
  DeviceSummaryLine,
  registrationLabel,
} from '~/components/graph/NodeDetailSections';
import { deviceAliasMacs } from '~/utils/inventoryRelations';

/**
 * This report loads one bounded page of identifiers with no graph
 * relationships, so the joined columns below are the fields each registry row
 * carries on its own. Cluster, merge, and ownership derivations are not
 * available here; the graph view resolves them.
 */
function aliasLabel(node: { known_macs?: string[]; mac?: string }): string {
  const macs = deviceAliasMacs(node as never);
  if (macs.length <= 1) return 'No aliases recorded';
  return `${macs.length} identifiers: ${macs.join(', ')}`;
}

export function InventoryTable() {
  const [params, setParams] = useSearchParams();
  const key = createMemo(() =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries({
          ...inventoryFilters,
          grouping: 'registry',
          scope: 'page',
          page_size: 50,
        })
          .filter(
            ([name, value]) =>
              value !== undefined &&
              value !== '' &&
              (!Array.isArray(value) || value.length > 0) &&
              (value !== false || name === 'registered'),
          )
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
  const cursor = () =>
    params.pf === key() && typeof params.page === 'string'
      ? params.page
      : undefined;
  const previous = (): string[] => {
    try {
      const value: unknown =
        params.pf === key() && typeof params.previous === 'string'
          ? JSON.parse(params.previous)
          : [];
      return Array.isArray(value) &&
        value.every((item) => typeof item === 'string')
        ? value
        : [];
    } catch {
      return [];
    }
  };
  let controller: AbortController | undefined;
  const [error, setError] = createResource(
    () => ({ key: key(), cursor: cursor() }),
    async (request) => {
      controller?.abort();
      controller = new AbortController();
      try {
        return {
          response: await api.inventoryPage(
            JSON.parse(request.key) as InventoryFilters,
            request.cursor,
            controller.signal,
          ),
          error: '',
        };
      } catch (err) {
        return {
          response: null,
          error:
            err instanceof Error && err.name === 'AbortError'
              ? ''
              : 'Inventory unavailable. ' + (err as Error).message,
        };
      }
    },
  );
  onCleanup(() => controller?.abort());
  const response = () => error()?.response;
  function move(next?: string) {
    const stack = previous();
    if (next) {
      setParams({
        page: next,
        pf: key(),
        previous: JSON.stringify([...stack, cursor() ?? '']),
      });
    } else {
      const page = stack.pop();
      setParams({
        page: page || undefined,
        pf: key(),
        previous: JSON.stringify(stack),
      });
    }
  }
  function sort(value: InventoryFilters['sort']) {
    setInventoryFilters('sort', value);
    setParams({ page: undefined, pf: undefined, previous: undefined });
  }
  return (
    <section class="inventory-table-report" aria-label="Observed identifiers">
      <div class="report-toolbar">
        <h1 class="heading-1">Observed identifiers</h1>
        <button
          class="btn btn-secondary"
          type="button"
          disabled={error.loading}
          onClick={() => void setError.refetch()}
        >
          Refresh table
        </button>
      </div>
      <Show when={error.loading}>
        <p role="status">Loading identifiers...</p>
      </Show>
      <Show when={error()?.error}>
        <p role="alert">
          {error()?.error}{' '}
          <button type="button" onClick={() => void setError.refetch()}>
            Retry
          </button>
        </p>
      </Show>
      <Show
        when={
          !error.loading && !error()?.error && response()?.nodes.length === 0
        }
      >
        <p role="status">No observed identifiers match these filters.</p>
      </Show>
      <Show when={!error()?.error && response()}>
        {(page) => (
          <>
            <p>
              {page().total_device_count ?? 'Unknown'} observed identifiers
              match these filters; {page().nodes.length} shown.
            </p>
            <div class="report-table-scroll">
              <table class="report-table">
                <caption class="sr-only">
                  Observed MAC identifiers; one row per MAC
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      aria-sort={
                        inventoryFilters.sort === 'identifier'
                          ? 'ascending'
                          : 'none'
                      }
                    >
                      <button type="button" onClick={() => sort('identifier')}>
                        Identifier / name
                      </button>
                    </th>
                    <th scope="col">Registration</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Location</th>
                    <th scope="col">Known MACs</th>
                    <th scope="col">First observed</th>
                    <th
                      scope="col"
                      aria-sort={
                        inventoryFilters.sort !== 'identifier'
                          ? 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => sort('last_observed')}
                      >
                        Last observed
                      </button>
                    </th>
                    <th scope="col">Review state</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={page().nodes}>
                    {(node) => (
                      <tr>
                        <th scope="row">
                          <button
                            class="dedup-candidate-link"
                            type="button"
                            onClick={() => {
                              setSelectedInventoryNodeId(node.id);
                              setParams({ node: node.id });
                            }}
                          >
                            {node.display_name || node.mac || node.label}
                          </button>
                          <Show when={node.display_name}>
                            <small>{node.mac}</small>
                          </Show>
                          <DeviceSummaryLine node={node} />
                        </th>
                        <td>{registrationLabel(node)}</td>
                        <td>{node.owner_id || 'Unassigned'}</td>
                        <td>{node.location_id || 'Unknown'}</td>
                        <td>{aliasLabel(node)}</td>
                        <td>
                          {node.first_seen
                            ? formatDateTime(node.first_seen)
                            : 'Unknown'}
                        </td>
                        <td>
                          {node.last_seen
                            ? formatDateTime(node.last_seen)
                            : 'Unknown'}
                        </td>
                        <td>
                          {node.pending_review_count === undefined
                            ? 'Unknown'
                            : node.pending_review_count > 0
                              ? node.pending_review_count + ' pending pairs'
                              : 'No pending pairs'}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <nav class="report-toolbar" aria-label="Inventory pages">
              <button
                type="button"
                class="btn btn-secondary"
                disabled={error.loading || previous().length === 0}
                onClick={() => move()}
              >
                Previous page
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                disabled={error.loading || !page().next_page_cursor}
                onClick={() => move(page().next_page_cursor ?? undefined)}
              >
                Next page
              </button>
            </nav>
            <ReportStatus
              report={page().report}
              generatedAt={page().generated_at}
            />
          </>
        )}
      </Show>
    </section>
  );
}
