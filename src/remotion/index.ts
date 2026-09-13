import { registerRoot } from 'remotion';
// Side-effect import, and it must stay one: this module is what loads the
// handwriting face and holds the render open with delayRender until it is
// ready. Its exports are unused here on purpose -- `FONT_FAMILY` in board.ts
// already names the family the SVG asks for, so importing it for a value would
// be redundant and, worse, a bundler that tree-shakes "unused" imports would
// silently drop the font load and render every label in a fallback face.
import './fonts.ts';
import { RemotionRoot } from './Root.tsx';

registerRoot(RemotionRoot);
