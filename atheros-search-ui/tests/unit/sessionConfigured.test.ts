import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeReturnPath } from '~/auth/returnPath';
import { createComponent } from 'solid-js';
import { render } from '@solidjs/testing-library';

const keycloakClient = vi.hoisted(() => ({
  authenticated: false,
  init: vi.fn<() => Promise<boolean>>(),
  login: vi.fn<() => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
  updateToken: vi.fn<() => Promise<boolean>>(),
  token: undefined as string | undefined,
  tokenParsed: undefined as
    | {
        iss: string;
        sub: string;
        resource_access?: Record<string, { roles: string[] }>;
      }
    | undefined,
  onAuthSuccess: undefined as (() => void) | undefined,
  onAuthRefreshSuccess: undefined as (() => void) | undefined,
  onAuthLogout: undefined as (() => void) | undefined,
  onAuthRefreshError: undefined as (() => void) | undefined,
  onTokenExpired: undefined as (() => void) | undefined,
}));

vi.mock('keycloak-js', () => ({
  default: vi.fn(() => keycloakClient),
}));

vi.mock('~/env', () => ({
  env: {
    apiBase: '',
    appTitle: 'atheros search',
    keycloakUrl: 'https://identity.example',
    keycloakRealm: 'middleware',
    keycloakClientId: 'atheros-search',
  },
}));

describe('configured authentication session', () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/inventory?view=dedup_queue');
    keycloakClient.authenticated = false;
    keycloakClient.tokenParsed = undefined;
    keycloakClient.init.mockReset().mockResolvedValue(false);
    keycloakClient.login.mockReset().mockResolvedValue();
  });

  it('removes locally retained audit details when API access is denied', async () => {
    const { initAuth, denyAuditAccess, authStatus } =
      await import('~/auth/session');
    const { AuthGate } = await import('~/components/AuthGate');
    await initAuth();
    keycloakClient.tokenParsed = { iss: 'realm', sub: 'A' };
    keycloakClient.onAuthSuccess?.();
    function RetainedDetails() {
      const data = `${keycloakClient.tokenParsed?.sub}-private-audit-details`;
      return data;
    }
    const view = render(() =>
      createComponent(AuthGate, {
        get children() {
          return createComponent(RetainedDetails, {});
        },
      }),
    );
    expect(view.container.textContent).toContain('A-private-audit-details');
    keycloakClient.tokenParsed = { iss: 'realm', sub: 'B' };
    keycloakClient.onAuthSuccess?.();
    expect(view.container.textContent).not.toContain('A-private-audit-details');
    expect(view.container.textContent).toContain('B-private-audit-details');
    denyAuditAccess();
    expect(authStatus()).toBe('error');
    expect(view.container.textContent).not.toContain('A-private-audit-details');
    expect(view.container.textContent).not.toContain('B-private-audit-details');
    view.unmount();
  });

  it('does not return a refreshed token after the identity has been cleared', async () => {
    const { initAuth, getAccessToken } = await import('~/auth/session');
    await initAuth();
    keycloakClient.authenticated = true;
    keycloakClient.tokenParsed = { iss: 'realm', sub: 'A' };
    keycloakClient.onAuthSuccess?.();
    let finish!: (value: boolean) => void;
    keycloakClient.updateToken.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const token = getAccessToken();
    await vi.waitFor(() =>
      expect(keycloakClient.updateToken).toHaveBeenCalled(),
    );
    keycloakClient.onAuthLogout?.();
    keycloakClient.token = 'old-A-token';
    finish(true);
    await expect(token).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clears audit persistence and stores when identity or authorization changes', async () => {
    const { initAuth, logout } = await import('~/auth/session');
    const search = await import('~/stores/searchStore');
    const suggest = await import('~/stores/suggestStore');
    const graph = await import('~/stores/graphStore');
    const { auditGeneration } = await import('~/auth/auditState');
    await initAuth();
    keycloakClient.tokenParsed = { iss: 'realm', sub: 'A' };
    keycloakClient.onAuthSuccess?.();
    search.pushHistory('private-ssid');
    suggest.setSuggestions({ ssids: ['private-ssid'] });
    graph.setGraphFilters({ ssid: 'private-ssid' });
    graph.saveCurrentGraphView('private-view');
    window.sessionStorage.setItem(
      'atheros-search.suggestions',
      JSON.stringify({ ssids: ['private-ssid'] }),
    );
    const generation = auditGeneration();
    // Same-identity token refresh preserves legitimate caches.
    keycloakClient.onAuthRefreshSuccess?.();
    expect(search.history()).toEqual(['private-ssid']);
    expect(auditGeneration()).toBe(generation);
    keycloakClient.tokenParsed = { iss: 'realm', sub: 'B' };
    keycloakClient.onAuthSuccess?.();
    expect(search.history()).toEqual([]);
    expect(suggest.suggestions.ssids).toEqual([]);
    expect(graph.loadGraphSavedViews()).toEqual([]);
    expect(
      window.sessionStorage.getItem('atheros-search.suggestions'),
    ).toBeNull();
    search.pushHistory('B-private');
    keycloakClient.tokenParsed.resource_access = { search: { roles: [] } };
    keycloakClient.onAuthRefreshSuccess?.();
    expect(search.history()).toEqual([]);
    search.pushHistory('B-private');
    keycloakClient.onAuthRefreshError?.();
    expect(search.history()).toEqual([]);
    search.pushHistory('logout-private');
    keycloakClient.logout.mockResolvedValue();
    await logout();
    expect(search.history()).toEqual([]);
  });

  it('captures destinations for passive initialization and interactive login', async () => {
    const { callbackUri, initAuth, login } = await import('~/auth/session');

    await initAuth();
    expect(keycloakClient.init).toHaveBeenCalledWith(
      expect.objectContaining({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        redirectUri: callbackUri(),
      }),
    );
    expect(consumeReturnPath()).toEqual({
      path: '/inventory',
      query: '?view=dedup_queue',
    });

    window.history.replaceState({}, '', '/graph?ssid=lab-net');
    await login();
    expect(consumeReturnPath()).toEqual({
      path: '/graph',
      query: '?ssid=lab-net',
    });
    expect(keycloakClient.login).toHaveBeenCalledWith({
      redirectUri: callbackUri(),
    });
  });
});
