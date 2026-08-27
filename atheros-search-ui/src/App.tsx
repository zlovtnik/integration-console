import { Route, Router } from '@solidjs/router';
import { lazy } from 'solid-js';
import { AppShell } from '~/components/AppShell';
import { AuthGate } from '~/components/AuthGate';

const SearchPage = lazy(() => import('~/pages/SearchPage'));
const ExplainPage = lazy(() => import('~/pages/ExplainPage'));
const GraphPage = lazy(() => import('~/pages/GraphPage'));
const InventoryPage = lazy(() => import('~/pages/InventoryPage'));
const NotFoundPage = lazy(() => import('~/pages/NotFoundPage'));

export default function App() {
  return (
    <AuthGate>
      <Router root={AppShell}>
        <Route path="/" component={SearchPage} />
        <Route path="/graph" component={GraphPage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/explain/:sourceKey" component={ExplainPage} />
        <Route path="*" component={NotFoundPage} />
      </Router>
    </AuthGate>
  );
}
