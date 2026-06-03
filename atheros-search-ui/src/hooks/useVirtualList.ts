import { createMemo, createSignal } from 'solid-js';

export function useVirtualList<T>(
  items: () => T[],
  itemHeight: () => number,
  containerHeight: () => number,
) {
  const [scrollTop, setScrollTop] = createSignal(0);
  const rowHeight = createMemo(() => Math.max(1, itemHeight()));
  const viewportHeight = createMemo(() => Math.max(0, containerHeight()));
  const rawStart = createMemo(() =>
    Math.max(0, Math.floor(scrollTop() / rowHeight())),
  );
  const start = createMemo(() => {
    const maxStart = Math.max(0, items().length - 1);
    return Math.min(rawStart(), maxStart);
  });
  const end = createMemo(() =>
    Math.min(
      start() + Math.ceil(viewportHeight() / rowHeight()) + 2,
      items().length,
    ),
  );
  const visible = createMemo(() => items().slice(start(), end()));
  const offsetTop = createMemo(() => start() * rowHeight());
  const totalHeight = createMemo(() => items().length * rowHeight());

  return { visible, offsetTop, totalHeight, setScrollTop };
}
