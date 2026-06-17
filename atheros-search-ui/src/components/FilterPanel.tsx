import {
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
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
import { fetchSuggestions } from '~/hooks/useSuggest';
import { suggestLoaded, suggestions } from '~/stores/suggestStore';
import { debounce } from '~/utils/debounce';
import {
  compareRfc3339,
  localInputToRfc3339,
  rfc3339ToLocalInput,
} from '~/utils/timestamp';

const MAX_SECURITY_FLAGS_MASK = 2_147_483_647;

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

function parseSecurityFlagsMask(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_SECURITY_FLAGS_MASK
  ) {
    return undefined;
  }
  return parsed;
}

function FilterSection(props: {
  title: string;
  children: JSX.Element;
  defaultOpen?: boolean;
}) {
  const resolvedChildren = children(() => props.children);
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
        <div class="filter-section-body">{resolvedChildren()}</div>
      </Show>
    </div>
  );
}

const DRAWER_MEDIA = '(max-width: 1119px)';
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const SECURITY_FLAG_OPTIONS = [
  { label: 'WPA', value: 1 },
  { label: 'WPA2 / RSN', value: 2 },
  { label: 'WPA3', value: 4 },
  { label: 'WPS', value: 8 },
  { label: 'PMF required', value: 16 },
  { label: 'PMF capable', value: 32 },
];

export function FilterPanel(props: {
  open: boolean;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const [topKDraft, setTopKDraft] = createSignal<string | null>(null);
  const topKInput = () => topKDraft() ?? String(topK());
  const [isDrawer, setIsDrawer] = createSignal(false);
  const drawerOpen = createMemo(() => props.open && isDrawer());
  const dateRangeError = createMemo(() => {
    if (!filters.observed_after || !filters.observed_before) return '';
    return compareRfc3339(filters.observed_after, filters.observed_before) > 0
      ? 'After must be earlier than before.'
      : '';
  });
  const currentLocalMax = createMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const observedAfterInput = createMemo(() =>
    rfc3339ToLocalInput(filters.observed_after),
  );
  const observedBeforeInput = createMemo(() =>
    rfc3339ToLocalInput(filters.observed_before),
  );
  const observedAfterMax = createMemo(() => {
    const before = observedBeforeInput();
    if (!before) return currentLocalMax();
    return before < currentLocalMax() ? before : currentLocalMax();
  });
  const requestSuggestions = debounce((prefix: string) => {
    void fetchSuggestions(prefix.trim());
  }, 250);
  let panelRef: HTMLElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let wasOpen = false;

  createEffect(
    on(drawerOpen, (open) => {
      document.body.classList.toggle('filter-drawer-open', open);
    }),
  );

  createEffect(
    on(drawerOpen, (open) => {
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
    }),
  );

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
    setTopKDraft(value);
    const trimmed = value.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      setTopK(clampTopK(parsed));
    }
  }

  function resetTopKInput() {
    setTopKDraft(null);
  }

  function setSecurityFlag(flag: number, enabled: boolean) {
    const current = filters.security_flags_mask ?? 0;
    const next = enabled ? current | flag : current & ~flag;
    setFilters('security_flags_mask', next > 0 ? next : undefined);
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
          <Show when={!suggestLoaded()}>
            <p class="filter-note">Suggestions unavailable.</p>
          </Show>

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
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setFilters('ssid', value || undefined);
                  requestSuggestions(value);
                }}
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
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setFilters('source_mac', value || undefined);
                  requestSuggestions(value);
                }}
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
                onInput={(event) =>
                  requestSuggestions(event.currentTarget.value)
                }
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
                onInput={(event) =>
                  requestSuggestions(event.currentTarget.value)
                }
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
                value={observedAfterInput()}
                max={observedAfterMax()}
                aria-invalid={Boolean(dateRangeError()) || undefined}
                onInput={(event) =>
                  setFilters(
                    'observed_after',
                    localInputToRfc3339(event.currentTarget.value),
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
                value={observedBeforeInput()}
                min={observedAfterInput() || undefined}
                max={currentLocalMax()}
                aria-invalid={Boolean(dateRangeError()) || undefined}
                onInput={(event) =>
                  setFilters(
                    'observed_before',
                    localInputToRfc3339(event.currentTarget.value),
                  )
                }
              />
            </label>
            <Show when={dateRangeError()}>
              <p class="field-error" role="alert">
                {dateRangeError()}
              </p>
            </Show>
          </FilterSection>

          <FilterSection title="Threat Signals">
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
                max={MAX_SECURITY_FLAGS_MASK}
                step="1"
                value={filters.security_flags_mask ?? ''}
                onInput={(event) =>
                  setFilters(
                    'security_flags_mask',
                    parseSecurityFlagsMask(event.currentTarget.value),
                  )
                }
              />
            </label>

            <details class="flag-disclosure">
              <summary>Named flags</summary>
              <div class="check-grid">
                <For each={SECURITY_FLAG_OPTIONS}>
                  {(option) => (
                    <label class="check-row">
                      <input
                        type="checkbox"
                        checked={Boolean(
                          (filters.security_flags_mask ?? 0) & option.value,
                        )}
                        onChange={(event) =>
                          setSecurityFlag(
                            option.value,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  )}
                </For>
              </div>
            </details>
          </FilterSection>
        </div>
      </aside>
    </>
  );
}
