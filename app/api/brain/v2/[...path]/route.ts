import { loadPrivateBff } from "../../../../../lib/brain/private/runtime.ts";
import { noStore } from "../../../../../lib/auth/owner-core.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function dispatch(req: Request): Promise<Response> {
  try {
    const bff = await loadPrivateBff();
    if (bff) return await bff(req);
  } catch {
    /* Fixed response only. No configuration, claims, exceptions or tokens in logs. */
  }
  const headers = noStore();
  headers.set("Content-Type", "application/json");
  headers.set("Vary", "Cookie");
  return new Response(JSON.stringify({ error: "REMOTE_NOT_CONFIGURED" }), {
    status: 503,
    headers,
  });
}
export const GET = dispatch;
export const POST = dispatch;
