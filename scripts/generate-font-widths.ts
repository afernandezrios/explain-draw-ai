/**
 * Regenerates the handwriting advance-width table in `src/lib/text-metrics.ts`.
 *
 * The layout pass has to know how wide a label will actually be before it
 * centres it in a box or sizes an underline to it -- and it has to know that in
 * Node, where no browser has the font loaded. So the widths are measured once,
 * here, and checked in. Run this only when the bundled face in `public/fonts`
 * is replaced.
 *
 * The face it measures is whatever `board.ts` names -- the same family the
 * renderer loads and the preview embeds -- so swapping fonts cannot leave this
 * script measuring the old one.
 *
 * Measuring needs a real text engine: `measureText` applies the font's own
 * advance widths and the browser's shaping. Chrome is already a dependency of
 * the renderer, so this reuses its headless shell rather than adding a font
 * parser.
 *
 * Run: node scripts/generate-font-widths.ts
 * (Type-stripped directly, like the render worker -- so relative imports carry
 * their `.ts` extension.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from '@remotion/renderer';
import { FONT_FAMILY, FONT_FILE } from '../src/lib/board.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_PATH = path.join(ROOT, 'public', 'fonts', FONT_FILE);
const TARGET = path.join(ROOT, 'src', 'lib', 'text-metrics.ts');

/** The family as a CSS font shorthand wants it: a name with spaces, quoted. */
const FONT_FAMILY_CSS = JSON.stringify(FONT_FAMILY);

const BEGIN = '/* BEGIN GENERATED WIDTHS */';
const END = '/* END GENERATED WIDTHS */';

/** Printable ASCII, which is what storyboards overwhelmingly use. */
const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));

/**
 * Beyond ASCII. Storyboards are written in prose by a model, so typographic
 * punctuation shows up even though the prompts never ask for it -- and these
 * are exactly the glyphs a fixed fallback would measure worst, because they are
 * wide (`--`, `->` rendered as a real arrow) or narrow (a curly quote).
 */
const EXTRA = [
  ' ', // no-break space
  '‘',
  '’', // curly single quotes
  '“',
  '”', // curly double quotes
  '–',
  '—', // en dash, em dash
  '…', // ellipsis
  '×', // multiplication sign
  '→',
  '←',
  '↑',
  '↓', // arrows
  '•', // bullet
  '°', // degree
  '±', // plus-minus
  '≈', // almost equal
  '≤',
  '≥',
  '≠', // comparisons
  '€',
  '£', // euro, pound
];

/** One em is the font size, so a 1000px face yields em widths directly. */
const PROBE_SIZE = 1000;

/**
 * A family that cannot exist, used to measure what the browser does with a
 * character the face has no glyph for. Quoted, so the font shorthand parses it
 * as one family name rather than a fallback list.
 */
const ABSENT_FAMILY = '"__Absent_Face_Probe__"';

/**
 * Two measurements of the same character differ by more than this only when the
 * face really does have a glyph for it; a missing glyph is drawn by the same
 * fallback font either way, to the same width, bit for bit. The gap between the
 * two cases is large (0.45em against 0.84em for the symbols that hit it), so
 * the threshold only has to clear floating-point noise.
 */
const PRESENT_EPSILON = 1e-4;

type Widths = Record<string, number>;

async function measure(chars: string[]): Promise<Widths> {
  const fontData = fs.readFileSync(FONT_PATH).toString('base64');

  const browser = await openBrowser('chrome', { chromeMode: 'headless-shell', logLevel: 'error' });
  try {
    // The descriptor is Remotion's own, complete down to the fields this page
    // never uses: it loads no bundles, so it has no source maps to resolve and
    // nothing worth logging beyond errors.
    const page = await browser.newPage({
      context: () => null,
      logLevel: 'error',
      indent: false,
      pageIndex: 0,
      onBrowserLog: null,
      onLog: () => undefined,
    });

    // No navigation needed: the fresh tab is already an `about:blank` document,
    // which is enough to hang a canvas off. (Remotion's page wrapper is a
    // cut-down Puppeteer page -- it has no `setContent`.)
    return (await page.evaluate(
      ({ fontData: data, family, familyCss, chars: wanted, probeSize, absentFamily, epsilon }) =>
        new Promise<Record<string, number>>((resolve, reject) => {
          const face = new FontFace(family, `url(data:font/woff2;base64,${data}) format('woff2')`);
          face
            .load()
            .then(() => {
              document.fonts.add(face);
              const ctx = document.createElement('canvas').getContext('2d');
              if (!ctx) {
                reject(new Error('no 2d context'));
                return;
              }
              const out: Record<string, number> = {};
              for (const ch of wanted) {
                ctx.font = `${probeSize}px ${familyCss}`;
                const withFace = ctx.measureText(ch).width / probeSize;
                ctx.font = `${probeSize}px ${absentFamily}`;
                const withoutFace = ctx.measureText(ch).width / probeSize;
                // Equal readings mean the face had nothing to offer and both
                // were drawn by the same fallback font. Those widths are a
                // property of this machine, not of the face, so they are left
                // out entirely and the table's own fallback covers them.
                if (Math.abs(withFace - withoutFace) > epsilon) {
                  out[ch] = withFace;
                }
              }
              resolve(out);
            })
            .catch(reject);
        }),
      {
        fontData,
        family: FONT_FAMILY,
        familyCss: FONT_FAMILY_CSS,
        chars,
        probeSize: PROBE_SIZE,
        absentFamily: ABSENT_FAMILY,
        epsilon: PRESENT_EPSILON,
      },
    )) as Widths;
  } finally {
    await browser.close({ silent: true });
  }
}

/** `'—': 0.3312,` -- escaped, so the table survives any editor. */
function literal(char: string): string {
  const code = char.codePointAt(0) as number;
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

function renderTable(widths: Widths): string {
  const entries = Object.entries(widths).map(
    ([char, width]) => `  '${literal(char)}': ${width.toFixed(4)},`,
  );
  return [`${BEGIN}`, 'export const FONT_WIDTHS: Readonly<Record<string, number>> = {', ...entries, '};', END].join('\n');
}

function main(): void {
  if (!fs.existsSync(FONT_PATH)) {
    console.error(`No bundled face at ${FONT_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(TARGET)) {
    console.error(`No target at ${TARGET}; create it with the markers first.`);
    process.exit(1);
  }

  measure([...ASCII, ...EXTRA])
    .then((widths) => {
      // If the face never loaded, every character measures as the fallback and
      // the table comes back with almost nothing in it -- and writing that to
      // the target would replace a good table with an empty one. Letters are
      // the least ambiguous thing a latin subset must contain.
      const letters = [...'abcdefghijklmnopqrstuvwxyz'].filter((ch) => ch in widths);
      if (letters.length < 26) {
        console.error(
          `Only ${letters.length}/26 letters measured -- the face probably did not load. Refusing to write the table.`,
        );
        process.exit(1);
      }

      const source = fs.readFileSync(TARGET, 'utf8');
      const from = source.indexOf(BEGIN);
      const to = source.indexOf(END);
      if (from === -1 || to === -1) {
        console.error(`Could not find ${BEGIN} / ${END} in ${TARGET}`);
        process.exit(1);
      }
      const next = source.slice(0, from) + renderTable(widths) + source.slice(to + END.length);
      fs.writeFileSync(TARGET, next);
      console.log(`Wrote ${Object.keys(widths).length} advance widths to ${path.relative(ROOT, TARGET)}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

main();
