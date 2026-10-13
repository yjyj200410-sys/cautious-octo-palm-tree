import { useEffect } from 'react';

import { queryClient } from '..';
import { settingsQuery } from '../queries/settings';
export function useDataSync() {
  useEffect(() => {
    const update = (_: unknown, events: DataUpdateEvent[]) => {
      if (
        events.some((event) => /^(songs|artists|albums|userData\/musicFolder)/.test(event.dataType))
      ) {
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'volo' && String(query.queryKey[1]).startsWith('local')
        });
      }
      if (events.some((event) => /^(userData|settings)/.test(event.dataType)))
        void queryClient.invalidateQueries({ queryKey: settingsQuery._def });
    };
    window.api.dataUpdates.dataUpdateEvent(update);
    return () => {
      window.api.dataUpdates.removeDataUpdateEventListeners();
    };
  }, []);
}
