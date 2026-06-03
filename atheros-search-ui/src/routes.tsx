import { lazy } from 'solid-js';
import type { RouteDefinition } from '@solidjs/router';

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: lazy(() => import('~/pages/SearchPage')),
  },
  {
    path: '/explain/:sourceKey',
    component: lazy(() => import('~/pages/ExplainPage')),
  },
  {
    path: '**',
    component: lazy(() => import('~/pages/NotFoundPage')),
  },
];
