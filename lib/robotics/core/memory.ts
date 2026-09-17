// Ability memory: a namespaced key/value store that survives between runs so
// abilities can learn. In-process by default (same trade-off as `lib/cart.ts`);
// swap `MemoryBackend` for Redis or SQLite to persist across restarts.

import type { AbilityMemory } from "./types.ts";

export type MemoryBackend = {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
  list(): string[];
};

export function createInMemoryBackend(): MemoryBackend {
  const store = new Map<string, unknown>();
  return {
    read: (key) => store.get(key),
    write: (key, value) => void store.set(key, value),
    remove: (key) => void store.delete(key),
    list: () => Array.from(store.keys()),
  };
}

/** Per-robot memory namespaces keep two robots from overwriting each other. */
export function createMemory(
  namespace: string,
  backend: MemoryBackend = createInMemoryBackend(),
): AbilityMemory {
  const full = (key: string) => `${namespace}:${key}`;
  return {
    get<T>(key: string): T | undefined {
      return backend.read(full(key)) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      backend.write(full(key), value);
    },
    delete(key: string): void {
      backend.remove(full(key));
    },
    keys(prefix = ""): string[] {
      const head = full(prefix);
      return backend
        .list()
        .filter((k) => k.startsWith(head))
        .map((k) => k.slice(namespace.length + 1));
    },
  };
}

/** A process-wide backend so memory persists between runs in one server. */
export const sharedBackend: MemoryBackend = createInMemoryBackend();
