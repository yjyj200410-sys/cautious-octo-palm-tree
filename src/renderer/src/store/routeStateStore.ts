import hasDataChanged from '@renderer/utils/hasDataChanged';
import { Store } from '@tanstack/react-store';

type RouteStateSubscriptionState =
  | RouteStates
  | {
      currentVal?: RouteStates;
      prevVal?: RouteStates;
    };

const getSubscriptionState = (state: RouteStateSubscriptionState) => {
  if ('currentVal' in state && 'prevVal' in state) {
    return {
      currentVal: state.currentVal || DEFAULT_ROUTE_STATE_DATA,
      prevVal: state.prevVal || DEFAULT_ROUTE_STATE_DATA
    };
  }

  return {
    currentVal: state,
    prevVal: DEFAULT_ROUTE_STATE_DATA
  };
};

export const DEFAULT_ROUTE_STATE_DATA: RouteStates = {
  'lyrics-editor': {
    songId: 0,
    lyrics: []
  },
  // 阶段 2 + 阶段 4:LibraryPanel 常驻主内容区域(喜欢的音乐/每日推荐/我的歌单/推荐歌单)。
  // 阶段 4 起不再有 isOpen——面板始终渲染,kind/id 决定展示哪个歌单,切换只替换内容。
  'library-panel': {
    kind: null
  }
};

export const routeStateStore = new Store(DEFAULT_ROUTE_STATE_DATA);

export const updateRouteState = <T extends Routes>(route: T, data: RouteStates[T]) =>
  routeStateStore.setState((state) => ({ ...state, [route]: data }));

/** 更新 LibraryPanel 内容(kind 为 null 时显示占位;id 缺省用于 favorites/daily 等固定集合;
 *  title/cover 由阶段 4 Task 4 带入——Header 立即显示,不等歌单详情接口) */
export const setLibraryPanel = (opts: {
  kind: LibraryPanelRouteState['kind'];
  id?: number;
  title?: string;
  cover?: string;
}) => updateRouteState('library-panel', { kind: opts.kind, id: opts.id, title: opts.title, cover: opts.cover });

routeStateStore.subscribe((state) => {
  const { prevVal, currentVal } = getSubscriptionState(state as RouteStateSubscriptionState);
  const modified = hasDataChanged(prevVal, currentVal);
  const onlyModified = Object.groupBy(
    Object.entries(modified),
    ([, value]) => `${value.isModified}`
  );

  if (window.api.properties.isInDevelopment) {
    console.debug('route store state changed:', currentVal, 'modified:', onlyModified['true']);
  }
});
