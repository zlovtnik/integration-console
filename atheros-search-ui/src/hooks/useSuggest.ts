import { onMount } from 'solid-js';
import { api } from '~/api/client';
import { setSuggestLoaded, setSuggestions } from '~/stores/suggestStore';

export function useSuggest() {
  onMount(async () => {
    try {
      const data = await api.suggestFilters('');
      setSuggestions(data);
      setSuggestLoaded(true);
    } catch {
      setSuggestLoaded(false);
    }
  });
}
