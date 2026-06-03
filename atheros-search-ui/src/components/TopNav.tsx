import { A, useLocation } from '@solidjs/router';
import { Activity, Keyboard, Search } from 'lucide-solid';
import { ApiStatus } from './ApiStatus';
import { ThemeToggle } from './ThemeToggle';

export function TopNav() {
  const location = useLocation();

  return (
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
          <A href="/?shortcuts=1" class="nav-link">
            <Keyboard size={16} aria-hidden="true" />
            <span>Commands</span>
          </A>
        </li>
      </ul>

      <div class="nav-actions">
        <ApiStatus />
        <ThemeToggle />
      </div>
    </nav>
  );
}
