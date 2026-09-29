import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeReturnPath } from '~/auth/returnPath';

const keycloakClient = vi.hoisted(() => ({
  authenticated: false,
  init: vi.fn<() => Promise<boolean>>(),
  login: vi.fn<() => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
  updateToken: vi.fn<() => Promise<boolean>>(),
  token: undefined as string | undefined,
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
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/inventory?view=dedup_queue');
    keycloakClient.authenticated = false;
    keycloakClient.init.mockReset().mockResolvedValue(false);
    keycloakClient.login.mockReset().mockResolvedValue();
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
