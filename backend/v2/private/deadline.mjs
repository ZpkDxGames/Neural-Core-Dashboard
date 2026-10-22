import { AsyncLocalStorage } from "node:async_hooks";
import { fail } from "../note.mjs";
export const privateRequestScope = new AsyncLocalStorage();
export function checkDeadline() {
  const at = privateRequestScope.getStore()?.deadlineAt;
  if (at !== undefined && Date.now() >= at)
    fail("PRIVATE_REQUEST_TIMEOUT", 503);
}
export function guardedDatabase(db) {
  return {
    async query(...args) {
      checkDeadline();
      const value = await db.query(...args);
      checkDeadline();
      return value;
    },
  };
}
export async function boundedDependency(fn, maxMs = 2000) {
  checkDeadline();
  const remaining =
      (privateRequestScope.getStore()?.deadlineAt ?? Date.now() + maxMs) -
      Date.now(),
    controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(Error("PRIVATE_DEPENDENCY_TIMEOUT"));
          },
          Math.max(1, Math.min(maxMs, remaining)),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
