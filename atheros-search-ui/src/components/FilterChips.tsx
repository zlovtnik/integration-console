import { createMemo, For, Show } from 'solid-js';
import { X } from 'lucide-solid';
import { clearAllFilters, filters, setFilters } from '~/stores/searchStore';

type Chip = {
  id: string;
  label: string;
  remove: () => void;
};

export function FilterChips() {
  const chips = createMemo<Chip[]>(() => {
    const next: Chip[] = [];
    filters.location_ids?.forEach((value) =>
      next.push({ id: `loc-${value}`, label: `loc:${value}`, remove: () => setFilters('location_ids', (items = []) => items.filter((item) => item !== value)) }),
    );
    filters.sensor_ids?.forEach((value) =>
      next.push({ id: `sensor-${value}`, label: `sensor:${value}`, remove: () => setFilters('sensor_ids', (items = []) => items.filter((item) => item !== value)) }),
    );
    filters.frame_subtypes?.forEach((value) =>
      next.push({ id: `frame-${value}`, label: value, remove: () => setFilters('frame_subtypes', (items = []) => items.filter((item) => item !== value)) }),
    );
    filters.tags?.forEach((value) =>
      next.push({ id: `tag-${value}`, label: `tag:${value}`, remove: () => setFilters('tags', (items = []) => items.filter((item) => item !== value)) }),
    );
    if (filters.ssid) next.push({ id: 'ssid', label: `ssid:${filters.ssid}`, remove: () => setFilters('ssid', undefined) });
    if (filters.source_mac) next.push({ id: 'mac', label: filters.source_mac, remove: () => setFilters('source_mac', undefined) });
    if (filters.observed_after) next.push({ id: 'after', label: `after:${filters.observed_after}`, remove: () => setFilters('observed_after', undefined) });
    if (filters.observed_before) next.push({ id: 'before', label: `before:${filters.observed_before}`, remove: () => setFilters('observed_before', undefined) });
    if (filters.threat_only) next.push({ id: 'threat', label: 'threat', remove: () => setFilters('threat_only', undefined) });
    if (filters.handshake_only) next.push({ id: 'handshake', label: 'handshake', remove: () => setFilters('handshake_only', undefined) });
    if (typeof filters.security_flags_mask === 'number') next.push({ id: 'mask', label: `mask:${filters.security_flags_mask}`, remove: () => setFilters('security_flags_mask', undefined) });
    return next;
  });

  return (
    <Show when={chips().length > 0}>
      <div class="active-filters" role="group" aria-label="Active filters">
        <For each={chips()}>
          {(chip) => (
            <button type="button" class="filter-chip" onClick={chip.remove} aria-label={`Remove filter: ${chip.label}`}>
              <span>{chip.label}</span>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </For>
        <button type="button" class="clear-all" onClick={clearAllFilters}>
          Clear all
        </button>
      </div>
    </Show>
  );
}
