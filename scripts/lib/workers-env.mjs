/*
 * Runs the Worker's server modules in Node for scripts/run-etl.mjs:
 * "cloudflare:workers" resolves to this file, JSON imports get their import
 * attribute, and DATA_CACHE is backed by wrangler, so the same code that
 * used to run in the cron writes to the real KV: reads use
 * `wrangler kv key get`; writes are kept in memory (later reads see them) and
 * sent in one `wrangler kv bulk put` by flush().
 *
 * Import this file before any server module (await import() them after),
 * then call connect(target), where target is "--remote" or "--local" (the
 * state `astro dev` reads, .wrangler/state).
 *
 * KV_NAMESPACE_ID picks the namespace; without it wrangler resolves the
 * DATA_CACHE binding in wrangler.jsonc.
 */
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SELF = new URL(import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: SELF, shortCircuit: true };
    const resolved = next(specifier, context);
    return resolved.url.endsWith(".json") ? { ...resolved, importAttributes: { type: "json" } } : resolved;
  }
});

export const env = { ...process.env };

// Promises the modules hand to waitUntil(); flush() waits for them.
const pending = new Set();
export function waitUntil(promise) {
  const p = Promise.resolve(promise).catch((err) => console.warn(`waitUntil: ${err.message}`));
  pending.add(p);
  p.finally(() => pending.delete(p));
}

const tmp = mkdtempSync(join(tmpdir(), "asknycdata-etl-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

// A missing key: --local prints "Value not found"; --remote fails with a 404.
function getText(args) {
  try {
    const out = execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return out === "Value not found\n" || out === "Value not found" ? null : out;
  } catch (err) {
    if (/404: Not Found/.test(err.stderr ?? "")) return null;
    process.stderr.write(err.stderr ?? "");
    throw err;
  }
}

function kvNamespace(target) {
  const ns = process.env.KV_NAMESPACE_ID ? ["--namespace-id", process.env.KV_NAMESPACE_ID] : ["--binding", "DATA_CACHE"];
  const written = new Map(); // key → { value, expiration_ttl }
  const read = new Map();    // key → text or null, so a key is fetched once per run
  const text = (key) => {
    if (written.has(key)) return written.get(key).value;
    if (!read.has(key)) {
      read.set(key, getText(["kv", "key", "get", key, ...ns, target, "--text"]));
    }
    return read.get(key);
  };
  return {
    written,
    async get(key, type) {
      const v = text(key);
      return v != null && type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value, options = {}) {
      written.set(key, { value: String(value), ...(options.expirationTtl ? { expiration_ttl: options.expirationTtl } : {}) });
    },
    flush() {
      if (!written.size) return 0;
      const file = join(tmp, "kv.json");
      writeFileSync(file, JSON.stringify([...written].map(([key, v]) => ({ key, ...v }))));
      wrangler(["kv", "bulk", "put", file, ...ns, target]);
      const n = written.size;
      for (const [key, v] of written) read.set(key, v.value);
      written.clear();
      return n;
    }
  };
}

let kv;
export function connect(target) {
  if (target !== "--remote" && target !== "--local") throw new Error("connect() takes --remote or --local");
  env.DATA_CACHE = kv = kvNamespace(target);
}

// Waits for background work, then sends the queued KV writes.
export async function flush() {
  while (pending.size) await Promise.all(pending);
  return { keys: kv?.flush() ?? 0 };
}
