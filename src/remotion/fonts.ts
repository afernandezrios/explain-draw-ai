/**
 * The handwriting face, for the renderer.
 *
 * Restricted to the single weight and subset the videos actually use. The
 * library's defaults would fetch four weights across four subsets, which is
 * both slower and pointless here.
 *
 * Honest limitation: this fetches the font from Google Fonts *while the render
 * runs*. Rendering therefore needs network access, and if the fetch fails the
 * render fails -- it does not quietly fall back to another typeface and produce
 * a video in the wrong handwriting. The preview in the app uses a woff2 bundled
 * in `public/fonts`, so previewing works offline.
 */

import { loadFont } from '@remotion/google-fonts/Caveat';
import { cancelRender, continueRender, delayRender } from 'remotion';
import { FONT_FAMILY } from '../lib/board.ts';

/**
 * Imported for its side effect by the bundle entry (`index.ts`), which is what
 * makes `loadFont` run at all: nothing here is exported, because the SVG already
 * names the family through `FONT_FAMILY` in board.ts -- what this module
 * contributes is the `@font-face` the browser needs to draw that name.
 */
const { waitUntilDone } = loadFont('normal', {
  weights: ['400'],
  subsets: ['latin'],
});

const fontLoadHandle = delayRender(`Loading the ${FONT_FAMILY} font`);

waitUntilDone()
  .then(() => continueRender(fontLoadHandle))
  .catch((error: unknown) => {
    // Fail the render with the real reason rather than letting the delayRender
    // handle stall until it times out.
    cancelRender(error instanceof Error ? error : new Error(String(error)));
  });
