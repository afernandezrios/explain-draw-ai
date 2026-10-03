/**
 * TEMPORARY BRIDGE (Stage 1 of the RemotionUI migration).
 *
 * The handwriting face died with the SVG drawing path, and the fail-loud
 * loader for the blocks' own faces (Inter, JetBrains Mono) lands in Stage 2.
 * `src/remotion/index.ts` imports this module for its side effect; a no-op
 * module keeps that import honest -- a render right now loads no fonts at all.
 */

export {};
