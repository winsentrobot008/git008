/**
 * POST /api/aura-fit/tts
 *
 * Canonical Aura Fit speech endpoint, re-exporting the long-standing
 * /api/savage-fit/tts handler so both URL namespaces stay in sync.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export { POST } from "@/app/api/savage-fit/tts/route";
