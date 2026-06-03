import type { ParentComponent } from 'solid-js';
import { useFocusOnNavigate } from '~/hooks/useFocusOnNavigate';
import { TopNav } from './TopNav';

export const AppShell: ParentComponent = (props) => {
  useFocusOnNavigate();

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
