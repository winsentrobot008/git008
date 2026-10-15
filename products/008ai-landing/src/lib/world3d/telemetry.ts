/**
 * world3d trace instrumentation.
 *
 * `?trace=1` turns the recorder on for one page load: the artifact transport, the
 * PLY parser and the render loop each append a record, and a frame watch counts
 * the frames that overran the budget. That is what turns "the scene takes a while
 * to appear" into three numbers - network, parse, upload - instead of a guess.
 *
 * With the flag off every call site costs one cached boolean test: no timers, no
 * allocation, nothing that could show up in a profile of the normal path.
 */

/** A measurement or a bare event, in the order it happened. */
export interface TraceRecord {
  /** Milliseconds since the recorder started. */
  at: number;
  scope: string;
  label: string;
  ms?: number;
  data?: Record<string, number | string>;
}

export interface TraceSummary {
  enabled: boolean;
  frames: number;
  droppedFrames: number;
  worstFrameMs: number;
  records: number;
  totals: Record<string, number>;
}

/** A frame slower than this is the one the visitor noticed. */
const FRAME_BUDGET_MS = 20;
const MAX_RECORDS = 400;

let flag: boolean | null = null;
let origin = 0;
let records: TraceRecord[] = [];
const totals = new Map<string, number>();
let frames = 0;
let droppedFrames = 0;
let worstFrameMs = 0;

const clock = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Reads the flag once per load, from the query string only. Never from anything a
 * visitor could not have typed themselves, so enabling it is always deliberate.
 */
export function traceEnabled(): boolean {
  if (flag !== null) return flag;
  flag = false;
  if (typeof window !== "undefined") {
    try {
      flag = new URLSearchParams(window.location.search).get("trace") === "1";
    } catch {
      flag = false;
    }
  }
  if (flag) {
    origin = clock();
    (window as unknown as { world3dTrace?: unknown }).world3dTrace = {
      summary: traceSummary,
      report: reportTrace,
    };
  }
  return flag;
}

/** Brackets a slow step; the returned function records the elapsed time. */
export function traceStep(scope: string, label: string): () => void {
  if (!traceEnabled()) return () => undefined;
  const started = clock();
  return () => traceMeasure(scope, label, clock() - started);
}

export function traceMeasure(
  scope: string,
  label: string,
  ms: number,
  data?: Record<string, number | string>
): void {
  if (!traceEnabled()) return;
  push({ at: clock() - origin, scope, label, ms: Math.round(ms * 100) / 100, data });
  bump(`${scope}.${label}`);
}

export function traceMark(
  scope: string,
  label: string,
  data?: Record<string, number | string>
): void {
  if (!traceEnabled()) return;
  push({ at: clock() - origin, scope, label, data });
}

/** Counted rather than timed: the tallies that answer "how many, in total". */
export function traceCounter(key: string, by = 1): void {
  if (!traceEnabled()) return;
  bump(key, by);
}

/**
 * One animation frame. `dropped` is a budget miss, not a missed vsync - the point
 * is to catch the frames a buffer upload or a paging fault stretched out.
 */
export function traceFrame(frameMs: number): void {
  if (!traceEnabled()) return;
  frames += 1;
  if (frameMs > worstFrameMs) worstFrameMs = frameMs;
  if (frameMs > FRAME_BUDGET_MS) {
    droppedFrames += 1;
    push({ at: clock() - origin, scope: "render", label: "frame-over-budget", ms: Math.round(frameMs * 100) / 100 });
  }
}

export function traceSummary(): TraceSummary {
  const out: Record<string, number> = {};
  for (const [key, value] of totals) out[key] = value;
  return {
    enabled: traceEnabled(),
    frames,
    droppedFrames,
    worstFrameMs: Math.round(worstFrameMs * 100) / 100,
    records: records.length,
    totals: out,
  };
}

/** Prints the tallies and the slowest records. The whole point of the recorder. */
export function reportTrace(): void {
  if (typeof console === "undefined") return;
  const summary = traceSummary();
  console.group("[world3d] trace");
  console.table(summary.totals);
  console.log(
    `frames ${summary.frames}, over ${FRAME_BUDGET_MS} ms ${summary.droppedFrames}, ` +
      `worst ${summary.worstFrameMs} ms`
  );
  if (summary.records) console.table(records.slice(-40));
  console.groupEnd();
}

/** Callers that would rather build a record lazily check the flag first. */
export function traceOn(): boolean {
  return traceEnabled();
}

function push(record: TraceRecord): void {
  records.push(record);
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
}

function bump(key: string, by = 1): void {
  totals.set(key, (totals.get(key) ?? 0) + by);
}
