import { Match, onMount, Switch, type ParentComponent } from 'solid-js';
import { authError, authStatus, initAuth, login } from '~/auth/session';

export const AuthGate: ParentComponent = (props) => {
  onMount(() => {
    void initAuth().catch(() => undefined);
  });

  return (
    <Switch>
      <Match when={authStatus() === 'authenticated'}>{props.children}</Match>
      <Match when={authStatus() === 'anonymous'}>
        <main class="auth-page" id="main-content" tabIndex={-1}>
          <section class="auth-panel" aria-labelledby="auth-title">
            <span class="eyebrow">Secure WAN gateway</span>
            <h1 id="auth-title">Atheros Search</h1>
            <p>
              Sign in with your middleware account to search wireless audit
              data.
            </p>
            <button
              class="btn btn-primary"
              type="button"
              onClick={() => void login()}
            >
              Sign in
            </button>
          </section>
        </main>
      </Match>
      <Match when={authStatus() === 'error'}>
        <main class="auth-page" id="main-content" tabIndex={-1}>
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
        </main>
      </Match>
      <Match when={true}>
        <main class="auth-page" id="main-content" tabIndex={-1}>
          <section class="auth-panel" role="status">
            Checking session...
          </section>
        </main>
      </Match>
    </Switch>
  );
};
