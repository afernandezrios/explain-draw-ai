/**
 * How big a line of text has to be to fit in its box.
 *
 * A title card is the one scene whose copy is written before its layout is
 * known: an author (or a model) hands over a phrase and the card has to place
 * it without spilling off the canvas. Measuring the DOM would mean a ref, a
 * `delayRender` and a frame rendered twice -- the same cost `Frame` refuses to
 * pay for its content box -- so the width is *estimated* from the glyph count
 * instead: `advance` times the font size times the characters in the word.
 *
 * The estimate is deliberately a little wide. A face's real advances average
 * under 0.55em for mixed-case English, and `ADVANCE` sits above that, so the
 * text is fitted slightly early rather than slightly late. Being early costs a
 * few pixels of type size; being late costs a word hanging off the canvas.
 *
 * Pure and React-free, like the rest of `lib/`: a scene asks how big its title
 * should be on the first frame, with no measurement and no second pass.
 */

/**
 * The average glyph advance as a fraction of the font size, per type size.
 *
 * Weight is why there are two: a display title is set at 700 and runs wider per
 * character than a 500 subheading. Uppercase and digits push a string above
 * these averages, which is the direction that shrinks text rather than
 * overflows it.
 */
export const ADVANCE = {
  display: 0.58,
  subheading: 0.54,
} as const;

export type FitOptions = {
  /** The widest a line may be, in pixels. */
  maxWidth: number;
  /** The most lines the block may occupy before the size drops. */
  maxLines: number;
  /** The size to use when the text already fits; the search starts here. */
  size: number;
  /** The floor the search stops at. Text too long even for this is the caller's
   * problem to clamp -- a title smaller than the floor is not a title. */
  minSize: number;
  /** Average glyph advance as a fraction of the size. See `ADVANCE`. */
  advance: number;
  /** How much the size drops between tries. */
  step?: number;
};

/**
 * How many lines `text` takes at `size`, wrapping greedily on spaces.
 *
 * A word wider than the box is counted as one line rather than infinitely
 * many: the box cannot split a word, so shrinking cannot fix it, and a caller
 * that keeps shrinking would walk to `minSize` for nothing. Callers that care
 * about that case clamp the overflow instead.
 */
export function estimatedLineCount(
  text: string,
  size: number,
  maxWidth: number,
  advance: number,
): number {
  const charWidth = size * advance;
  let lines = 0;

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      // An empty line is a deliberate break, and it still costs a line.
      lines += 1;
      continue;
    }
    let paragraphLines = 1;
    let used = 0;
    for (const word of words) {
      const width = word.length * charWidth;
      if (used === 0) {
        used = width;
        continue;
      }
      if (used + charWidth + width <= maxWidth) {
        used += charWidth + width;
      } else {
        paragraphLines += 1;
        used = width;
      }
    }
    lines += paragraphLines;
  }

  return Math.max(1, lines);
}

/**
 * The largest size, at or below `size` and at or above `minSize`, at which the
 * text occupies no more than `maxLines` lines of `maxWidth` pixels.
 *
 * Sizes are tried from the top down in `step`-sized drops, so the result is
 * stable for a given string: the same title always gets the same size, on
 * every frame and in every render.
 */
export function fitFontSize(text: string, options: FitOptions): number {
  const { maxWidth, maxLines, size, minSize, advance, step = 4 } = options;
  for (let candidate = size; candidate > minSize; candidate -= step) {
    if (estimatedLineCount(text, candidate, maxWidth, advance) <= maxLines) {
      return candidate;
    }
  }
  return minSize;
}
