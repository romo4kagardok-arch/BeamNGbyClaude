// localStorage wrapper that never throws (private windows, blocked storage, sandboxed frames).
export function storeGet(key, fallback = null) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function storeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

export function storeJSON(key, fallback) {
  try {
    const v = JSON.parse(storeGet(key, 'null'));
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
