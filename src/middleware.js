/*
 * Security headers on every response the Worker renders (on-demand pages and
 * API routes). Static files skip the Worker; public/_headers covers those.
 * Geolocation stays allowed for this site: "Near me" on several dashboards.
 */
import { defineMiddleware } from "astro:middleware";

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=()"
};

function addHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

// Pages live at their trailing-slash URL (the canonical); "/city-jobs" sends
// you there. API routes, files ("/sitemap.xml") and Astro's own "/_" routes
// keep their paths. Static pages get the same from Cloudflare's assets.
export function slashRedirect(url, method) {
  if (method !== "GET" && method !== "HEAD") return null;
  const path = url.pathname;
  if (path.endsWith("/") || path.startsWith("/api/") || path.startsWith("/_")) return null;
  if (path.slice(path.lastIndexOf("/")).includes(".")) return null;
  return path + "/" + url.search;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const to = slashRedirect(context.url, context.request.method);
  let response = to
    ? new Response(null, { status: 301, headers: { Location: to } })
    : await next();
  try {
    addHeaders(response.headers);
  } catch {
    // Immutable headers (Response.redirect(), a fetched response): copy it.
    response = new Response(response.body, response);
    addHeaders(response.headers);
  }
  return response;
});
