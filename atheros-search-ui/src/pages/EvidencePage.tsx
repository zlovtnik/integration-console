import { A, useLocation } from '@solidjs/router';
import { reportLink } from '~/utils/reportNavigation';

export default function EvidencePage() {
  const location = useLocation();
  return (
    <main id="main-content" class="main-content operations-page" tabIndex={-1}>
      <h1>Evidence</h1>
      <p class="caption">
        Explore retained observations and inspect the evidence behind a
        retrieval result.
      </p>
      <div class="operations-grid">
        <section class="operations-panel">
          <h2>Relationships</h2>
          <p>Explore wireless topology, relationships and saved graph views.</p>
          <A
            class="btn btn-secondary"
            href={reportLink('/graph', location.pathname, location.search)}
          >
            Open Graph
          </A>
        </section>
        <section class="operations-panel">
          <h2>Inventory</h2>
          <p>
            Inspect observed identifiers, ownership and candidate identity
            joins.
          </p>
          <A
            class="btn btn-secondary"
            href={reportLink('/inventory', location.pathname, location.search)}
          >
            Open Inventory
          </A>
        </section>
        <section class="operations-panel">
          <h2>Record explanations</h2>
          <p>
            Open a retrieval result to inspect its source record, ranking and
            embedding work.
          </p>
          <A
            class="btn btn-secondary"
            href={reportLink('/', location.pathname, location.search)}
          >
            Retrieve evidence
          </A>
        </section>
      </div>
      <p class="state-banner">
        Observations and similarity are evidence, not proof of a person or
        device identity. Generated answers are not part of this workflow.
      </p>
    </main>
  );
}
