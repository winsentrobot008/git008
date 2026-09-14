/**
 * POST /api/aura-cal/recognize
 *
 * Canonical Calorie Bestie intake-recognition bridge (products/calorieai).
 * Re-exports the long-standing /api/savage-cal/recognize handler so the merged
 * app calls one brand-consistent URL while the legacy route keeps working.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

export { POST } from "@/app/api/savage-cal/recognize/route";
