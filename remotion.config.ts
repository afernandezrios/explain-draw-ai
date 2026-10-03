import path from 'node:path';
import { Config } from '@remotion/cli/config';

/**
 * Studio only. The copied RemotionUI sources import each other through the
 * `@/*` alias (`@/remotion/lib/layout`), and webpack does not read tsconfig
 * `paths` -- the alias has to be handed to the bundler explicitly. The render
 * worker passes the same mapping to `bundle()` via `webpackAliasOverride`
 * (src/render/bundle-config.ts), because the programmatic API never loads this
 * file.
 */
Config.overrideWebpackConfig((currentConfiguration) => ({
  ...currentConfiguration,
  resolve: {
    ...currentConfiguration.resolve,
    alias: {
      ...currentConfiguration.resolve?.alias,
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
}));
