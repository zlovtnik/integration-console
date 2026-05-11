<script>
  import { onMount } from "svelte"
  import DataGrid from "../components/DataGrid.svelte"
  import GridToolbar from "../components/GridToolbar.svelte"
  import ThemeSwitcher from "../components/ThemeSwitcher.svelte"
  import MacChip from "../components/MacChip.svelte"
  import { columnsToFilterFields } from "../lib/grid"
  import { paramsFromLocation, serializeFilters, toQueryString, updateHistory } from "../lib/url"

  export let initial = {}

  let rows = initial.rows || []
  let totalCount = initial.totalCount || 0
  let currentPage = initial.currentPage || 1
  let perPage = initial.perPage || 50
  let sortKey = initial.sortKey || "last_seen"
  let sortDirection = initial.sortDirection || "desc"
  let query = initial.query || ""
  let filters = initial.filters || []
  let loading = false
  let loadError = ""

  const endpoints = initial.endpoints || {}
  let expandedFingerprint = ""

  const columns = [
    {
      key: "device_fingerprint",
      label: "Fingerprint",
      size: "lg",
      sortable: true,
      componentProps: (value) => ({ maxLen: 24 })
    },
    { key: "source_count", label: "Sources", size: "sm", sortable: true },
    { key: "source_macs", label: "Source MACs", shortLabel: "MACs", size: "xl", sortable: false },
    { key: "ssids", label: "SSIDs", size: "xl", sortable: false },
    { key: "location_ids", label: "Locations", shortLabel: "Locs", size: "md", sortable: false },
    { key: "first_seen", label: "First Seen", size: "md", sortable: true },
    { key: "last_seen", label: "Last Seen", size: "md", sortable: true }
  ]
  const filterFields = columnsToFilterFields(columns)

  $: exportUrl = buildExportUrl(query, filters, sortKey, sortDirection, currentPage, perPage)

  onMount(() => {
    const next = paramsFromLocation({ q: query, filters, sort: sortKey, direction: sortDirection, page: currentPage, per_page: perPage })
    query = next.q
    filters = next.filters || []
    sortKey = next.sort || "last_seen"
    sortDirection = next.direction || "desc"
    currentPage = next.page
    perPage = next.per_page

    window.addEventListener("popstate", handlePopState)
    fetchPage(false)

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  })

  function state() {
    return {
      q: query,
      filters: serializeFilters(filters) || undefined,
      sort: sortKey,
      direction: sortDirection,
      page: currentPage,
      per_page: perPage
    }
  }

  function handleSort(key) {
    sortDirection = sortKey === key && sortDirection === "asc" ? "desc" : "asc"
    sortKey = key
    currentPage = 1
    expandedFingerprint = ""
    fetchPage(true)
  }

  function handlePageChange(page) {
    currentPage = page
    expandedFingerprint = ""
    fetchPage(true)
  }

  function handleSearch(params) {
    query = params.q || ""
    currentPage = 1
    expandedFingerprint = ""
    fetchPage(true)
  }

  function handleFiltersChange(nextFilters) {
    filters = nextFilters
    currentPage = 1
    expandedFingerprint = ""
    fetchPage(true)
  }

  function handleClearAll() {
    query = ""
    filters = []
    currentPage = 1
    expandedFingerprint = ""
    fetchPage(true)
  }

  function handlePopState() {
    const next = paramsFromLocation({ q: query, filters, sort: sortKey, direction: sortDirection, page: currentPage, per_page: perPage })
    query = next.q
    filters = next.filters || []
    sortKey = next.sort || "last_seen"
    sortDirection = next.direction || "desc"
    currentPage = next.page
    perPage = next.per_page
    fetchPage(false)
  }

  function toggleExpand(fp) {
    expandedFingerprint = expandedFingerprint === fp ? "" : fp
  }

  function auditLogsUrl(fp) {
    if (!endpoints.audit_logs) return "#"
    return `${endpoints.audit_logs}?q=${encodeURIComponent(fp)}`
  }

  function joinedList(arr) {
    if (!arr || arr.length === 0) return ""
    if (arr.length <= 3) return arr.join(", ")
    return `${arr.slice(0, 3).join(", ")} +${arr.length - 3} more`
  }

  let activeFetchId = 0

  async function fetchPage(push) {
    const requestId = ++activeFetchId
    loading = true

    const url = `${endpoints.index}.json?${toQueryString(state())}`
    const response = await fetch(url, { headers: { accept: "application/json" } }).catch((err) => {
      if (requestId === activeFetchId) {
        loadError = `Network error: ${err?.message || "request failed"}`
        loading = false
      }
      return null
    })

    if (requestId !== activeFetchId) return
    if (response?.status === 304) {
      loading = false
      return
    }
    if (!response?.ok) {
      loadError = await errorMessage(response)
      loading = false
      return
    }

    const payload = await response.json()
    if (requestId !== activeFetchId) return

    rows = payload.rows || []
    filters = payload.filters || filters
    totalCount = payload.totalCount || 0
    currentPage = payload.currentPage || currentPage
    perPage = payload.perPage || perPage
    sortKey = payload.sortKey || sortKey
    sortDirection = payload.sortDirection || sortDirection
    loadError = ""

    if (push) updateHistory(endpoints.index, state())
    loading = false
  }

  function buildExportUrl(q, filters, sort, direction, page, per_page) {
    if (!endpoints.export) return null
    return `${endpoints.export}?${toQueryString({
      q,
      filters: serializeFilters(filters) || undefined,
      sort,
      direction,
      page,
      per_page,
    })}`
  }

  async function errorMessage(response) {
    try {
      const json = await response.json()
      return json.error || `HTTP ${response.status}`
    } catch {
      return `HTTP ${response.status}`
    }
  }

  function shortFP(fp) {
    if (!fp) return ""
    return fp.length > 30 ? fp.substring(0, 30) + "…" : fp
  }
