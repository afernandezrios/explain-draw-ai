/**
 * How wide a run of handwriting will be, measured in Node.
 *
 * The layout pass (`layout.ts`) has to know a label's width before it can
 * centre it in a box, shrink it to fit, or run an underline under it -- and it
 * has to know that at generation time, in a plain Node process, where nothing
 * has the font loaded and there is no text engine to ask. So the advances are
 * measured once, off the same bundled face the app embeds (see `FONT_FILE` in
 * `board.ts`), and checked in as a table.
 *
 * Units are em: a glyph's width divided by the font size. That makes the table
 * independent of how big the label is drawn, which is the only way one table
 * serves both a size-4 caption and a size-14 title.
 *
 * Two honest limits:
 *
 *  - Kerning is not applied. The table is a sum of per-glyph advances, while a
 *    browser also applies the face's `kern`/GPOS pairs. The face's pairs are
 *    mostly slight, and every one of them makes real text *narrower* than this
 *    function reports, so text is laid out with a little room to spare rather
 *    than overrunning. Erring wide is the safe direction for fitting.
 *  - A character outside the table falls back to `FALLBACK_WIDTH_EM`, a plain
 *    guess. The table covers printable ASCII plus the typographic punctuation
 *    models actually emit; anything else is a glyph the prompt never asked for.
 *    The generator deliberately leaves out characters the face has no glyph for
 *    (the arrows and the maths relations, as it happens): a browser draws those
 *    with whatever fallback font the machine has, so their measured widths
 *    describe that machine rather than the bundled face, and baking them in
 *    would make this table depend on where it was generated.
 *
 * Regenerate with `node scripts/generate-font-widths.ts` after replacing the
 * bundled face -- the table below is generated, everything else here is not.
 */

/* BEGIN GENERATED WIDTHS */
export const FONT_WIDTHS: Readonly<Record<string, number>> = {
  '\u0030': 0.6309,
  '\u0031': 0.1279,
  '\u0032': 0.5723,
  '\u0033': 0.5088,
  '\u0034': 0.6807,
  '\u0035': 0.7080,
  '\u0036': 0.6270,
  '\u0037': 0.6152,
  '\u0038': 0.6484,
  '\u0039': 0.5693,
  '\u0020': 0.4004,
  '\u0021': 0.1348,
  '\u0022': 0.2363,
  '\u0023': 0.6377,
  '\u0024': 0.5566,
  '\u0025': 0.5186,
  '\u0026': 0.6699,
  '\u0027': 0.1621,
  '\u0028': 0.2979,
  '\u0029': 0.3516,
  '\u002a': 0.5078,
  '\u002b': 0.5244,
  '\u002c': 0.1777,
  '\u002d': 0.3105,
  '\u002e': 0.1406,
  '\u002f': 0.4551,
  '\u003a': 0.1670,
  '\u003b': 0.1240,
  '\u003c': 0.4756,
  '\u003d': 0.4922,
  '\u003e': 0.4717,
  '\u003f': 0.5059,
  '\u0040': 1.0430,
  '\u0041': 0.6406,
  '\u0042': 0.7109,
  '\u0043': 0.7080,
  '\u0044': 0.6484,
  '\u0045': 0.5918,
  '\u0046': 0.6924,
  '\u0047': 0.6924,
  '\u0048': 0.6055,
  '\u0049': 0.1514,
  '\u004a': 0.5293,
  '\u004b': 0.6055,
  '\u004c': 0.6924,
  '\u004d': 0.8271,
  '\u004e': 0.6270,
  '\u004f': 0.6699,
  '\u0050': 0.6377,
  '\u0051': 0.7129,
  '\u0052': 0.7129,
  '\u0053': 0.6426,
  '\u0054': 0.6230,
  '\u0055': 0.5615,
  '\u0056': 0.6270,
  '\u0057': 0.9404,
  '\u0058': 0.5996,
  '\u0059': 0.5342,
  '\u005a': 0.7842,
  '\u005b': 0.4248,
  '\u005c': 0.5020,
  '\u005d': 0.5410,
  '\u005e': 0.3066,
  '\u005f': 0.6865,
  '\u0060': 0.1719,
  '\u0061': 0.5088,
  '\u0062': 0.5615,
  '\u0063': 0.6328,
  '\u0064': 0.5127,
  '\u0065': 0.5410,
  '\u0066': 0.5938,
  '\u0067': 0.5156,
  '\u0068': 0.4951,
  '\u0069': 0.1514,
  '\u006a': 0.1777,
  '\u006b': 0.6143,
  '\u006c': 0.1572,
  '\u006d': 0.7783,
  '\u006e': 0.5000,
  '\u006f': 0.5625,
  '\u0070': 0.5566,
  '\u0071': 0.5137,
  '\u0072': 0.5518,
  '\u0073': 0.5020,
  '\u0074': 0.4043,
  '\u0075': 0.5078,
  '\u0076': 0.5186,
  '\u0077': 0.8086,
  '\u0078': 0.4707,
  '\u0079': 0.5488,
  '\u007a': 0.4951,
  '\u007b': 0.3525,
  '\u007c': 0.1455,
  '\u007d': 0.4785,
  '\u007e': 0.4443,
  '\u00a0': 0.4004,
  '\u2018': 0.1621,
  '\u2019': 0.1621,
  '\u201c': 0.2363,
  '\u201d': 0.2363,
  '\u2013': 0.3105,
  '\u2014': 0.4111,
  '\u2026': 0.4229,
  '\u00d7': 0.4707,
  '\u2022': 0.1924,
  '\u00b0': 0.2197,
  '\u00b1': 0.5244,
  '\u20ac': 0.7949,
  '\u00a3': 0.5391,
};
/* END GENERATED WIDTHS */

/**
 * What an unmeasured character is assumed to cost. Roughly the width of a
 * lowercase letter in this face, so an unmapped glyph is neither free nor
 * given more room than a real one.
 */
export const FALLBACK_WIDTH_EM = 0.5;

/**
 * The width of `text` at `fontSizeEm` scale, in em units -- multiply by the
 * drawn font size to get a length in the same units that size was expressed in.
 *
 * Iterates code points, not UTF-16 units, so a character outside the BMP is
 * measured once rather than twice as two lone surrogates.
 */
export function textWidthEm(text: string): number {
  let total = 0;
  for (const char of text) {
    total += FONT_WIDTHS[char] ?? FALLBACK_WIDTH_EM;
  }
  return total;
}
