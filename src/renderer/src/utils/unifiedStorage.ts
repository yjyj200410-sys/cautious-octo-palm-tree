type SongSource = 'local' | 'netease';

export interface SongIdentity {
  source: SongSource;
  sourceId: string; // local: String(positive songId), netease: String(positive ncmId)
}

export interface HistoryEntry {
  identity: SongIdentity;
  title: string;
  artists: string;
  cover: string;
  timestamp: number;
}

const FAVORITES_KEY = 'unified_favorites';
const HISTORY_KEY = 'unified_history';
const HISTORY_MAX = 500;

function identityMatch(a: SongIdentity, b: SongIdentity): boolean {
  return a.source === b.source && a.sourceId === b.sourceId;
}

// ── FavoriteService ──

function readFavorites(): SongIdentity[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFavorites(list: SongIdentity[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
}

/**
 * 收藏内存缓存:Set<"source:sourceId">。isFavorite 在渲染期间被逐歌调用,原实现每次
 * localStorage.getItem+JSON.parse+数组扫描——700 首歌列表 = 700 次磁盘/解析。改为惰性构建 Set,add/remove 同步增删,读操作
 * O(1)。模块外直接写 localStorage(迁移脚本)须调 refreshFavoriteCache。
 */
let favoriteSet: Set<string> | null = null;
const favoriteListeners = new Set<() => void>();

function favoriteKey(identity: SongIdentity): string {
  return `${identity.source}:${identity.sourceId}`;
}

function refreshFavoriteCache(): void {
  favoriteSet = new Set(readFavorites().map(favoriteKey));
}

function notifyFavoriteListeners(): void {
  for (const listener of favoriteListeners) listener();
}

export const FavoriteService = {
  getFavorites(): SongIdentity[] {
    return readFavorites();
  },

  addFavorite(identity: SongIdentity): void {
    const list = readFavorites();
    if (!list.some((x) => identityMatch(x, identity))) {
      list.push(identity);
      writeFavorites(list);
      favoriteSet?.add(favoriteKey(identity));
      notifyFavoriteListeners();
    }
  },

  addFavorites(identities: SongIdentity[]): void {
    const list = readFavorites();
    const keys = new Set(list.map(favoriteKey));
    let changed = false;
    for (const identity of identities) {
      const key = favoriteKey(identity);
      if (keys.has(key)) continue;
      keys.add(key);
      list.push(identity);
      changed = true;
    }
    if (!changed) return;
    writeFavorites(list);
    favoriteSet = keys;
    notifyFavoriteListeners();
  },

  removeFavorite(identity: SongIdentity): void {
    const list = readFavorites();
    const filtered = list.filter((x) => !identityMatch(x, identity));
    if (filtered.length !== list.length) {
      writeFavorites(filtered);
      favoriteSet?.delete(favoriteKey(identity));
      notifyFavoriteListeners();
    }
  },

  clearSource(source: SongSource): void {
    const list = readFavorites();
    const filtered = list.filter((item) => item.source !== source);
    if (filtered.length !== list.length) {
      writeFavorites(filtered);
      favoriteSet = new Set(filtered.map(favoriteKey));
      notifyFavoriteListeners();
    }
  },

  replaceSource(source: SongSource, identities: SongIdentity[]): void {
    const list = readFavorites();
    const current = new Set(list.filter((item) => item.source === source).map(favoriteKey));
    const replacement = new Map(
      identities.filter((item) => item.source === source).map((item) => [favoriteKey(item), item])
    );
    if (current.size === replacement.size && [...current].every((key) => replacement.has(key)))
      return;
    const next = [...list.filter((item) => item.source !== source), ...replacement.values()];
    writeFavorites(next);
    refreshFavoriteCache();
    notifyFavoriteListeners();
  },

  isFavorite(identity: SongIdentity): boolean {
    if (!favoriteSet) refreshFavoriteCache();
    return favoriteSet!.has(favoriteKey(identity));
  },

  refreshFavoriteCache(): void {
    refreshFavoriteCache();
    notifyFavoriteListeners();
  },

  subscribe(listener: () => void): () => void {
    favoriteListeners.add(listener);
    return () => favoriteListeners.delete(listener);
  }
};

// ── HistoryService ──

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHistory(list: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

export const HistoryService = {
  record(entry: HistoryEntry): void {
    const list = readHistory();
    // Deduplicate same identity
    const filtered = list.filter((x) => !identityMatch(x.identity, entry.identity));
    filtered.unshift(entry);
    if (filtered.length > HISTORY_MAX) filtered.length = HISTORY_MAX;
    writeHistory(filtered);
  },

  getHistory(): HistoryEntry[] {
    return readHistory();
  },

  clearHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
  }
};
