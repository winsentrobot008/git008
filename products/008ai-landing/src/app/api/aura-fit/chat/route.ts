/**
 * POST /api/aura-fit/chat
 *
 * Canonical Aura Fit coaching endpoint. The implementation lives in the
 * long-standing /api/savage-fit/chat handler (kept for the release smoke
 * contract); this route re-exports it under the merged product's namespace so
 * every client in the app can call one brand-consistent URL.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export { POST } from "@/app/api/savage-fit/chat/route";
