import type { ParentComponent } from 'solid-js';
import { onCleanup, onMount } from 'solid-js';
import { useFocusOnNavigate } from '~/hooks/useFocusOnNavigate';
import { TopNav } from './TopNav';

export const AppShell: ParentComponent = (props) => {
  useFocusOnNavigate();

  onMount(() => {
    const skipLink = document.querySelector<HTMLAnchorElement>(
      '.skip-link[href="#main-content"]',
    );

    function handleSkipLinkClick(event: MouseEvent) {
      const main = document.getElementById('main-content');
      if (!main) return;

      event.preventDefault();
      main.focus();
      main.scrollIntoView({ block: 'start' });
    }

    skipLink?.addEventListener('click', handleSkipLinkClick);
    onCleanup(() =>
      skipLink?.removeEventListener('click', handleSkipLinkClick),
    );
  });

  return (
    <>
      <header role="banner">
        <TopNav />
      </header>
      {props.children}
      <div
        id="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        class="sr-only"
      />
    </>
  );
};
