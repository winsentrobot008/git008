/**
 * POST /api/savage-fit/chat - deprecated alias.
 *
 * Kept alive because the post-deploy smoke contract still probes this path; the
 * implementation is the CALauraAI canonical handler. New callers should use
 * /api/calaura/chat.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export { POST } from "@/app/api/calaura/chat/route";
