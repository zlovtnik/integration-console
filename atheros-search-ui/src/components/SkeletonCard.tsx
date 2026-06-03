export function SkeletonCard() {
  return (
    <article class="result-card skeleton-card" aria-hidden="true">
      <div class="skeleton-line skeleton-line--wide" />
      <div class="skeleton-line" />
      <div class="skeleton-meter" />
      <div class="skeleton-line skeleton-line--short" />
    </article>
  );
}
