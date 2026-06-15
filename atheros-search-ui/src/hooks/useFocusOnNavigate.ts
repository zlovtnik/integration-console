import { useLocation } from '@solidjs/router';
import { createEffect, on } from 'solid-js';

export function useFocusOnNavigate() {
  const location = useLocation();

  createEffect(
    on(
      () => location.pathname,
      () => {
        queueMicrotask(() => {
          document.getElementById('main-content')?.focus();
        });
      },
    ),
  );
}
