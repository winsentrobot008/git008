/** 极简响应式 store（~30 行），避免为零构建前端引入框架。 */

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      subs.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      subs.add(fn);
      fn(state, null);
      return () => subs.delete(fn);
    },
  };
}