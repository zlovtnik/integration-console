import { useBeforeLeave, useLocation } from '@solidjs/router';

const scrollMap = new Map<string, number>();

export function useScrollRestoration() {
  const location = useLocation();

  useBeforeLeave(() => {
    scrollMap.set(location.pathname, window.scrollY);
  });

  return () => scrollMap.get(location.pathname) ?? 0;
}
