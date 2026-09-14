// Process-wide singletons.
//
// Next.js can bundle the same module into several server layers (Server
// Actions, Route Handlers, instrumentation). Each bundle gets its own module
// scope, so plain module-level `let` state (the write lock, the database
// connection, the backup scheduler, the unlocked backup key) could silently
// exist more than once in one process. Keeping that state on globalThis
// guarantees exactly one copy.

type Registry = Record<string, unknown>;

export function singleton<T>(key: string, create: () => T): T {
  const g = globalThis as typeof globalThis & { __chuti?: Registry };
  const registry = (g.__chuti ??= {});
  if (!(key in registry)) registry[key] = create();
  return registry[key] as T;
}
