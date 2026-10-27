import { A, useLocation } from '@solidjs/router';
import {
  Activity,
  Database,
  Keyboard,
  LogOut,
  Network,
  Search,
  Layers,
  Radio,
} from 'lucide-solid';
import { logout } from '~/auth/session';
import { ApiStatus } from './ApiStatus';
import { ShortcutsModal } from './ShortcutsModal';
import { shortcutsOpen, setShortcutsOpen } from '~/stores/uiStore';
import { reportLink } from '~/utils/reportNavigation';

export function TopNav() {
  const location = useLocation();

  return (
    <>
      <div class="top-nav">
        <A href="/" class="logo" aria-label="atheros search home">
          <span class="logo-mark" aria-hidden="true">
            <Activity size={18} />
          </span>
          <span class="logo-text">Atheros Search</span>
        </A>

        <nav aria-label="Primary navigation" class="workbench-nav">
          <ul role="list" class="nav-links">
            <li>
              <A
                href={reportLink('/', location.pathname, location.search)}
                class="nav-link"
                aria-current={location.pathname === '/' ? 'page' : undefined}
              >
                <Search size={16} aria-hidden="true" />
                <span>
                  Retrieval <small>Search</small>
                </span>
              </A>
            </li>
            <li>
              <A
                href="/ingestion"
                class="nav-link"
                aria-current={
                  location.pathname === '/ingestion' ? 'page' : undefined
                }
              >
                <Activity size={16} aria-hidden="true" />
                <span>Ingestion</span>
              </A>
            </li>
            <li>
              <A
                href="/sources"
                class="nav-link"
                aria-current={
                  location.pathname.startsWith('/sources') ? 'page' : undefined
                }
              >
                <Radio size={16} aria-hidden="true" />
                <span>Sources</span>
              </A>
            </li>
            <li>
              <A
                href={reportLink(
                  '/evidence',
                  location.pathname,
                  location.search,
                )}
                class="nav-link"
                aria-current={
                  location.pathname === '/evidence' ||
                  location.pathname.startsWith('/explain/')
                    ? 'page'
                    : undefined
                }
              >
                <Database size={16} aria-hidden="true" />
                <span>Evidence</span>
              </A>
            </li>
            <li>
              <A
                href={reportLink('/graph', location.pathname, location.search)}
                class="nav-link"
                aria-current={
                  location.pathname === '/graph' ? 'page' : undefined
                }
              >
                <Network size={16} aria-hidden="true" />
                <span>Graph</span>
              </A>
            </li>
            <li>
              <A
                href={reportLink(
                  '/inventory',
                  location.pathname,
                  location.search,
                )}
                class="nav-link"
                aria-current={
                  location.pathname === '/inventory' ? 'page' : undefined
                }
              >
                <Database size={16} aria-hidden="true" />
                <span>Inventory</span>
              </A>
            </li>
            <li>
              <A
                href={reportLink('/dq', location.pathname, location.search)}
                class="nav-link"
                aria-current={
                  location.pathname.startsWith('/dq') ? 'page' : undefined
                }
              >
                <Layers size={16} aria-hidden="true" />
                <span>
                  Processing <small>DQ</small>
                </span>
              </A>
            </li>
          </ul>
        </nav>

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
          <button
            type="button"
            class="icon-btn"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void logout()}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ShortcutsModal
        open={shortcutsOpen()}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}
