import { children, onCleanup, onMount, type ParentComponent } from 'solid-js';
import { useFocusOnNavigate } from '~/hooks/useFocusOnNavigate';
import { TopNav } from './TopNav';
import { PipelineStrip } from './OperationsStatus';
import { usePipeline } from '~/hooks/useOperations';
import '~/styles/operations.css';

export const AppShell: ParentComponent = (props) => {
  const resolvedChildren = children(() => props.children);

  useFocusOnNavigate();
  usePipeline();

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
      <header role="banner" class="workbench-header">
        <TopNav />
        <PipelineStrip />
      </header>
      <div class="workbench-content">{resolvedChildren()}</div>
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
