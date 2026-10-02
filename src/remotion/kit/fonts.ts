/**
 * The kit's two faces, loaded.
 *
 * A hook rather than the module-scope `loadFont` the doodle pipeline uses, and
 * the difference is not stylistic: `loadFont` calls `delayRender` and starts
 * its network fetch the moment it is *called*, so a module-scope call in a file
 * the root imports would make every doodle render download Inter and JetBrains
 * Mono it never draws with. Loading from a hook means the fetch happens when a
 * kit scene actually mounts, and never otherwise.
 *
 * Same posture as the doodle renderer's font load: a failed fetch cancels the
 * render with the real error instead of quietly drawing the whole video in a
 * fallback face. Rendering therefore needs network on the first run, after
 * which the faces are cached for the process.
 */

import { loadFont as loadSans } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { useEffect, useState } from 'react';
import { cancelRender } from 'remotion';

/**
 * The weights the kit actually sets: 400 for body and code, 500 for
 * subheadings, 600 for titles and emphasis, 700 for display. Every extra weight
 * is another file fetched while the render waits.
 */
const SANS_WEIGHTS = ['400', '500', '600', '700'] as const;
const MONO_WEIGHTS = ['400', '600'] as const;

/**
 * Loads both faces and holds the frame until they are ready. Called by `Frame`,
 * so every scene gets it for free; a component rendered outside a `Frame` skips
 * it and falls back down the stack in `FONT`.
 */
export function useKitFonts(): void {
  const [faces] = useState(() => ({
    sans: loadSans('normal', { weights: [...SANS_WEIGHTS], subsets: ['latin'] }),
    mono: loadMono('normal', { weights: [...MONO_WEIGHTS], subsets: ['latin'] }),
  }));

  useEffect(() => {
    Promise.all([faces.sans.waitUntilDone(), faces.mono.waitUntilDone()]).catch((error: unknown) => {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    });
  }, [faces]);
}
