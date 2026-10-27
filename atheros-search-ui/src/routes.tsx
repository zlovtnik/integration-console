import { lazy } from 'solid-js';
import type { RouteDefinition } from '@solidjs/router';

export const routes: RouteDefinition[] = [
  {
    path: '/ingestion',
    component: lazy(() => import('~/pages/IngestionPage')),
  },
  { path: '/sources', component: lazy(() => import('~/pages/SourcesPage')) },
  {
    path: '/sources/proxy',
    component: lazy(() => import('~/pages/SourcesPage')),
  },
  { path: '/evidence', component: lazy(() => import('~/pages/EvidencePage')) },
  { path: '/dq/*', component: lazy(() => import('~/pages/DQPage')) },
  {
    path: '/',
    component: lazy(() => import('~/pages/SearchPage')),
  },
  {
    path: '/callback',
    component: lazy(() => import('~/pages/CallbackPage')),
  },
  {
    path: '/explain/:sourceKey',
    component: lazy(() => import('~/pages/ExplainPage')),
  },
  {
    path: '/graph',
    component: lazy(() => import('~/pages/GraphPage')),
  },
  {
    path: '/inventory',
    component: lazy(() => import('~/pages/InventoryPage')),
  },
  {
    path: '**',
    component: lazy(() => import('~/pages/NotFoundPage')),
  },
];
