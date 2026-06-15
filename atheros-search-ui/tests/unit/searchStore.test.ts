import { afterEach, describe, expect, it } from 'vitest';
import { reconcile } from 'solid-js/store';
import {
  buildSearchRequest,
  isWildcardAllQuery,
  setFilters,
  setKind,
  setMinSimilarity,
  setMode,
  setQuery,
  setTopK,
} from '~/stores/searchStore';

function resetSearchStore() {
  setQuery('');
  setKind('SEARCH_KIND_EVENT');
  setMode('SEARCH_MODE_HYBRID');
  setTopK(20);
  setMinSimilarity(0);
  setFilters(reconcile({}));
}

describe('search store request construction', () => {
  afterEach(() => resetSearchStore());

  it('detects wildcard-only searches', () => {
    expect(isWildcardAllQuery('*')).toBe(true);
    expect(isWildcardAllQuery(' * % * ')).toBe(true);
    expect(isWildcardAllQuery('')).toBe(false);
    expect(isWildcardAllQuery('* probe_request')).toBe(false);
  });

  it('sends wildcard-only searches as sparse requests', () => {
    setQuery('*');
    setMode('SEARCH_MODE_HYBRID');

    expect(buildSearchRequest()).toMatchObject({
      query: '*',
      mode: 'SEARCH_MODE_SPARSE',
    });
  });

  it('promotes one source_macs value to source_mac for the API request', () => {
    setQuery('*');
    setFilters(reconcile({ source_macs: ['aa:bb:cc:dd:ee:ff'] }));

    expect(buildSearchRequest().filters).toMatchObject({
      source_mac: 'aa:bb:cc:dd:ee:ff',
    });
    expect(buildSearchRequest().filters?.source_macs).toBeUndefined();
  });

  it('keeps multiple source_macs values for cluster event searches', () => {
    setQuery('*');
    setFilters(
      reconcile({
        source_macs: ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66'],
        ssid: 'lab-net',
      }),
    );

    expect(buildSearchRequest().filters).toMatchObject({
      source_macs: ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66'],
      ssid: 'lab-net',
    });
    expect(buildSearchRequest().filters?.source_mac).toBeUndefined();
  });
});
