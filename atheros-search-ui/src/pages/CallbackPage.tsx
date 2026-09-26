import { useNavigate } from '@solidjs/router';
import { createEffect, on } from 'solid-js';
import { consumeReturnPath } from '~/auth/returnPath';
import { initAuth } from '~/auth/session';

/**
 * Dedicated authentication callback route. Keycloak returns here after
 * login. The requested same-origin destination saved before login is
 * restored with router navigation; external return URLs are rejected by
 * the return-path module and fall back to the search page.
 */
export default function CallbackPage() {
  const navigate = useNavigate();

  createEffect(
    on(
      () => true,
      () => {
        void initAuth()
          .catch(() => undefined)
          .then(() => {
            const destination = consumeReturnPath();
            if (destination) {
              navigate(
                destination.path + destination.query,
                { replace: true },
              );
            } else {
              navigate('/', { replace: true });
            }
          });
      },
    ),
  );

  return (
    <main class="auth-page" id="main-content" tabIndex={-1}>
      <section class="auth-panel" role="status">
        Completing sign-in...
      </section>
    </main>
  );
}