import { Route, Router } from '@solidjs/router';
import { lazy, type ParentComponent } from 'solid-js';
import { AppShell } from '~/components/AppShell';
import { AuthGate } from '~/components/AuthGate';

const SearchPage = lazy(() => import('~/pages/SearchPage'));
const CallbackPage = lazy(() => import('~/pages/CallbackPage'));
const ExplainPage = lazy(() => import('~/pages/ExplainPage'));
const GraphPage = lazy(() => import('~/pages/GraphPage'));
const InventoryPage = lazy(() => import('~/pages/InventoryPage'));
const DQPage = lazy(() => import('~/pages/DQPage'));
const IngestionPage = lazy(() => import('~/pages/IngestionPage'));
const SourcesPage = lazy(() => import('~/pages/SourcesPage'));
const EvidencePage = lazy(() => import('~/pages/EvidencePage'));
const NotFoundPage = lazy(() => import('~/pages/NotFoundPage'));

const AuthenticatedAppShell: ParentComponent = (props) => (
  <AuthGate>
    <AppShell>{props.children}</AppShell>
  </AuthGate>
);

export default function App() {
  return (
    <Router>
      <Route path="/callback" component={CallbackPage} />
      <Route component={AuthenticatedAppShell}>
        <Route path="/" component={SearchPage} />
        <Route path="/ingestion" component={IngestionPage} />
        <Route path="/sources" component={SourcesPage} />
        <Route path="/sources/proxy" component={SourcesPage} />
        <Route path="/evidence" component={EvidencePage} />
        <Route path="/graph" component={GraphPage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/dq/*" component={DQPage} />
        <Route path="/explain/:sourceKey" component={ExplainPage} />
      </Route>
      <Route component={AppShell}>
        <Route path="*" component={NotFoundPage} />
      </Route>
    </Router>
  );
}
