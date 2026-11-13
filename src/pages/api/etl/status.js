/*
 * GET /api/etl/status
 * Where every dashboard's data stands: each dataset's last source update,
 * schedule and jobs (when each was built, whether it's current, the last
 * error), and which build-time snapshots need a refresh. `ok` is false and
 * `attention` lists why when something needs a look. See src/lib/server/etl.js.
 *
 * Reads one KV entry the scheduled refresh writes, so it needs no rate limit.
 */
import { etlStatus } from "../../../lib/server/etl.js";
import { json } from "../../../lib/server/json.js";

export const prerender = false;

const MAX_AGE = 300;

export async function GET() {
  try {
    return json(await etlStatus(), { maxAge: MAX_AGE });
  } catch (err) {
    console.error(err);
    return json({ error: "unavailable" }, { status: 500 });
  }
}
