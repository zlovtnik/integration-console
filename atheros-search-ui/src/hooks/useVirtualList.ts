import { createMemo, createSignal } from 'solid-js';

export function useVirtualList<T>(
  items: () => T[],
  itemHeight: number,
  containerHeight: number,
) {
  const [scrollTop, setScrollTop] = createSignal(0);
  const start = createMemo(() => Math.max(0, Math.floor(scrollTop() / itemHeight)));
  const end = createMemo(() =>
    Math.min(start() + Math.ceil(containerHeight / itemHeight) + 2, items().length),
  );
  const visible = createMemo(() => items().slice(start(), end()));
  const offsetTop = createMemo(() => start() * itemHeight);
  const totalHeight = createMemo(() => items().length * itemHeight);

  return { visible, offsetTop, totalHeight, setScrollTop };
}
