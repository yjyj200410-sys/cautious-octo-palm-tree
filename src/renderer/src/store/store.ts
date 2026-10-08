import { Store } from '@tanstack/store';
import { cloneDeep } from 'es-toolkit/object';

import {
  type AppReducer,
  type AppReducerStateActions,
  DEFAULT_REDUCER_DATA,
  reducer as appReducer
} from '../other/appReducer';
import storage from '../utils/localStorage';
// import hasDataChanged from '../utils/hasDataChanged';

export const store = new Store(DEFAULT_REDUCER_DATA);

type StoreSubscriptionState =
  | AppReducer
  | {
      currentVal?: AppReducer;
      prevVal?: AppReducer;
    };

const getCurrentStoreState = (subscriptionState: StoreSubscriptionState): AppReducer => {
  if ('currentVal' in subscriptionState && subscriptionState.currentVal) {
    return subscriptionState.currentVal;
  }

  return subscriptionState as AppReducer;
};

export const dispatch = (options: AppReducerStateActions) => {
  store.setState((state) => {
    return appReducer(state, options);
  });
};

// 必须在 dispatch 定义之后调用，否则 resetLocalStorage 访问 dispatch 会触发 TDZ
// ReferenceError，导致 localStorage 重置失败、store 状态初始化不完整。
storage.checkLocalStorage();

export const reducer = () => {
  return { state: store.state, dispatch };
};

dispatch({
  type: 'UPDATE_LOCAL_STORAGE',
  data: storage.getLocalStorage()
});

// 每次 store 变化都 cloneDeep 整个状态 + console.debug，在频繁 dispatch 时
// 会严重拖慢 dev 模式（尤其 DevTools 打开时）。默认关闭；
// 需要调试时在 localStorage 设 debugStoreChanges=1 再刷新即可恢复。
const DEBUG_STORE_CHANGES =
  typeof localStorage !== 'undefined' && localStorage.getItem('debugStoreChanges') === '1';

store.subscribe((state) => {
  const currentState = getCurrentStoreState(state as StoreSubscriptionState);

  if (!currentState?.localStorage) {
    return;
  }

  storage.setLocalStorage(currentState.localStorage);

  // const modified = hasDataChanged(state.prevVal, state.currentVal);
  // const onlyModified = Object.groupBy(
  //   Object.entries(modified),
  //   ([, value]) => `${value.isModified}`
  // );

  if (DEBUG_STORE_CHANGES) {
    console.debug('store state changed:', cloneDeep(currentState));
  }
});
