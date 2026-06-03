import { createSignal, Match, onMount, Switch } from 'solid-js';
import { Monitor, Moon, Sun } from 'lucide-solid';

type Theme = 'dark' | 'light' | 'system';

function effectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>('dark');

  function applyTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = effectiveTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
  }

  onMount(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    const initial = stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark';
    setTheme(initial);
    applyTheme(initial);
  });

  function cycle() {
    const nextTheme: Theme =
      theme() === 'dark' ? 'light' : theme() === 'light' ? 'system' : 'dark';
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  const label = () =>
    ({
      dark: 'Switch to light theme',
      light: 'Switch to system theme',
      system: 'Switch to dark theme',
    })[theme()];

  return (
    <button type="button" class="icon-btn" onClick={cycle} aria-label={label()} title={label()}>
      <Switch>
        <Match when={theme() === 'dark'}>
          <Moon size={18} aria-hidden="true" />
        </Match>
        <Match when={theme() === 'light'}>
          <Sun size={18} aria-hidden="true" />
        </Match>
        <Match when={theme() === 'system'}>
          <Monitor size={18} aria-hidden="true" />
        </Match>
      </Switch>
    </button>
  );
}
