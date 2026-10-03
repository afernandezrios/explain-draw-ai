/**
 * The `@/*` alias, for the Remotion bundler.
 *
 * The copied RemotionUI sources import each other through `@/remotion/...`,
 * and webpack does not read tsconfig `paths` -- so every bundling entry point
 * has to hand the mapping over explicitly. Studio gets it from
 * `remotion.config.ts`; the render worker passes `webpackAliasOverride` into
 * `bundle()`.
 */

import path from 'node:path';
import type { WebpackOverrideFn } from '@remotion/bundler';

/**
 * The project root is a parameter rather than `process.cwd()` because the
 * worker derives it from its own location (`PROJECT_ROOT` in worker.ts)
 * rather than assuming a working directory.
 */
export function webpackAliasOverride(projectRoot: string): WebpackOverrideFn {
  const srcDir = path.join(projectRoot, 'src');

  return (currentConfiguration) => ({
    ...currentConfiguration,
    resolve: {
      ...currentConfiguration.resolve,
      alias: {
        ...currentConfiguration.resolve?.alias,
        '@': srcDir,
      },
    },
  });
}
