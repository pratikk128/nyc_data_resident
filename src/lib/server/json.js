/* JSON responses for the API routes. maxAge sets browser and CDN caching. */
export function json(data, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store"
    }
  });
}

// Upstream (Socrata) failures: log the detail, tell the browser only what it needs.
export function upstreamError(err) {
  console.error(err);
  return json({ error: "upstream" }, { status: 502 });
}
