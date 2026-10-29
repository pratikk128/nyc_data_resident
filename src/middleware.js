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

export const onRequest = defineMiddleware(async (_context, next) => {
  let response = await next();
  try {
    addHeaders(response.headers);
  } catch {
    // Immutable headers (Response.redirect(), a fetched response): copy it.
    response = new Response(response.body, response);
    addHeaders(response.headers);
  }
  return response;
});
