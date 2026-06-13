export function SkeletonExplain() {
  return (
    <div
      class="explain-grid skeleton-explain"
      role="status"
      aria-label="Loading explanation"
    >
      <section class="explain-section">
        <div class="skeleton-line skeleton-line--short" />
        <div class="skeleton-meter" />
        <div class="skeleton-meter" />
        <div class="skeleton-meter" />
      </section>
      <section class="explain-section">
        <div class="skeleton-line skeleton-line--short" />
        <div class="badge-row">
          <span class="skeleton-line skeleton-line--short" />
          <span class="skeleton-line skeleton-line--short" />
        </div>
      </section>
      <section class="explain-section explain-section--wide">
        <div class="skeleton-line skeleton-line--short" />
        <div class="skeleton-line skeleton-line--wide" />
        <div class="skeleton-line" />
        <div class="skeleton-line skeleton-line--wide" />
      </section>
    </div>
  );
}
