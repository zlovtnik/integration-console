import { A } from '@solidjs/router';
import { Home } from 'lucide-solid';
import { onMount } from 'solid-js';

export default function NotFoundPage() {
  onMount(() => {
    document.title = 'Not found - atheros search';
  });

  return (
    <main id="main-content" class="main-content not-found-page" tabIndex={-1}>
      <h1 class="display">Not found</h1>
      <A href="/" class="btn btn-primary">
        <Home size={16} aria-hidden="true" />
        <span>Search</span>
      </A>
    </main>
  );
}
