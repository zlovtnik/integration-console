import { useNavigate } from '@solidjs/router';
import { createSignal, Match, onMount, Switch } from 'solid-js';
import { consumeReturnPath } from '~/auth/returnPath';
import { authError, initAuth } from '~/auth/session';

/**
 * Dedicated authentication callback route. Keycloak returns here after
 * login. The requested same-origin destination saved before login is
 * restored with router navigation; external return URLs are rejected by
 * the return-path module and fall back to the search page.
 */
export default function CallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    void initAuth()
      .then(() => {
        const destination = consumeReturnPath();
        navigate(destination ? destination.path + destination.query : '/', {
          replace: true,
          scroll: false,
        });
      })
      .catch(() => setFailed(true));
  });

  return (
    <main class="auth-page" id="main-content" tabIndex={-1}>
      <Switch>
        <Match when={failed()}>
          <section class="auth-panel state-banner--error" role="alert">
            <h1>Sign-in unavailable</h1>
            <p>{authError() || 'The identity service could not be reached.'}</p>
            <button
              class="btn"
              type="button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </section>
        </Match>
        <Match when={true}>
          <section class="auth-panel" role="status">
            Completing sign-in...
          </section>
        </Match>
      </Switch>
    </main>
  );
}
