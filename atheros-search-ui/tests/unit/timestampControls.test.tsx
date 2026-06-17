import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcile } from 'solid-js/store';
import { FilterPanel } from '~/components/FilterPanel';
import { GraphControls } from '~/components/graph/GraphControls';
import { graphFilters, setGraphFilters } from '~/stores/graphStore';
import { filters, setFilters } from '~/stores/searchStore';
import { isRfc3339, rfc3339ToLocalInput } from '~/utils/timestamp';

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('timestamp filter controls', () => {
  beforeEach(() => installMatchMedia());

  afterEach(() => {
    cleanup();
    setFilters(reconcile({}));
    setGraphFilters(reconcile({ limit: 200 }));
  });

  it('stores search datetime-local input as RFC 3339', () => {
    const rawLocal = '2026-06-16T23:51';
    const { getByLabelText, getByRole } = render(() => (
      <FilterPanel
        open={true}
        onClose={() => undefined}
        returnFocus={() => undefined}
      />
    ));

    fireEvent.click(getByRole('button', { name: 'Time Window' }));
    fireEvent.input(getByLabelText(/After/), {
      target: { value: rawLocal },
    });

    expect(filters.observed_after).toBeDefined();
    expect(filters.observed_after).not.toBe(rawLocal);
    expect(isRfc3339(filters.observed_after!)).toBe(true);
    expect(rfc3339ToLocalInput(filters.observed_after)).toBe(rawLocal);
  });

  it('stores graph datetime-local input as RFC 3339', () => {
    const rawLocal = '2026-06-16T23:51';
    const { getByLabelText } = render(() => (
      <GraphControls onRefresh={() => undefined} onResetView={() => undefined} />
    ));

    fireEvent.input(getByLabelText('After'), {
      target: { value: rawLocal },
    });

    expect(graphFilters.observed_after).toBeDefined();
    expect(graphFilters.observed_after).not.toBe(rawLocal);
    expect(isRfc3339(graphFilters.observed_after!)).toBe(true);
    expect(rfc3339ToLocalInput(graphFilters.observed_after)).toBe(rawLocal);
  });

  it('keeps security flag masks inside the search API int32 contract', () => {
    const { getByLabelText, getByRole } = render(() => (
      <FilterPanel
        open={true}
        onClose={() => undefined}
        returnFocus={() => undefined}
      />
    ));

    fireEvent.click(getByRole('button', { name: 'Expert Options' }));
    const maskInput = getByLabelText(/Security flags bitmask/);

    fireEvent.input(maskInput, { target: { value: '4' } });
    expect(filters.security_flags_mask).toBe(4);

    fireEvent.input(maskInput, { target: { value: '1.5' } });
    expect(filters.security_flags_mask).toBeUndefined();
  });
});
