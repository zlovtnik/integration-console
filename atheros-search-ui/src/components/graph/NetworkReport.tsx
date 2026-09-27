import { A, useSearchParams } from '@solidjs/router';
import {
  createMemo,
  createResource,
  createSignal,
  createEffect,
  batch,
  on,
  For,
  Show,
  onCleanup,
} from 'solid-js';
import { api } from '~/api/client';
import type { NetworkFilters, GraphNode } from '~/api/types';
import { useForceGraph, edgeKindLabel } from '~/hooks/useForceGraph';
import { ReportStatus } from '~/components/ReportStatus';
import {
  asRfc3339,
  localInputToRfc3339,
  rfc3339ToLocalInput,
} from '~/utils/timestamp';
import { formatDateTime } from '~/utils/formatDateTime';
import { setGraphFilters } from '~/stores/graphStore';
import '~/styles/reports.css';

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
function list(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}
export function NetworkReport() {
  const [params, setParams] = useSearchParams();
  const filters = createMemo<NetworkFilters>(() => {
    const scope: NetworkFilters = { page_size: 50 };
    const loc = list(params.loc),
      sensor = list(params.sensor);
    if (loc.length) scope.location_ids = loc;
    if (sensor.length) scope.sensor_ids = sensor;
    const after = asRfc3339(one(params.after)),
      before = asRfc3339(one(params.before));
    if (after) scope.observed_after = after;
    if (before) scope.observed_before = before;
    if (one(params.ap)) scope.ap_bssid = one(params.ap);
    const macs = list(params.mac);
    if (macs.length) scope.source_macs = macs;
    if (one(params.q)) scope.query = one(params.q);
    if (one(params.ssid)) scope.ssid = one(params.ssid);
    if (one(params.hints) === '1') scope.include_hints = true;
    return scope;
  });
  const filterKey = createMemo(() => JSON.stringify(filters()));
  const currentCursor = () =>
    one(params.nf) === filterKey() ? one(params.page) : '';
  const previous = (): string[] => {
    try {
      const parsed: unknown =
        one(params.nf) === filterKey()
          ? JSON.parse(one(params.previous) || '[]')
          : [];
      return Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
        ? parsed
        : [];
    } catch {
      return [];
    }
  };
  let controller: AbortController | undefined;
  const [data, { refetch }] = createResource(
    () => ({ filters: filters(), cursor: currentCursor() }),
    async (request) => {
      controller?.abort();
      controller = new AbortController();
      try {
        const scope = { ...request.filters };
        if (request.cursor) scope.page_cursor = request.cursor;
        return {
          response: await api.network(scope, controller.signal),
          error: '',
        };
      } catch (error) {
        return {
          response: null,
          error:
            error instanceof Error && error.name === 'AbortError'
              ? ''
              : 'Network report unavailable. ' + (error as Error).message,
        };
      }
    },
  );
  let detailController: AbortController | undefined;
  const [detail, { refetch: retryDetail }] = createResource(
    () =>
      one(params.node).startsWith('device:')
        ? { id: one(params.node), scope: filters() }
        : false,
    async (request) => {
      detailController?.abort();
      detailController = new AbortController();
      const mac = request.id.slice('device:'.length);
      if (
        request.scope.source_macs?.length &&
        !request.scope.source_macs.some(
          (item) => item.toLowerCase() === mac.toLowerCase(),
        )
      ) {
        return {
          member: undefined,
          registry: undefined,
          registryUnavailable: false,
          error: 'Identifier is outside the selected MAC scope.',
        };
      }
      const scope = {
        ...request.scope,
        page_size: 1,
        source_macs: [mac],
        include_hints: false,
      };
      const [observations, registration] = await Promise.allSettled([
        api.network(scope, detailController.signal),
        api.inventory(
          {
            grouping: 'registry',
            scope: 'page',
            page_size: 1,
            source_macs: [mac],
          },
          detailController.signal,
        ),
      ]);
      if (detailController.signal.aborted)
        return {
          member: undefined,
          registry: undefined,
          registryUnavailable: false,
          error: '',
        };
      if (observations.status === 'rejected')
        return {
          member: undefined,
          registry: undefined,
          registryUnavailable: registration.status === 'rejected',
          error: 'Identifier evidence unavailable.',
        };
      return {
        member: observations.value.roster[0],
        registry:
          registration.status === 'fulfilled'
            ? registration.value.nodes[0]
            : undefined,
        registryUnavailable: registration.status === 'rejected',
        error:
          observations.value.roster.length === 0
            ? observations.value.focus_reason ||
              'No qualifying identifier evidence in the selected scope.'
            : '',
      };
    },
  );
  onCleanup(() => {
    controller?.abort();
    detailController?.abort();
  });
  const response = () => data()?.response;
  const [selected, setSelected] = createSignal<string | null>(null);
  let svg: SVGSVGElement | undefined;
  const graph = useForceGraph(
    () => svg,
    () => response()?.nodes ?? [],
    () => response()?.edges ?? [],
    {
      selectedNodeId: selected,
      onNodeClick: (node) => selectNode(node),
      onClearSelection: () => setSelected(null),
    },
  );
  function selectNode(node: GraphNode) {
    setSelected(node.id);
    if (node.mac && node.kind !== 'ap') setParams({ node: node.id });
  }
  createEffect(() => {
    response();
    queueMicrotask(() => graph.rebuild());
  });
  createEffect(
    on(filterKey, () => {
      const scope = filters();
      batch(() => {
        setGraphFilters('location_ids', scope.location_ids);
        setGraphFilters('sensor_ids', scope.sensor_ids);
        setGraphFilters('observed_after', scope.observed_after);
        setGraphFilters('observed_before', scope.observed_before);
      });
    }),
  );
  function change(key: string, value: string | undefined) {
    setParams({
      [key]: value,
      page: undefined,
      previous: undefined,
      nf: undefined,
      node: undefined,
    });
  }
  function page(next?: string) {
    const stack = previous();
    if (next)
      setParams({
        page: next,
        previous: JSON.stringify([...stack, currentCursor()]),
        nf: filterKey(),
      });
    else {
      const before = stack.pop();
      setParams({
        page: before || undefined,
        previous: JSON.stringify(stack),
        nf: filterKey(),
      });
    }
  }
  function evidenceHref(mac?: string) {
    const url = new URLSearchParams({
      q: '*',
      kind: 'SEARCH_KIND_EVENT',
      mode: 'SEARCH_MODE_SPARSE',
      context: '1',
      k: '200',
    });
    for (const loc of filters().location_ids ?? []) url.append('loc', loc);
    for (const sensor of filters().sensor_ids ?? [])
      url.append('sensor', sensor);
    if (filters().observed_after) url.set('after', filters().observed_after!);
    if (filters().observed_before)
      url.set('before', filters().observed_before!);
    if (filters().ap_bssid) url.set('bssid', filters().ap_bssid!);
    if (filters().ssid) url.set('ssid', filters().ssid!);
    if (filters().query) url.set('entity', filters().query!);
    for (const source of mac ? [mac] : (filters().source_macs ?? []))
      url.append('mac', source);
    return '/?' + url.toString();
  }
  return (
    <section class="network-report" aria-labelledby="network-title">
      <h1 class="heading-1" id="network-title">
        Network map
      </h1>
      <p>
        Observed AP context in retained searchable evidence. Identifiers may
        appear at several APs; observations do not establish a connection or
        exclusive membership.
      </p>
      <div class="report-control-grid">
        <label class="field">
          <span>Location</span>
          <input
            value={list(params.loc).join(', ')}
            onChange={(event) =>
              change('loc', event.currentTarget.value || undefined)
            }
          />
        </label>
        <label class="field">
          <span>Sensor</span>
          <input
            value={list(params.sensor).join(', ')}
            onChange={(event) =>
              change('sensor', event.currentTarget.value || undefined)
            }
          />
        </label>
        <label class="field">
          <span>Observed after</span>
          <input
            type="datetime-local"
            value={rfc3339ToLocalInput(filters().observed_after)}
            onChange={(event) =>
              change('after', localInputToRfc3339(event.currentTarget.value))
            }
          />
        </label>
        <label class="field">
          <span>Observed before</span>
          <input
            type="datetime-local"
            value={rfc3339ToLocalInput(filters().observed_before)}
            onChange={(event) =>
              change('before', localInputToRfc3339(event.currentTarget.value))
            }
          />
        </label>
        <label class="field">
          <span>Entity search</span>
          <input
            type="search"
            value={one(params.q)}
            onChange={(event) =>
              change('q', event.currentTarget.value || undefined)
            }
          />
        </label>
      </div>
      <div class="report-toolbar">
        <button
          class="btn btn-secondary"
          type="button"
          disabled={data.loading}
          onClick={() => void refetch()}
        >
          Refresh
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          onClick={() => change('ap', undefined)}
        >
          Clear focus
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          onClick={() =>
            setParams({
              loc: undefined,
              sensor: undefined,
              after: undefined,
              before: undefined,
              q: undefined,
              ap: undefined,
              mac: undefined,
              hints: undefined,
              page: undefined,
              nf: undefined,
              previous: undefined,
              node: undefined,
            })
          }
        >
          Reset filters
        </button>
        <label>
          <input
            type="checkbox"
            checked={filters().include_hints ?? false}
            onChange={(event) =>
              change('hints', event.currentTarget.checked ? '1' : undefined)
            }
          />{' '}
          Optional identity / RF hints
        </label>
      </div>
      <p class="report-scope">
        Applied scope: locations {list(params.loc).join(', ') || 'all'}, sensors{' '}
        {list(params.sensor).join(', ') || 'all'}, after{' '}
        {one(params.after) || 'retained start'}, before{' '}
        {one(params.before) || 'retained end'}, entity{' '}
        {one(params.q) || list(params.mac).join(', ') || 'all'}, SSID{' '}
        {one(params.ssid) || 'all'}, AP {one(params.ap) || 'overview'}.
      </p>
      <Show when={data.loading}>
        <p role="status">Loading network evidence...</p>
      </Show>
      <Show when={data()?.error}>
        <p role="alert">
          {data()?.error}{' '}
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      </Show>
      <Show when={!data()?.error && response()}>
        {(result) => (
          <>
            <Show when={result().focus_reason}>
              <p role="status">{result().focus_reason}</p>
            </Show>
            <Show
              when={!filters().ap_bssid}
              fallback={
                <>
                  <h2 class="heading-2">
                    Observed identifiers at {filters().ap_bssid}
                  </h2>
                  <p>
                    {result().total_rows} distinct identifiers;{' '}
                    {result().roster.length} shown. The map uses this roster
                    page.
                  </p>
                  <p>
                    Layout distance is for readability and does not represent
                    physical distance.
                  </p>
                  <div class="network-focus-canvas">
                    <svg
                      ref={svg}
                      class="graph-canvas"
                      aria-label="Observed AP context for this roster page"
                    />
                  </div>
                  <div class="report-table-scroll">
                    <table class="report-table">
                      <caption>
                        AP roster and evidence actions (text equivalent of the
                        map)
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Identifier</th>
                          <th scope="col">Last observed</th>
                          <th scope="col">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={result().roster}>
                          {(member) => (
                            <tr>
                              <th scope="row">
                                <button
                                  type="button"
                                  class="dedup-candidate-link"
                                  onClick={() =>
                                    setParams({ node: 'device:' + member.mac })
                                  }
                                >
                                  {member.name || member.mac}
                                </button>
                                <small>{member.mac}</small>
                              </th>
                              <td>{formatDateTime(member.last_observed)}</td>
                              <td>
                                {member.record_count} searchable records{' '}
                                <A href={evidenceHref(member.mac)}>
                                  Search evidence
                                </A>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                  <A class="btn btn-secondary" href={evidenceHref()}>
                    Search AP evidence
                  </A>
                  <Show when={filters().include_hints}>
                    <p>
                      Optional hints come from the latest graph projection and
                      cumulative evidence. They do not establish relationships
                      within this retained interval.
                    </p>
                    <ul>
                      <For
                        each={result().edges.filter(
                          (edge) => edge.kind !== 'association',
                        )}
                      >
                        {(edge) => (
                          <li>
                            {edge.source} / {edge.target}:{' '}
                            {edgeKindLabel(edge.kind)},{' '}
                            {edge.weight ?? 'unknown'}{' '}
                            {edge.weight_basis ?? 'basis unavailable'}
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </>
              }
            >
              <h2 class="heading-2">Access point overview</h2>
              <Show when={result().total_rows === 0}>
                <p role="status">
                  No qualifying AP evidence in this scope. Capture coverage is
                  unverified.
                </p>
              </Show>
              <div class="report-table-scroll">
                <table class="report-table">
                  <caption>
                    Access points ordered by distinct observed identifier count
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">AP name / BSSID</th>
                      <th scope="col">Observed identifiers</th>
                      <th scope="col">Last observed</th>
                      <th scope="col">Evidence / freshness</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={result().access_points}>
                      {(ap) => (
                        <tr>
                          <th scope="row">
                            <button
                              type="button"
                              class="dedup-candidate-link"
                              onClick={() => change('ap', ap.bssid)}
                            >
                              {ap.name || ap.bssid}
                            </button>
                            <small>{ap.bssid}</small>
                          </th>
                          <td>{ap.identifier_count}</td>
                          <td>{formatDateTime(ap.last_observed)}</td>
                          <td>{ap.evidence_status}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <nav class="report-toolbar" aria-label="Network report pages">
              <button
                class="btn btn-secondary"
                type="button"
                disabled={data.loading || previous().length === 0}
                onClick={() => page()}
              >
                Previous page
              </button>
              <button
                class="btn btn-secondary"
                type="button"
                disabled={data.loading || !result().next_page_cursor}
                onClick={() => page(result().next_page_cursor)}
              >
                Next page
              </button>
            </nav>
            <ReportStatus
              report={result().report}
              generatedAt={result().generated_at}
            />
          </>
        )}
      </Show>
      <Show when={detail.loading}>
        <p role="status">Loading identifier detail...</p>
      </Show>
      <Show when={detail()?.error}>
        <p role="alert">
          {detail()?.error}{' '}
          <button type="button" onClick={() => void retryDetail()}>
            Retry detail
          </button>
        </p>
      </Show>
      <Show when={!detail.loading && detail()?.member}>
        {(member) => (
          <aside
            class="graph-node-panel"
            role="complementary"
            aria-label="Identifier evidence"
          >
            <div class="graph-panel-heading">
              <h2 class="heading-2">{member().name || member().mac}</h2>
              <button
                type="button"
                class="icon-btn"
                aria-label="Close identifier detail"
                onClick={() => setParams({ node: undefined })}
              >
                Close
              </button>
            </div>
            <p>
              Observed AP context in this retained searchable scope; this is not
              proof of a connection or exclusive membership.
            </p>
            <dl class="graph-detail-list">
              <div>
                <dt>MAC identifier</dt>
                <dd>{member().mac}</dd>
              </div>
              <div>
                <dt>First observed in scope</dt>
                <dd>{formatDateTime(member().first_observed)}</dd>
              </div>
              <div>
                <dt>Last observed in scope</dt>
                <dd>{formatDateTime(member().last_observed)}</dd>
              </div>
              <div>
                <dt>Searchable records</dt>
                <dd>{member().record_count}</dd>
              </div>
              <div>
                <dt>Registration</dt>
                <dd>
                  {detail()?.registry?.registered === undefined
                    ? 'Unknown'
                    : detail()?.registry?.registered
                      ? 'Registered'
                      : 'Unregistered'}
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  {detail()?.registry
                    ? detail()?.registry?.owner_id || 'Unassigned'
                    : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {detail()?.registry
                    ? detail()?.registry?.location_id || 'Unknown'
                    : 'Unknown'}
                </dd>
              </div>
            </dl>
            <Show when={detail()?.registryUnavailable}>
              <p role="status">
                Registry detail unavailable; observation evidence is still
                shown.
              </p>
            </Show>
            <A class="btn btn-secondary" href={evidenceHref(member().mac)}>
              Search identifier evidence
            </A>
          </aside>
        )}
      </Show>
    </section>
  );
}
