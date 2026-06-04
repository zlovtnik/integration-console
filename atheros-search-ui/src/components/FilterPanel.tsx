import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { ChevronDown, X } from 'lucide-solid';
import {
  filters,
  minSimilarity,
  setFilters,
  setMinSimilarity,
  setTopK,
  topK,
} from '~/stores/searchStore';
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

function clampTopK(value: number): number {
  return Math.max(1, Math.min(200, Math.round(value)));
}

function FilterSection(props: {
  title: string;
  children: JSX.Element;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);

  return (
    <div class="filter-section">
      <button
        type="button"
        class="filter-section-toggle"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{props.title}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          class={open() ? 'chevron-up' : ''}
        />
      </button>
      <Show when={open()}>
        <div class="filter-section-body">{props.children}</div>
      </Show>
    </div>
  );
}

const DRAWER_MEDIA = '(max-width: 1119px)';
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function FilterPanel(props: {
  open: boolean;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const [topKInput, setTopKInput] = createSignal(String(topK()));
  const [isDrawer, setIsDrawer] = createSignal(false);
  let panelRef: HTMLElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let wasOpen = false;

  createEffect(() => {
    setTopKInput(String(topK()));
  });

  createEffect(() => {
    document.body.classList.toggle(
      'filter-drawer-open',
      props.open && isDrawer(),
    );
  });

  createEffect(() => {
    const open = props.open && isDrawer();

    if (open && !wasOpen) {
      queueMicrotask(() => {
        const firstField =
          panelRef?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        (closeButtonRef ?? firstField ?? panelRef)?.focus();
      });
    }

    if (!open && wasOpen) {
      props.returnFocus();
    }

    wasOpen = open;
  });

  onMount(() => {
    const media = window.matchMedia(DRAWER_MEDIA);
    const syncDrawer = () => setIsDrawer(media.matches);

    syncDrawer();
    media.addEventListener('change', syncDrawer);
    window.addEventListener('keydown', handleWindowKeyDown);

    onCleanup(() => {
      media.removeEventListener('change', syncDrawer);
      window.removeEventListener('keydown', handleWindowKeyDown);
    });
  });

  onCleanup(() => document.body.classList.remove('filter-drawer-open'));

  function handleTopKInput(value: string) {
    setTopKInput(value);
    const trimmed = value.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      setTopK(clampTopK(parsed));
    }
  }

  function resetTopKInput() {
    setTopKInput(String(topK()));
  }

  function focusableItems() {
    if (!panelRef) return [];

    return Array.from(
      panelRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hasAttribute('disabled'));
  }

  function trapFocus(event: KeyboardEvent) {
    const items = focusableItems();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    if (!panelRef?.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (!props.open || !isDrawer()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }

    if (event.key === 'Tab') trapFocus(event);
  }

  return (
    <>
      <Show when={props.open && isDrawer()}>
        <button
          type="button"
          class="drawer-scrim"
          aria-label="Close filter drawer"
          onClick={() => props.onClose()}
        />
      </Show>
      <aside
        ref={panelRef}
        id="filter-panel"
        role={isDrawer() ? 'dialog' : undefined}
        aria-modal={isDrawer() && props.open ? 'true' : undefined}
        aria-hidden={isDrawer() && !props.open ? 'true' : undefined}
        aria-labelledby="filter-panel-title"
        tabIndex={isDrawer() ? -1 : undefined}
        class={`filter-panel ${props.open ? 'filter-panel--open' : ''}`}
      >
        <div class="panel-heading">
          <h2 id="filter-panel-title" class="heading-2">
            Filters
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            class="icon-btn only-drawer"
            aria-label="Close filters"
            onClick={() => props.onClose()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div class="field-stack">
          <div class="filter-group filter-group--core">
            <label class="field">
              <span>
                Results to return
                <span class="field-hint">1-200</span>
              </span>
              <input
                type="number"
                min="1"
                max="200"
                value={topKInput()}
                onInput={(event) => handleTopKInput(event.currentTarget.value)}
                onBlur={resetTopKInput}
              />
            </label>

            <label class="field">
              <span>
                Minimum match score
                <span class="field-hint">{minSimilarity().toFixed(2)}</span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={minSimilarity()}
                onInput={(event) =>
                  setMinSimilarity(Number(event.currentTarget.value))
                }
              />
              <div class="range-labels">
                <span>Any</span>
                <span>Exact</span>
              </div>
            </label>
          </div>

          <FilterSection title="Device & Network" defaultOpen={true}>
            <label class="field">
              <span>SSID</span>
              <input
                value={filters.ssid ?? ''}
                list="ssid-suggestions"
                onInput={(event) =>
                  setFilters('ssid', event.currentTarget.value || undefined)
                }
              />
            </label>
            <datalist id="ssid-suggestions">
              <For each={suggestions.ssids}>
                {(item) => <option value={item} />}
              </For>
            </datalist>

            <label class="field">
              <span>Source MAC address</span>
              <input
                inputmode="text"
                placeholder="aa:bb:cc:dd:ee:ff"
                value={filters.source_mac ?? ''}
                onInput={(event) =>
                  setFilters(
                    'source_mac',
                    event.currentTarget.value || undefined,
                  )
                }
              />
            </label>

            <label class="field">
              <span>
                Location IDs
                <span class="field-hint">comma-separated</span>
              </span>
              <input
                value={joinList(filters.location_ids)}
                list="location-suggestions"
                onChange={(event) =>
                  setFilters(
                    'location_ids',
                    splitList(event.currentTarget.value),
                  )
                }
              />
            </label>
            <datalist id="location-suggestions">
              <For each={suggestions.location_ids}>
                {(item) => <option value={item} />}
              </For>
            </datalist>

            <label class="field">
              <span>
                Sensor IDs
                <span class="field-hint">comma-separated</span>
              </span>
              <input
                value={joinList(filters.sensor_ids)}
                list="sensor-suggestions"
                onChange={(event) =>
                  setFilters('sensor_ids', splitList(event.currentTarget.value))
                }
              />
            </label>
            <datalist id="sensor-suggestions">
              <For each={suggestions.sensor_ids}>
                {(item) => <option value={item} />}
              </For>
            </datalist>
          </FilterSection>

          <FilterSection title="Frame Types">
            <fieldset class="field">
              <legend class="sr-only">Frame subtypes</legend>
              <div class="check-grid">
                <For
                  each={
                    suggestions.frame_subtypes.length
                      ? suggestions.frame_subtypes
                      : [
                          'probe_request',
                          'deauthentication',
                          'association_request',
                        ]
                  }
                >
                  {(subtype) => (
                    <label class="check-row">
                      <input
                        type="checkbox"
                        checked={Boolean(
                          filters.frame_subtypes?.includes(subtype),
                        )}
                        onChange={(event) => {
                          const current = filters.frame_subtypes ?? [];
                          setFilters(
                            'frame_subtypes',
                            event.currentTarget.checked
                              ? [...current, subtype]
                              : splitList(
                                  current
                                    .filter((item) => item !== subtype)
                                    .join(','),
                                ),
                          );
                        }}
                      />
                      <span>{subtype.replace(/_/g, ' ')}</span>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          </FilterSection>

          <FilterSection title="Time Window">
            <label class="field">
              <span>
                After
                <span class="field-hint">local time</span>
              </span>
              <input
                type="datetime-local"
                value={filters.observed_after ?? ''}
                onInput={(event) =>
                  setFilters(
                    'observed_after',
                    event.currentTarget.value || undefined,
                  )
                }
              />
            </label>

            <label class="field">
              <span>
                Before
                <span class="field-hint">local time</span>
              </span>
              <input
                type="datetime-local"
                value={filters.observed_before ?? ''}
                onInput={(event) =>
                  setFilters(
                    'observed_before',
                    event.currentTarget.value || undefined,
                  )
                }
              />
            </label>
          </FilterSection>

          <FilterSection title="Threat Filters">
            <label class="switch-row">
              <input
                type="checkbox"
                checked={Boolean(filters.threat_only)}
                onChange={(event) =>
                  setFilters(
                    'threat_only',
                    event.currentTarget.checked || undefined,
                  )
                }
              />
              <span>Threats only</span>
            </label>

            <label class="switch-row">
              <input
                type="checkbox"
                checked={Boolean(filters.handshake_only)}
                onChange={(event) =>
                  setFilters(
                    'handshake_only',
                    event.currentTarget.checked || undefined,
                  )
                }
              />
              <span>Handshakes only</span>
            </label>

            <label class="field">
              <span>
                Tags
                <span class="field-hint">comma-separated</span>
              </span>
              <input
                value={joinList(filters.tags)}
                onChange={(event) =>
                  setFilters('tags', splitList(event.currentTarget.value))
                }
              />
            </label>
          </FilterSection>

          <FilterSection title="Expert Options">
            <label class="field">
              <span>
                Security flags bitmask
                <span class="field-hint">802.11 capability flags</span>
              </span>
              <input
                type="number"
                min="0"
                value={filters.security_flags_mask ?? ''}
                onInput={(event) =>
                  setFilters(
                    'security_flags_mask',
                    event.currentTarget.value
                      ? Number(event.currentTarget.value)
                      : undefined,
                  )
                }
              />
            </label>
          </FilterSection>
        </div>
      </aside>
    </>
  );
}
