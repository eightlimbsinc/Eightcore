import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * How deep in an automation chain the current work is: 0 for a person's action, 1 for what an
 * automation did because of it, and so on. Events written meanwhile carry it (loop guard).
 */
const depth = new AsyncLocalStorage<number>();

export const causationDepth = () => depth.getStore() ?? 0;

export function withCausationDepth<T>(value: number, fn: () => Promise<T>): Promise<T> {
  return depth.run(value, fn);
}
