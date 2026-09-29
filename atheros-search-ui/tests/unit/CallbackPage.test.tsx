import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '~/App';
import { saveReturnPath } from '~/auth/returnPath';
import CallbackPage from '~/pages/CallbackPage';

const auth = vi.hoisted(() => ({
  error: '',
  initAuth: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('~/auth/session', () => ({
  authError: () => auth.error,
  authStatus: () => 'checking',
  initAuth: auth.initAuth,
  login: vi.fn(),
}));

function renderCallback() {
  const history = createMemoryHistory();
  history.set({ value: '/callback', replace: true });
  const result = render(() => (
    <MemoryRouter history={history}>
      <Route path="/callback" component={CallbackPage} />
      <Route path="*" component={() => <p>Destination</p>} />
    </MemoryRouter>
  ));
  return { history, ...result };
}

beforeEach(() => {
  auth.error = '';
  auth.initAuth.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('authentication callback routing', () => {
  it.each([
    ['authenticated', true],
    ['unauthenticated', false],
  ])('restores the destination after an %s result', async (_label, result) => {
    saveReturnPath('/inventory', '?view=dedup_queue');
    auth.initAuth.mockResolvedValue(result);
    const { history } = renderCallback();

    await waitFor(() =>
      expect(history.get()).toBe('/inventory?view=dedup_queue'),
    );
    history.back();
    expect(history.get()).toBe('/inventory?view=dedup_queue');
  });

  it('falls back to the root when the destination is missing', async () => {
    auth.initAuth.mockResolvedValue(false);
    const { history } = renderCallback();

    await waitFor(() => expect(history.get()).toBe('/'));
  });

  it('falls back to the root when the persisted destination is invalid', async () => {
    window.sessionStorage.setItem(
      'atheros-search.auth-return',
      JSON.stringify({ path: '/callback', query: '' }),
    );
    auth.initAuth.mockResolvedValue(true);
    const { history } = renderCallback();

    await waitFor(() => expect(history.get()).toBe('/'));
  });

  it('stays on the callback and offers retry after initialization fails', async () => {
    auth.error = 'Keycloak is unavailable.';
    auth.initAuth.mockRejectedValue(new Error(auth.error));
    const { getByRole, history } = renderCallback();

    await waitFor(() =>
      expect(getByRole('alert')).toHaveTextContent(auth.error),
    );
    expect(getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(history.get()).toBe('/callback');
  });

  it('keeps the callback outside the application shell', async () => {
    auth.initAuth.mockReturnValue(new Promise(() => {}));
    window.history.replaceState({}, '', '/callback');
    const { findByText, queryByRole } = render(() => <App />);

    await findByText('Completing sign-in...');
    expect(queryByRole('banner')).toBeNull();
  });

  it('never ends on callback across passive SSO and interactive login', async () => {
    auth.initAuth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    saveReturnPath('/graph', '?ssid=lab-net');
    const { history } = renderCallback();

    await waitFor(() => expect(history.get()).toBe('/graph?ssid=lab-net'));

    saveReturnPath('/graph', '?ssid=lab-net');
    history.set({ value: '/callback' });

    await waitFor(() => expect(auth.initAuth).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(history.get()).toBe('/graph?ssid=lab-net'));
    expect(history.get()).not.toBe('/callback');
  });
});
