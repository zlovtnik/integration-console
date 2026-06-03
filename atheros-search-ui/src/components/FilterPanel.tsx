import { For, Show } from 'solid-js';
import { X } from 'lucide-solid';
import { filters, minSimilarity, setFilters, setMinSimilarity, setTopK, topK } from '~/stores/searchStore';
import { suggestions } from '~/stores/suggestStore';

function splitList(value: string): string[] | undefined {
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function joinList(value: string[] | undefined): string {
  return value?.join(', ') ?? '';
}

export function FilterPanel(props: { open: boolean; onClose: () => void }) {
  return (
    <>
      <Show when={props.open}>
        <button
          type="button"
          class="drawer-scrim"
          aria-label="Close filters"
          onClick={() => props.onClose()}
        />
      </Show>
      <aside
        id="filter-panel"
        aria-label="Search filters"
        class={`filter-panel ${props.open ? 'filter-panel--open' : ''}`}
        role={props.open ? 'dialog' : undefined}
        aria-modal={props.open ? 'true' : undefined}
      >
        <div class="panel-heading">
          <h2 class="heading-2">Filters</h2>
          <button type="button" class="icon-btn only-mobile" aria-label="Close filters" onClick={() => props.onClose()}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div class="field-stack">
          <label class="field">
            <span>Top K</span>
            <input
              type="number"
              min="1"
              max="200"
              value={topK()}
              onInput={(event) => setTopK(Math.max(1, Number(event.currentTarget.value)))}
            />
          </label>

          <label class="field">
            <span>Minimum similarity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={minSimilarity()}
              onInput={(event) => setMinSimilarity(Number(event.currentTarget.value))}
            />
            <span class="mono caption">{minSimilarity().toFixed(2)}</span>
          </label>

          <label class="field">
            <span>Location IDs</span>
            <input
              value={joinList(filters.location_ids)}
              list="location-suggestions"
              onInput={(event) => setFilters('location_ids', splitList(event.currentTarget.value))}
            />
          </label>
          <datalist id="location-suggestions">
            <For each={suggestions.location_ids}>{(item) => <option value={item} />}</For>
          </datalist>

          <label class="field">
            <span>Sensor IDs</span>
            <input
              value={joinList(filters.sensor_ids)}
              list="sensor-suggestions"
              onInput={(event) => setFilters('sensor_ids', splitList(event.currentTarget.value))}
            />
          </label>
          <datalist id="sensor-suggestions">
            <For each={suggestions.sensor_ids}>{(item) => <option value={item} />}</For>
          </datalist>

          <label class="field">
            <span>SSID</span>
            <input
              value={filters.ssid ?? ''}
              list="ssid-suggestions"
              onInput={(event) => setFilters('ssid', event.currentTarget.value || undefined)}
            />
          </label>
          <datalist id="ssid-suggestions">
            <For each={suggestions.ssids}>{(item) => <option value={item} />}</For>
          </datalist>

          <label class="field">
            <span>Source MAC</span>
            <input
              inputmode="text"
              placeholder="aa:bb:cc:dd:ee:ff"
              value={filters.source_mac ?? ''}
              onInput={(event) => setFilters('source_mac', event.currentTarget.value || undefined)}
            />
          </label>

          <fieldset class="field">
            <legend>Frame subtypes</legend>
            <div class="check-grid">
              <For each={suggestions.frame_subtypes.length ? suggestions.frame_subtypes : ['probe_request', 'deauthentication', 'association_request']}>
                {(subtype) => (
                  <label class="check-row">
                    <input
                      type="checkbox"
                      checked={filters.frame_subtypes?.includes(subtype)}
                      onChange={(event) => {
                        const current = filters.frame_subtypes ?? [];
                        setFilters(
                          'frame_subtypes',
                          event.currentTarget.checked
                            ? [...current, subtype]
                            : current.filter((item) => item !== subtype),
                        );
                      }}
                    />
                    <span>{subtype}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>

          <label class="field">
            <span>Observed after</span>
            <input
              type="datetime-local"
              value={filters.observed_after ?? ''}
              onInput={(event) => setFilters('observed_after', event.currentTarget.value || undefined)}
            />
          </label>

          <label class="field">
            <span>Observed before</span>
            <input
              type="datetime-local"
              value={filters.observed_before ?? ''}
              onInput={(event) => setFilters('observed_before', event.currentTarget.value || undefined)}
            />
          </label>

          <label class="switch-row">
            <input
              type="checkbox"
              checked={Boolean(filters.threat_only)}
              onChange={(event) => setFilters('threat_only', event.currentTarget.checked || undefined)}
            />
            <span>Threat only</span>
          </label>

          <label class="switch-row">
            <input
              type="checkbox"
              checked={Boolean(filters.handshake_only)}
              onChange={(event) => setFilters('handshake_only', event.currentTarget.checked || undefined)}
            />
            <span>Handshake only</span>
          </label>

          <label class="field">
            <span>Security flags mask</span>
            <input
              type="number"
              min="0"
              value={filters.security_flags_mask ?? ''}
              onInput={(event) =>
                setFilters(
                  'security_flags_mask',
                  event.currentTarget.value ? Number(event.currentTarget.value) : undefined,
                )
              }
            />
          </label>

          <label class="field">
            <span>Tags</span>
            <input
              value={joinList(filters.tags)}
              onInput={(event) => setFilters('tags', splitList(event.currentTarget.value))}
            />
          </label>
        </div>
      </aside>
    </>
  );
}
