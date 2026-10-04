import Keycloak from 'keycloak-js';
import { createSignal } from 'solid-js';
import { env } from '~/env';
import { consumeReturnPath, saveReturnPath } from '~/auth/returnPath';
import {
  auditGeneration,
  clearAuditState,
  setAuditIdentity,
} from '~/auth/auditState';

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
export const [authSession, setAuthSession] = createSignal(0);

let initPromise: Promise<boolean> | undefined;
let refreshPromise: Promise<string> | undefined;

function acceptIdentity(): void {
  const token = keycloak?.tokenParsed;
  const previous = auditGeneration();
  const realmRoles = [...(token?.realm_access?.roles ?? [])].sort();
  const clientRoles = Object.entries(token?.resource_access ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([client, access]) => [client, [...access.roles].sort()]);
  setAuditIdentity(
    token?.sub
      ? JSON.stringify([token.iss, token.sub, realmRoles, clientRoles])
      : undefined,
  );
  if (auditGeneration() !== previous) setAuthSession((value) => value + 1);
  setAuthStatus('authenticated');
}

function loseIdentity(): void {
  setAuditIdentity(undefined);
  setAuthStatus('anonymous');
}

window.addEventListener('atheros-search.identity-changed', () =>
  setAuthStatus('anonymous'),
);

export { authError, authStatus };

export function denyAuditAccess(): void {
  clearAuditState();
  setAuthError('Your account does not have access to this data.');
  setAuthStatus('error');
}

export function callbackUri(): string {
  return `${window.location.origin}/callback`;
}

export function logoutUri(): string {
  return `${window.location.origin}/`;
}

export function captureCurrentReturnPath(): void {
  saveReturnPath(window.location.pathname, window.location.search);
}

export function initAuth(): Promise<boolean> {
  if (!keycloak) return Promise.resolve(true);
  if (initPromise) return initPromise;

  captureCurrentReturnPath();

  keycloak.onAuthSuccess = acceptIdentity;
  keycloak.onAuthRefreshSuccess = acceptIdentity;
  keycloak.onAuthLogout = loseIdentity;
  keycloak.onAuthRefreshError = loseIdentity;
  keycloak.onTokenExpired = () => {
    void getAccessToken().catch(loseIdentity);
  };

  initPromise = keycloak
    .init({
      checkLoginIframe: false,
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      redirectUri: callbackUri(),
    })
    .then((authenticated) => {
      if (authenticated) acceptIdentity();
      else loseIdentity();
      return authenticated;
    })
    .catch((error: unknown) => {
      setAuditIdentity(undefined);
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed.');
      setAuthStatus('error');
      throw error;
    });

  return initPromise;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!keycloak) return '';
  await initAuth();
  if (!keycloak.authenticated || authStatus() !== 'authenticated') return '';
  const generation = auditGeneration();

  if (!refreshPromise) {
    refreshPromise = keycloak
      .updateToken(forceRefresh ? -1 : 30)
      .then(() => keycloak.token ?? '')
      .finally(() => {
        refreshPromise = undefined;
      });
  }
  const token = await refreshPromise;
  if (generation !== auditGeneration())
    throw new DOMException('Identity changed', 'AbortError');
  return token;
}

export async function login(): Promise<void> {
  if (!keycloak) return;
  captureCurrentReturnPath();
  await initAuth();
  if (keycloak.authenticated && authStatus() === 'authenticated') return;
  await keycloak.login({ redirectUri: callbackUri() });
}

export async function logout(): Promise<void> {
  loseIdentity();
  if (!keycloak) return;
  await keycloak.logout({ redirectUri: logoutUri() });
}

export { consumeReturnPath };
