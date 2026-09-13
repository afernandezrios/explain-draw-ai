/**
 * When each shape is drawn.
 *
 * A scene leaves a beat before the first stroke and a beat after the last, then
 * spreads the shapes across everything in between. The slots are computed from
 * the index rather than accumulated from a rounded per-step span, because
 * accumulating rounding is how the final shape ends up starting after the last
 * frame and never appearing at all.
 *
 * In frames; `end` is exclusive.
 */

export const DRAW_LEAD_IN_RATIO = 0.08;
export const DRAW_LEAD_OUT_RATIO = 0.1;

export type DrawWindow = {
  start: number;
  end: number;
};

export function drawWindows(shapeCount: number, durationInFrames: number): DrawWindow[] {
  if (shapeCount <= 0) {
    return [];
  }
  const first = Math.round(durationInFrames * DRAW_LEAD_IN_RATIO);
  const last = Math.max(first + 1, durationInFrames - Math.round(durationInFrames * DRAW_LEAD_OUT_RATIO));
  const span = Math.max(1, last - first);

  const windows: DrawWindow[] = [];
  for (let i = 0; i < shapeCount; i++) {
    const start = first + Math.floor((i * span) / shapeCount);
    // The last shape's slot lands exactly on `last`, so every shape both starts
    // and finishes inside the draw window.
    const end = Math.max(first + Math.floor(((i + 1) * span) / shapeCount), start + 1);
    windows.push({ start, end });
  }
  return windows;
}
