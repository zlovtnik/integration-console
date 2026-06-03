import { Route, Router } from '@solidjs/router';
import { lazy } from 'solid-js';
import { AppShell } from '~/components/AppShell';

const SearchPage = lazy(() => import('~/pages/SearchPage'));
const ExplainPage = lazy(() => import('~/pages/ExplainPage'));
const NotFoundPage = lazy(() => import('~/pages/NotFoundPage'));

export default function App() {
  return (
    <Router root={AppShell}>
      <Route path="/" component={SearchPage} />
      <Route path="/explain/:sourceKey" component={ExplainPage} />
      <Route path="*" component={NotFoundPage} />
    </Router>
  );
}
