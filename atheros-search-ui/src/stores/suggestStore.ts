import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { SuggestFiltersResponse } from '~/api/types';

export const [suggestions, setSuggestions] = createStore<SuggestFiltersResponse>({
  ssids: [],
  location_ids: [],
  sensor_ids: [],
  frame_subtypes: [],
});

export const [suggestLoaded, setSuggestLoaded] = createSignal(false);
