import Keycloak from 'keycloak-js';
import { createSignal } from 'solid-js';
import { env } from '~/env';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'error';

const configured = Boolean(
  env.keycloakUrl && env.keycloakRealm && env.keycloakClientId,
);

export const keycloak = configured
  ? new Keycloak({
      url: env.keycloakUrl,
      realm: env.keycloakRealm,
      clientId: env.keycloakClientId,
    })
  : undefined;

const [authStatus, setAuthStatus] = createSignal<AuthStatus>(
  configured ? 'checking' : 'authenticated',
);
const [authError, setAuthError] = createSignal('');

let initPromise: Promise<boolean> | undefined;
let refreshPromise: Promise<string> | undefined;

export { authError, authStatus };

export function callbackUri(): string {
  return `${window.location.origin}/callback`;
}

export function initAuth(): Promise<boolean> {
  if (!keycloak) return Promise.resolve(true);
  if (initPromise) return initPromise;

  keycloak.onAuthSuccess = () => setAuthStatus('authenticated');
  keycloak.onAuthRefreshSuccess = () => setAuthStatus('authenticated');
  keycloak.onAuthLogout = () => setAuthStatus('anonymous');
  keycloak.onAuthRefreshError = () => setAuthStatus('anonymous');
  keycloak.onTokenExpired = () => {
    void getAccessToken().catch(() => setAuthStatus('anonymous'));
  };

  initPromise = keycloak
    .init({
      checkLoginIframe: false,
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      redirectUri: callbackUri(),
    })
    .then((authenticated) => {
      setAuthStatus(authenticated ? 'authenticated' : 'anonymous');
      if (authenticated && window.location.pathname === '/callback') {
        window.history.replaceState(null, '', '/');
      }
      return authenticated;
    })
    .catch((error: unknown) => {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed.');
      setAuthStatus('error');
      throw error;
    });

  return initPromise;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!keycloak) return '';
  await initAuth();
  if (!keycloak.authenticated) return '';

  if (!refreshPromise) {
    refreshPromise = keycloak
      .updateToken(forceRefresh ? -1 : 30)
      .then(() => keycloak.token ?? '')
      .finally(() => {
        refreshPromise = undefined;
      });
  }
  return refreshPromise;
}

export async function login(): Promise<void> {
  if (!keycloak) return;
  await initAuth();
  await keycloak.login({ redirectUri: callbackUri() });
}

export async function logout(): Promise<void> {
  if (!keycloak) return;
  await keycloak.logout({ redirectUri: window.location.origin });
}
