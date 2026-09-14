/**
 * bestie-lines - the warm encouragement bank behind the CALauraAI note cards.
 *
 * One small, operator-run catalogue per moment in the loop. Every line is
 * positive and habit-focused: it lifts the choice, then points at the next
 * graceful step. Nothing here is a punishment, a debt, or a judgement about the
 * person - that rule is what makes the merged product feel like a bestie.
 *
 * React-free and fetch-free like lib/shared/health-bus.ts, so both halves of the
 * loop and the route handlers can import it.
 */

export type NoteCategory =
  | "MEAL_GENEROUS"
  | "MEAL_LIGHT_CHOICE"
  | "MOVEMENT_PAUSE"
  | "MOVEMENT_COMPLETE";

/** The shipped catalogue. Pure data: no I/O, no side effects. */
export const BESTIE_NOTES: Record<NoteCategory, readonly string[]> = {
  MEAL_GENEROUS: [
    "That was a full, joyful plate - and joy counts. A ten-minute walk later keeps the day elegant.",
    "Lovely meal. Big energy days are part of the rhythm; let us give it somewhere graceful to go.",
    "You enjoyed it properly. Log it, smile, and let a little movement round out the shape of the day.",
    "Generous portions, generous mood. One easy session and the silhouette stays exactly as sleek as you like it.",
  ],
  MEAL_LIGHT_CHOICE: [
    "That plate looks fresh and light - exactly the kind of choice that keeps energy even all afternoon.",
    "Beautifully light. You have room to enjoy something you love later, guilt-free.",
    "A clean, bright plate. This is the rhythm your future self is quietly thanking you for.",
    "So fresh. Keep the water close and the next meal just as lovely.",
  ],
  MOVEMENT_PAUSE: [
    "Rest is part of shaping too. Ten easy minutes whenever you are ready - no rush, no pressure.",
    "A pause is not a setback. When you feel like it, one graceful loop brings the day right back.",
    "Your body is asking for a moment. Honour that, then we will move together when it feels good.",
    "Nothing lost. The prettiest progress is the kind you come back to gently.",
  ],
  MOVEMENT_COMPLETE: [
    "That was lovely work - strong, graceful, and finished. Note how good your posture feels right now.",
    "Beautiful session. You showed up for yourself today, and that is the whole point.",
    "Look at that - done. Your future self just added this to the highlight reel.",
    "Elegant effort, well spent. A little water, a little stretch, and enjoy the glow.",
  ],
};

/**
 * Deterministic pick so the server markup and the first client render agree, and
 * so re-rolling shows the same line (the card passes a nonce to move on).
 */
export function pickBestieNote(category: NoteCategory, nonce = 0): string {
  const lines = BESTIE_NOTES[category];
  if (!lines || lines.length === 0) return "";
  const index = Math.abs(Math.floor(nonce)) % lines.length;
  return lines[index];
}
