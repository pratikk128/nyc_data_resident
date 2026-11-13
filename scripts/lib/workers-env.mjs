/*
 * Runs the Worker's server modules in Node for scripts/run-etl.mjs:
 * "cloudflare:workers" resolves to this file, JSON imports get their import
 * attribute, and the bindings the ETL uses are backed by wrangler, so the
 * same code that used to run in the cron writes to the real KV and D1.
 *
 *   DATA_CACHE  reads with `wrangler kv key get`; writes are kept in memory
 *               (later reads see them) and sent in one `wrangler kv bulk put`
 *               by flush()
 *   CRASHES_DB  reads with `wrangler d1 execute --json`; writes (batch, run)
 *               are queued in order and sent as one SQL file before the next
 *               read and by flush()
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
const D1_NAME = "asknycdata-crashes"; // wrangler.jsonc → d1_databases

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

function kvNamespace(target) {
  const ns = process.env.KV_NAMESPACE_ID ? ["--namespace-id", process.env.KV_NAMESPACE_ID] : ["--binding", "DATA_CACHE"];
  const written = new Map(); // key → { value, expiration_ttl }
  const read = new Map();    // key → text or null, so a key is fetched once per run
  const text = (key) => {
    if (written.has(key)) return written.get(key).value;
    if (!read.has(key)) {
      const out = wrangler(["kv", "key", "get", key, ...ns, target, "--text"]);
      read.set(key, out === "Value not found\n" || out === "Value not found" ? null : out);
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

// A SQL literal for a bound parameter (wrangler's --command and --file take no parameters).
const literal = (v) => {
  if (v == null) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number" || typeof v === "bigint") {
    if (!Number.isFinite(Number(v))) throw new Error(`Can't bind ${v}`);
    return String(v);
  }
  return `'${String(v).replaceAll("'", "''")}'`;
};

function inline(sql, params) {
  let i = 0;
  const out = sql.replace(/\?|'(?:[^']|'')*'/g, (m) => (m === "?" ? literal(params[i++]) : m));
  if (i !== params.length) throw new Error(`${params.length} parameters for ${i} placeholders: ${sql}`);
  return out;
}

function d1Database(target) {
  const queue = [];
  const flush = () => {
    if (!queue.length) return 0;
    const file = join(tmp, "d1.sql");
    writeFileSync(file, queue.map((s) => `${s.trim().replace(/;$/, "")};\n`).join(""));
    wrangler(["d1", "execute", D1_NAME, target, "--yes", `--file=${file}`]);
    const n = queue.length;
    queue.length = 0;
    return n;
  };
  const statement = (sql, params = []) => ({
    get sql() { return inline(sql, params); },
    bind: (...p) => statement(sql, p),
    async all() {
      flush();
      const [result] = JSON.parse(wrangler(["d1", "execute", D1_NAME, target, "--json", `--command=${inline(sql, params)}`]));
      return { results: result?.results ?? [], success: true, meta: result?.meta ?? {} };
    },
    async first() { return (await this.all()).results[0] ?? null; },
    async run() { queue.push(inline(sql, params)); return { success: true, meta: {} }; }
  });
  return {
    flush,
    prepare: (sql) => statement(sql),
    async batch(statements) { for (const s of statements) queue.push(s.sql); return statements.map(() => ({ success: true })); }
  };
}

let kv, d1;
export function connect(target) {
  if (target !== "--remote" && target !== "--local") throw new Error("connect() takes --remote or --local");
  env.DATA_CACHE = kv = kvNamespace(target);
  env.CRASHES_DB = d1 = d1Database(target);
}

// Waits for background work, then sends the queued D1 statements and KV writes.
export async function flush() {
  while (pending.size) await Promise.all(pending);
  const statements = d1?.flush() ?? 0;
  const keys = kv?.flush() ?? 0;
  return { statements, keys };
}
