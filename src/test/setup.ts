import "@testing-library/jest-dom/vitest";

const memoryStorage = new Map<string, string>();

const localStorageMock: Storage = {
  get length() {
    return memoryStorage.size;
  },
  clear: () => memoryStorage.clear(),
  getItem: (key) => memoryStorage.get(key) ?? null,
  key: (index) => Array.from(memoryStorage.keys())[index] ?? null,
  removeItem: (key) => memoryStorage.delete(key),
  setItem: (key, value) => memoryStorage.set(key, value)
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true
});

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true
});

Object.defineProperty(URL, "createObjectURL", {
  value: () => "blob:kunochat-test",
  configurable: true
});

Object.defineProperty(URL, "revokeObjectURL", {
  value: () => undefined,
  configurable: true
});
