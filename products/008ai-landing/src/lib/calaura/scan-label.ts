/**
 * scan-label - one shared label for every photo-scan surface.
 *
 * A photo of a shared table comes back as several items. Leading the bubble or
 * the hand-off card with a single dish is what made a dim sum spread read as one
 * basket of buns, and a mixed rice table read as one fried-rice plate.
 *
 * When the backend reports more than one item the label becomes a counted
 * summary of the biggest contributors, and the caller keeps showing the plate
 * total beside it. Locale-neutral by design: every literal, including the list
 * separator, comes from the dictionary, so the EN view never renders CJK.
 */

import type { FoodScanItem } from "@/types/health-bus";

/** How many dish names the summary spells out before it stops listing. */
const MAX_LISTED_DISHES = 3;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Biggest contributor first, so the summary leads with the main dish. */
function byCaloriesDesc(a: FoodScanItem, b: FoodScanItem): number {
  return b.calories - a.calories;
}

/**
 * Label for a scan: the dish name when there is exactly one, otherwise a
 * counted multi-dish summary. Falls back to the total label for an empty scan.
 */
export function scanLabel(
  items: FoodScanItem[],
  t: Translate,
  fallbackKey = "cal.totalLabel"
): string {
  if (items.length === 0) return t(fallbackKey);
  if (items.length === 1) return items[0].name;
  const listed = [...items]
    .sort(byCaloriesDesc)
    .slice(0, MAX_LISTED_DISHES)
    .map((item) => item.name)
    .join(t("cal.multiDishSeparator"));
  return t("cal.multiDishSummary", { items: listed, count: items.length });
}
