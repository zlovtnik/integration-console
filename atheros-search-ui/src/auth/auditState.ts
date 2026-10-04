import { batch, createSignal } from 'solid-js';
import {
  clearAllFilters,
  clearResults,
  resetSearchControlsFromUrlDefaults,
  resetSearchSessionId,
  setHistory,
} from '~/stores/searchStore';
import {
  clearGraph,
  resetGraphFilters,
  setPinnedNodeIds,
} from '~/stores/graphStore';
import {
  clearInventory,
  resetInventoryFilters,
  setInventoryDedupCandidates,
  setInventoryDedupDevices,
  setInventoryDedupEdges,
  setInventoryDedupError,
  setInventoryDecisionError,
  setInventoryDecisionNotice,
  setSelectedInventoryNodeId,
  setPinnedInventoryNodeIds,
} from '~/stores/inventoryStore';
import { setSuggestions, setSuggestLoaded } from '~/stores/suggestStore';

const IDENTITY_KEY = 'atheros-search.audit-identity';
const CACHE_KEYS = [
  'atheros-search.suggestions',
  'atheros-search.history',
  'atheros-search.session-id',
  'atheros-search.graph-views',
];
let identity: string | undefined;
const [generation, setGeneration] = createSignal(0);
let controller = new AbortController();

export const auditGeneration = generation;
export const auditSignal = () => controller.signal;

export function clearAuditState(): void {
  controller.abort();
  controller = new AbortController();
  for (const key of CACHE_KEYS) {
    for (const storage of ['sessionStorage', 'localStorage'] as const) {
      try {
        window[storage].removeItem(key);
      } catch {
        /* Storage may be disabled. */
      }
    }
  }
  batch(() => {
    clearResults();
    clearAllFilters();
    resetSearchControlsFromUrlDefaults();
    resetSearchSessionId();
    setHistory([]);
    clearGraph();
    resetGraphFilters();
    setPinnedNodeIds(new Set<string>());
    clearInventory();
    resetInventoryFilters();
    setInventoryDedupCandidates([]);
    setInventoryDedupDevices([]);
    setInventoryDedupEdges([]);
    setInventoryDedupError(null);
    setInventoryDecisionError(null);
    setInventoryDecisionNotice('');
    setSelectedInventoryNodeId(null);
    setPinnedInventoryNodeIds(new Set<string>());
    setSuggestions({
      ssids: [],
      location_ids: [],
      sensor_ids: [],
      frame_subtypes: [],
    });
    setSuggestLoaded(false);
    setGeneration((value) => value + 1);
  });
}

export function setAuditIdentity(next: string | undefined): void {
  let persisted: string | null = null;
  try {
    persisted = window.localStorage.getItem(IDENTITY_KEY);
  } catch {
    /* Fail closed. */
  }
  if (
    next === undefined ||
    (identity !== undefined && identity !== next) ||
    persisted !== next
  ) {
    clearAuditState();
  }
  identity = next;
  try {
    if (next === undefined) window.localStorage.removeItem(IDENTITY_KEY);
    else window.localStorage.setItem(IDENTITY_KEY, next);
  } catch {
    /* Storage may be disabled. */
  }
}

window.addEventListener('storage', (event) => {
  if (event.key === IDENTITY_KEY && event.newValue !== identity) {
    clearAuditState();
    window.dispatchEvent(new Event('atheros-search.identity-changed'));
  }
});
