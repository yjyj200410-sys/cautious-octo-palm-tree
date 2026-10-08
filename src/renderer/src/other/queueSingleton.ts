import { store } from '../store/store';
import storage from '../utils/localStorage';
import type { AppReducer } from './appReducer';
import PlayerQueue from './playerQueue';

// Module-level singleton - created once when module loads
let queueInstance: PlayerQueue | null = null;
let isSettingUpSync = false;

type QueueStoreState = {
  localStorage?: LocalStorage;
};

type QueueSubscriptionState =
  | QueueStoreState
  | {
      currentVal?: QueueStoreState;
      prevVal?: QueueStoreState;
    };

const getQueueSubscriptionState = (subscriptionState: QueueSubscriptionState): QueueStoreState => {
  if ('currentVal' in subscriptionState && subscriptionState.currentVal) {
    return subscriptionState.currentVal;
  }

  return subscriptionState as QueueStoreState;
};

/**
 * Initialize the singleton queue instance. Called once when the app starts. Loads queue from
 * localStorage or creates empty queue.
 */
export function initializeQueue(): PlayerQueue {
  if (queueInstance) {
    return queueInstance;
  }

  // Load from localStorage
  const storedQueue = storage.queue.getQueue();
  queueInstance = storedQueue ? PlayerQueue.fromJSON(storedQueue) : new PlayerQueue();

  // Set up bidirectional sync with store (only once)
  if (!isSettingUpSync) {
    setupQueueStoreSync(queueInstance);
  }

  return queueInstance;
}

/** Get the singleton queue instance. Auto-initializes on first access if not already initialized. */
export function getQueue(): PlayerQueue {
  if (!queueInstance) {
    // Auto-initialize on first access (defensive programming)
    return initializeQueue();
  }
  return queueInstance;
}

/**
 * Set up bidirectional synchronization between queue and store. Uses a flag to prevent infinite
 * loops when syncing from store → queue.
 */
function setupQueueStoreSync(queue: PlayerQueue) {
  if (isSettingUpSync) return; // Prevent multiple setup calls
  isSettingUpSync = true;

  // Flag to prevent infinite loops during store → queue sync
  let isSyncingFromStore = false;

  // 1. Queue → Store: When queue changes, update store
  queue.on('queueChange', () => {
    const storeLenBefore = (store.state as AppReducer).localStorage?.queue?.songIds?.length ?? -1;
    console.log(
      `[QUEUE_SYNC_PUSH] memoryLength=${queue.length} ` +
      `storeLengthBefore=${storeLenBefore} isSyncing=${isSyncingFromStore}`
    );

    // Skip if we're syncing from store (prevents infinite loop)
    if (isSyncingFromStore) {
      console.log(`[QUEUE_SYNC_PUSH] SKIPPED — isSyncingFromStore=true`);
      return;
    }

    store.setState((state) => ({
      ...state,
      localStorage: {
        ...state.localStorage,
        queue: {
          songIds: queue.getAllSongIds(),
          position: queue.position,
          queueBeforeShuffle: queue.queueBeforeShuffle,
          metadata: queue.getMetadata(),
          queueSource: queue.getQueueSource()
        }
      }
    }));

    const storeLenAfter = (store.state as AppReducer).localStorage?.queue?.songIds?.length ?? -1;
    console.log(`[QUEUE_SYNC_AFTER] storeLengthAfter=${storeLenAfter}`);
    // Persistence handled by store.subscribe in store.ts
  });

  queue.on('positionChange', () => {
    console.log(
      `[QUEUE_SYNC_PUSH] positionChange position=${queue.position} ` +
      `isSyncing=${isSyncingFromStore}`
    );

    // Skip if we're syncing from store (prevents infinite loop)
    if (isSyncingFromStore) {
      return;
    }

    store.setState((state) => ({
      ...state,
      localStorage: {
        ...state.localStorage,
        queue: {
          ...state.localStorage.queue,
          position: queue.position
        }
      }
    }));
    // Persistence handled by store.subscribe in store.ts
  });

  // 2. Store → Queue: When store changes externally, sync queue
  // (This handles cases where store is updated directly)
  store.subscribe((state) => {
    const currentState = getQueueSubscriptionState(state as QueueSubscriptionState);
    const storeQueue = currentState.localStorage?.queue;

    if (!storeQueue) {
      return;
    }

    // Only sync if store data differs from queue data
    const queueSongIds = queue.getAllSongIds();
    const storeSongIds = storeQueue.songIds;

    const queueChanged = JSON.stringify(queueSongIds) !== JSON.stringify(storeSongIds);
    const positionChanged = queue.position !== storeQueue.position;

    if (queueChanged || positionChanged) {
      console.log(
        `[QUEUE_SYNC_PULL] REVERTING queue to store ` +
        `storeLength=${storeSongIds.length} ` +
        `memoryLength=${queueSongIds.length} ` +
        `queueChanged=${queueChanged} positionChanged=${positionChanged}`
      );
      console.trace('[QUEUE_SYNC_PULL] stack trace');

      // Set flag to prevent handlers from updating store
      isSyncingFromStore = true;

      try {
        // Update queue from store
        queue.replaceQueue(
          storeSongIds,
          storeQueue.position,
          false, // Don't clear shuffle history
          storeQueue.metadata
        );
      } finally {
        // Reset flag
        isSyncingFromStore = false;
      }
    }
  });

  isSettingUpSync = false;
}

/** For testing/debugging: Reset the queue singleton. ⚠️ Should only be used in tests! */
export function resetQueueForTesting() {
  if (queueInstance) {
    queueInstance.removeAllListeners();
    queueInstance = null;
    isSettingUpSync = false;
  }
}
