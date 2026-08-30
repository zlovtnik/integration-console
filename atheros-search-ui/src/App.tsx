import { Route, Router } from '@solidjs/router';
import { lazy, type ParentComponent } from 'solid-js';
import { AppShell } from '~/components/AppShell';
import { AuthGate } from '~/components/AuthGate';

const SearchPage = lazy(() => import('~/pages/SearchPage'));
const ExplainPage = lazy(() => import('~/pages/ExplainPage'));
const GraphPage = lazy(() => import('~/pages/GraphPage'));
const InventoryPage = lazy(() => import('~/pages/InventoryPage'));
const NotFoundPage = lazy(() => import('~/pages/NotFoundPage'));

const AuthenticatedAppShell: ParentComponent = (props) => (
  <AuthGate>
    <AppShell>{props.children}</AppShell>
  </AuthGate>
);

export default function App() {
  return (
    <Router>
      <Route component={AuthenticatedAppShell}>
        <Route path="/" component={SearchPage} />
        <Route path="/callback" component={SearchPage} />
        <Route path="/graph" component={GraphPage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/explain/:sourceKey" component={ExplainPage} />
      </Route>
      <Route component={AppShell}>
        <Route path="*" component={NotFoundPage} />
      </Route>
    </Router>
  );
}