</script>

<section class="section-spaced">
  <div class="flex items-center justify-between gap-3 mb-4">
    <h2>Fingerprint Sources</h2>
    <ThemeSwitcher />
  </div>
  <GridToolbar
    {query}
    fields={filterFields}
    searchable={true}
    placeholder="Search fingerprint, MAC, SSID, BSSID, location, sensor"
    onSearch={handleSearch}
    onFiltersChange={handleFiltersChange}
    onClearAll={handleClearAll}
    {exportUrl}
  />

  <div class="data-grid-wrap">
    <div class="data-grid-wrap__scroll relative">
      <table class="data-grid">
        <thead>
          <tr>
            {#each columns as column}
              <th class="data-grid__header w-32 min-w-32 {column.size === 'xl' ? 'w-56 min-w-56' : ''} {column.size === 'lg' ? 'w-40 min-w-40' : ''}" scope="col" aria-sort={sortKey === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}>
                {#if column.sortable}
                  <button
                    type="button"
                    class={sortKey === column.key ? "data-grid__sort data-grid__sort--active" : "data-grid__sort"}
                    onclick={() => handleSort(column.key)}
                  >
                    <span class="data-grid__header-label">{column.shortLabel || column.label}</span>
                    {#if sortKey === column.key}
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    {/if}
                  </button>
                {:else}
                  <span class="data-grid__header-label">{column.shortLabel || column.label}</span>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody class={loading ? "opacity-60" : ""}>
          {#each rows as row (row.device_fingerprint)}
            <tr
              class="cursor-pointer hover:bg-(--color-accent-surface)"
              onclick={() => toggleExpand(row.device_fingerprint)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(row.device_fingerprint) } }}
            >
              <td class="data-grid__cell w-40 min-w-40">
                <span class="data-grid__cell-value" title={row.device_fingerprint}>{shortFP(row.device_fingerprint)}</span>
              </td>
              <td class="data-grid__cell w-24 min-w-24">
                <span class="data-grid__cell-value">{row.source_count}</span>
              </td>
              <td class="data-grid__cell w-56 min-w-56">
                <span class="data-grid__cell-value text-xs" title={(row.source_macs || []).join(", ")}>{joinedList(row.source_macs)}</span>
              </td>
              <td class="data-grid__cell w-56 min-w-56">
                <span class="data-grid__cell-value text-xs" title={(row.ssids || []).join(", ")}>{joinedList(row.ssids)}</span>
              </td>
              <td class="data-grid__cell w-32 min-w-32">
                <span class="data-grid__cell-value" title={(row.location_ids || []).join(", ")}>{joinedList(row.location_ids)}</span>
              </td>
              <td class="data-grid__cell w-32 min-w-32">
                <span class="data-grid__cell-value">{row.first_seen}</span>
              </td>
              <td class="data-grid__cell w-32 min-w-32">
                <span class="data-grid__cell-value">{row.last_seen}</span>
              </td>
            </tr>
            {#if expandedFingerprint === row.device_fingerprint}
              <tr class="bg-(--color-surface-raised)">
                <td colspan="7" class="p-4">
                  <div class="fingerprint-detail">
                    <div class="mb-3">
                      <strong>Fingerprint:</strong>
                      <code class="ml-2 text-sm break-all">{row.device_fingerprint}</code>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                      {#if (row.source_macs || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">Source MACs ({row.source_macs.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.source_macs as mac}
                              <li>
                                <MacChip value={mac} mac={mac} display={mac} masked={false} />
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if (row.ssids || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">SSIDs ({row.ssids.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.ssids as ssid}
                              <li>{ssid || "(hidden)"}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if (row.bssids || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">BSSIDs ({row.bssids.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.bssids as bssid}
                              <li>{bssid}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if (row.destination_bssids || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">Destination BSSIDs ({row.destination_bssids.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.destination_bssids as bssid}
                              <li>{bssid}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if (row.location_ids || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">Locations ({row.location_ids.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.location_ids as loc}
                              <li>{loc}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}

                      {#if (row.sensor_ids || []).length > 0}
                        <div>
                          <h4 class="text-sm font-semibold mb-1">Sensors ({row.sensor_ids.length})</h4>
                          <ul class="list-disc list-inside text-sm text-(--color-text-secondary) space-y-0.5">
                            {#each row.sensor_ids as sensor}
                              <li>{sensor}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}
                    </div>

                    <div class="flex gap-2">
                      <a
                        href={auditLogsUrl(row.device_fingerprint)}
                        class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded bg-(--color-accent-vivid) text-white no-underline hover:opacity-90"
                      >
                        View in Audit Logs →
                      </a>
                      <button
                        type="button"
                        class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded border border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-accent-surface)"
                        onclick={() => toggleExpand(row.device_fingerprint)}
                      >
                        Collapse
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {:else}
            <tr>
              <td class="data-grid__empty" colspan="7">
                No fingerprint sources found.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if loading}
        <div class="pointer-events-none absolute inset-x-0 top-10 bottom-12 overflow-hidden bg-(--color-surface-scrim)" aria-hidden="true">
          <div class="skeleton-shimmer h-full"></div>
        </div>
      {/if}

      <div class="data-grid__pagination">
        <button
          type="button"
          class="data-grid__page-button"
          disabled={currentPage <= 1 || loading}
          aria-label="Previous page"
          onclick={() => handlePageChange(currentPage - 1)}
        >
          Prev
        </button>
        <span class="font-semibold">
          Page {currentPage} of {Math.max(Math.ceil(Number(totalCount || 0) / Number(perPage || 1)), 1)}
        </span>
        <button
          type="button"
          class="data-grid__page-button"
          disabled={currentPage >= Math.max(Math.ceil(Number(totalCount || 0) / Number(perPage || 1)), 1) || loading}
          aria-label="Next page"
          onclick={() => handlePageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  </div>

  {#if loadError}
    <div class="notification is-danger">
      <p><strong>Error loading fingerprint sources:</strong> {loadError}</p>
    </div>
  {/if}
</section>

<style>
  .fingerprint-detail {
    max-width: 100%;
  }
  .fingerprint-detail ul {
    margin: 0;
    padding-left: 1.25rem;
  }
</style>