import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditGeneration,
  clearAuditState,
  setAuditIdentity,
} from '~/auth/auditState';
import { api, authenticatedFetch } from '~/api/client';
import { fetchSuggestions } from '~/hooks/useSuggest';
import { suggestions, setSuggestions } from '~/stores/suggestStore';
import { history, pushHistory } from '~/stores/searchStore';

vi.mock('~/auth/session', () => ({
  getAccessToken: vi.fn(async () => 'token'),
  denyAuditAccess: () => clearAuditState(),
}));

describe('audit identity isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    setAuditIdentity('A');
  });

  it('drops a late suggestion response from the previous identity', async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.suggestFilters>>,
    ) => void;
    vi.spyOn(api, 'suggestFilters').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const request = fetchSuggestions();
    setAuditIdentity('B');
    resolve({
      ssids: ['A-private'],
      location_ids: [],
      sensor_ids: [],
      frame_subtypes: [],
    });
    expect(await request).toBe(false);
    expect(suggestions.ssids).toEqual([]);
    expect(
      window.sessionStorage.getItem('atheros-search.suggestions'),
    ).toBeNull();
  });

  it('clears cached identifiers on API authorization failure', async () => {
    pushHistory('A-private');
    setSuggestions({ ssids: ['A-private'] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 403 }),
    );
    expect((await authenticatedFetch('/v1/suggest')).status).toBe(403);
    expect(history()).toEqual([]);
    expect(suggestions.ssids).toEqual([]);
  });

  it('rejects old in-flight fetches even when a transport ignores abort', async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const request = authenticatedFetch('/v1/suggest');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    clearAuditState();
    resolve(new Response('{}'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clears stale storage when another tab changes identity', () => {
    pushHistory('A-private');
    const generation = auditGeneration();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'atheros-search.audit-identity',
        newValue: 'B',
      }),
    );
    expect(history()).toEqual([]);
    expect(auditGeneration()).toBeGreaterThan(generation);
  });
});
