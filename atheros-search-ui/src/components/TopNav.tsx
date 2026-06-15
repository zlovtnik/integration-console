import { A, useLocation } from '@solidjs/router';
import { Activity, Keyboard, Network, Search } from 'lucide-solid';
import { ApiStatus } from './ApiStatus';
import { ShortcutsModal } from './ShortcutsModal';
import { ThemeToggle } from './ThemeToggle';
import { shortcutsOpen, setShortcutsOpen } from '~/stores/uiStore';

export function TopNav() {
  const location = useLocation();

  return (
    <>
      <nav aria-label="Primary navigation" class="top-nav">
        <A href="/" class="logo" aria-label="atheros search home">
          <span class="logo-mark" aria-hidden="true">
            <Activity size={18} />
          </span>
          <span class="logo-text">atheros</span>
        </A>

        <ul role="list" class="nav-links">
          <li>
            <A
              href="/"
              class="nav-link"
              aria-current={location.pathname === '/' ? 'page' : undefined}
            >
              <Search size={16} aria-hidden="true" />
              <span>Search</span>
            </A>
          </li>
          <li>
            <A
              href="/graph"
              class="nav-link"
              aria-current={
                location.pathname === '/graph' ? 'page' : undefined
              }
            >
              <Network size={16} aria-hidden="true" />
              <span>Graph</span>
            </A>
          </li>
        </ul>

        <div class="nav-actions">
          <ApiStatus />
          <button
            type="button"
            class="icon-btn"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={18} aria-hidden="true" />
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <ShortcutsModal
        open={shortcutsOpen()}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}
