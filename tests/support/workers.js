/*
 * Lets node --test import the Worker's server modules: "cloudflare:workers"
 * resolves to the fake below, and JSON imports get their import attribute.
 * Import this file before any server module (await import() them after).
 *
 * env: set the bindings a test needs (DATA_CACHE: fakeKv(), a rate limiter…).
 */
import { registerHooks } from "node:module";

const STUB = new URL(import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: STUB, shortCircuit: true };
    const resolved = next(specifier, context);
    return resolved.url.endsWith(".json") ? { ...resolved, importAttributes: { type: "json" } } : resolved;
  }
});

export const env = {};
export const waitUntil = (promise) => promise.catch(() => {});

// A Workers KV namespace in memory: get(key) / get(key, "json") and put(key, text).
export function fakeKv(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    async get(key, type) {
      const v = store.get(key) ?? null;
      return v != null && type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); }
  };
}
