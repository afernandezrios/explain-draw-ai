import { registerRoot } from 'remotion';
// Side-effect import, and it must stay one: this module is what loads the
// faces the blocks draw with and holds the render open with delayRender until
// they are ready. Its exports are unused here on purpose -- the import exists
// for the load, and a bundler that tree-shakes "unused" imports would silently
// drop it and render every label in a fallback face.
import './fonts.ts';
import { RemotionRoot } from './Root.tsx';

registerRoot(RemotionRoot);
