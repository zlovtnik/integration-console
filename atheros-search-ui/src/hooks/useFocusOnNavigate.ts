import { useLocation } from '@solidjs/router';
import { createEffect } from 'solid-js';

export function useFocusOnNavigate() {
  const location = useLocation();

  createEffect(() => {
    location.pathname;
    queueMicrotask(() => {
      document.getElementById('main-content')?.focus();
    });
  });
}
