/*
 * The schools picked to compare, kept in this browser so picks on the browse
 * page, a school page and the compare page agree: [{ dbn, name }], at most
 * MAX_COMPARE, oldest first. Storage can be blocked (private windows), so
 * every read and write falls back to memory for this page.
 */
import { normalizeDbn } from "./config.js";
import { MAX_COMPARE } from "./compare.js";

const KEY = "sq-compare";
let memory = [];

const clean = (list) => {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const dbn = normalizeDbn(item?.dbn);
    if (dbn && !out.some((x) => x.dbn === dbn)) out.push({ dbn, name: String(item.name ?? dbn) });
  }
  return out.slice(-MAX_COMPARE);
};

export function readShortlist() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    return memory;
  }
}

export function writeShortlist(list) {
  memory = clean(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // memory only
  }
  return memory;
}
