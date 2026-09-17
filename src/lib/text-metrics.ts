/**
 * How wide a run of handwriting will be, measured in Node.
 *
 * The layout pass (`layout.ts`) has to know a label's width before it can
 * centre it in a box, shrink it to fit, or run an underline under it -- and it
 * has to know that at generation time, in a plain Node process, where nothing
 * has the font loaded and there is no text engine to ask. So the advances are
 * measured once, off the same bundled face the app embeds
 * (`public/fonts/caveat-latin-400.woff2`), and checked in as a table.
 *
 * Units are em: a glyph's width divided by the font size. That makes the table
 * independent of how big the label is drawn, which is the only way one table
 * serves both a size-4 caption and a size-14 title.
 *
 * Two honest limits:
 *
 *  - Kerning is not applied. The table is a sum of per-glyph advances, while a
 *    browser also applies the face's `kern`/GPOS pairs. Caveat's pairs are
 *    mostly slight, and every one of them makes real text *narrower* than this
 *    function reports, so text is laid out with a little room to spare rather
 *    than overrunning. Erring wide is the safe direction for fitting.
 *  - A character outside the table falls back to `FALLBACK_WIDTH_EM`, a plain
 *    guess. The table covers printable ASCII plus the typographic punctuation
 *    models actually emit; anything else is a glyph the prompt never asked for.
 *    The generator deliberately leaves out characters the face has no glyph for
 *    (the arrows and the maths relations, as it happens): a browser draws those
 *    with whatever fallback font the machine has, so their measured widths
 *    describe that machine rather than Caveat, and baking them in would make
 *    this table depend on where it was generated.
 *
 * Regenerate with `node scripts/generate-caveat-widths.ts` after replacing the
 * bundled face -- the table below is generated, everything else here is not.
 */

/* BEGIN GENERATED WIDTHS */
export const CAVEAT_WIDTHS: Readonly<Record<string, number>> = {
  '\u0030': 0.4500,
  '\u0031': 0.4500,
  '\u0032': 0.4500,
  '\u0033': 0.4500,
  '\u0034': 0.4500,
  '\u0035': 0.4500,
  '\u0036': 0.4500,
  '\u0037': 0.4500,
  '\u0038': 0.4500,
  '\u0039': 0.4500,
  '\u0020': 0.2420,
  '\u0021': 0.2100,
  '\u0022': 0.2370,
  '\u0023': 0.5590,
  '\u0024': 0.4500,
  '\u0025': 0.6000,
  '\u0026': 0.5640,
  '\u0027': 0.1170,
  '\u0028': 0.3300,
  '\u0029': 0.3300,
  '\u002a': 0.3630,
  '\u002b': 0.4460,
  '\u002c': 0.1980,
  '\u002d': 0.3260,
  '\u002e': 0.1980,
  '\u002f': 0.3300,
  '\u003a': 0.1980,
  '\u003b': 0.1980,
  '\u003c': 0.4460,
  '\u003d': 0.4460,
  '\u003e': 0.4460,
  '\u003f': 0.3740,
  '\u0040': 0.6430,
  '\u0041': 0.5020,
  '\u0042': 0.5200,
  '\u0043': 0.4720,
  '\u0044': 0.5780,
  '\u0045': 0.5290,
  '\u0046': 0.4540,
  '\u0047': 0.4870,
  '\u0048': 0.5630,
  '\u0049': 0.4000,
  '\u004a': 0.3060,
  '\u004b': 0.4980,
  '\u004c': 0.4260,
  '\u004d': 0.7200,
  '\u004e': 0.5990,
  '\u004f': 0.4960,
  '\u0050': 0.4640,
  '\u0051': 0.5020,
  '\u0052': 0.5370,
  '\u0053': 0.4860,
  '\u0054': 0.4580,
  '\u0055': 0.4820,
  '\u0056': 0.4900,
  '\u0057': 0.7200,
  '\u0058': 0.5240,
  '\u0059': 0.5040,
  '\u005a': 0.5220,
  '\u005b': 0.3300,
  '\u005c': 0.3300,
  '\u005d': 0.3300,
  '\u005e': 0.4460,
  '\u005f': 0.4460,
  '\u0060': 0.3530,
  '\u0061': 0.4370,
  '\u0062': 0.4350,
  '\u0063': 0.3550,
  '\u0064': 0.3930,
  '\u0065': 0.3250,
  '\u0066': 0.2910,
  '\u0067': 0.3550,
  '\u0068': 0.4640,
  '\u0069': 0.1870,
  '\u006a': 0.2040,
  '\u006b': 0.3650,
  '\u006c': 0.1690,
  '\u006d': 0.5600,
  '\u006e': 0.4500,
  '\u006f': 0.3530,
  '\u0070': 0.3780,
  '\u0071': 0.3770,
  '\u0072': 0.3600,
  '\u0073': 0.3410,
  '\u0074': 0.3310,
  '\u0075': 0.3700,
  '\u0076': 0.3310,
  '\u0077': 0.5170,
  '\u0078': 0.3430,
  '\u0079': 0.3410,
  '\u007a': 0.3150,
  '\u007b': 0.3300,
  '\u007c': 0.3300,
  '\u007d': 0.3300,
  '\u007e': 0.4460,
  '\u00a0': 0.2420,
  '\u2018': 0.1170,
  '\u2019': 0.1170,
  '\u201c': 0.2670,
  '\u201d': 0.2670,
  '\u2013': 0.4460,
  '\u2014': 0.5660,
  '\u2026': 0.5940,
  '\u00d7': 0.4460,
  '\u2022': 0.1870,
  '\u00b0': 0.2830,
  '\u00b1': 0.4460,
  '\u20ac': 0.4500,
  '\u00a3': 0.4500,
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
    total += CAVEAT_WIDTHS[char] ?? FALLBACK_WIDTH_EM;
  }
  return total;
}
