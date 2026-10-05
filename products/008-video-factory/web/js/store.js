/** 极简响应式 store（~30 行），避免为零构建前端引入框架。 */

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      subs.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
  };
}