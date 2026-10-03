/**
 * The faces every block draws with, loaded once and held open until ready.
 *
 * `src/remotion/index.ts` imports this module for its side effect alone. That
 * import must stay a side-effect import: it is what calls `loadFont` before a
 * render starts -- a module-scope call here is correct now because every kind
 * on the composition really does draw with these faces, so there is nothing
 * being fetched for renders that will not use it. The library dedupes per
 * family/weight/subset, so the blocks' own `loadFont` calls hit this cache --
 * one fetch per file, one place where a failed fetch is loud.
 *
 * Rendering is therefore not offline: the first render in a process fetches
 * the faces from Google's CDN. `delayRender` holds the frame back until both
 * families are in; a load that fails twice cancels the whole render with the
 * real error rather than quietly baking every label in a fallback face.
 */

import { loadFont as loadSans } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { cancelRender, continueRender, delayRender } from 'remotion';

/**
 * The weights the blocks actually set: 400 for body and code, 500 for
 * subheadings, 600 for titles and emphasis, 700 for display. Every extra
 * weight is another file fetched while the render waits.
 */
const SANS_WEIGHTS = ['400', '500', '600', '700'] as const;
const MONO_WEIGHTS = ['400', '500', '700'] as const;

const sans = loadSans('normal', { weights: [...SANS_WEIGHTS], subsets: ['latin'] });
const mono = loadMono('normal', { weights: [...MONO_WEIGHTS], subsets: ['latin'] });

const fontLoadHandle = delayRender('Loading Inter and JetBrains Mono');

Promise.all([sans.waitUntilDone(), mono.waitUntilDone()])
  .then(() => continueRender(fontLoadHandle))
  .catch((error) =>
    cancelRender(error instanceof Error ? error : new Error(String(error))),
  );
