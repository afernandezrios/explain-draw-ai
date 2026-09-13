/**
 * One whiteboard, one palette.
 *
 * The Remotion composition and the SVG preview both read these constants and
 * both call `boardSvg()`, so the board cannot drift between what you preview
 * and what you render.
 *
 * Units: the board is a fixed 1600x900 grid. Scene coordinates are expressed as
 * percentages so they survive the switch between the preview viewBox and the
 * 1920x1080 render canvas:
 *   - x positions and `w` widths: percent of board WIDTH (0-100 across)
 *   - y positions and `h` heights: percent of board HEIGHT (0-100 down)
 *   - radii, stick-figure heights and font sizes: percent of board HEIGHT, so
 *     they are isotropic and circles stay round on a 16:9 board
 */

export const BOARD_W = 1600;
export const BOARD_H = 900;

/** The kind is the vocabulary the model speaks; the value is the ink on paper. */
export const COLOR_NAMES = ['ink', 'accent', 'emphasis'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_VALUES: Record<ColorName, string> = {
  ink: '#1f2933',
  accent: '#2563eb',
  emphasis: '#dc2626',
};

/**
 * Hachure hatch colour for filled shapes. Deliberately a pale tint of the same
 * ink so a shaded area still reads as shading rather than as a second stroke.
 */
export const FILL_VALUES: Record<ColorName, string> = {
  ink: '#cbd2d9',
  accent: '#bfd4fb',
  emphasis: '#f8c9c9',
};

export const PAPER = '#fdfdfb';
export const GRID = '#eceef4';
export const GRID_STEP = 64;

/** The handwriting face. Loaded by @remotion/google-fonts in the renderer and
 * from a bundled woff2 in the app; see src/app/globals.css and fonts.ts. */
export const FONT_FAMILY = 'Caveat';

/**
 * The bundled copy of that face, served from public/fonts. The app embeds it in
 * preview SVGs and declares it in globals.css, so the preview shows the same
 * handwriting as the render without fetching anything at runtime.
 */
export const FONT_FILE = 'caveat-latin-400.woff2';

/** Board percent -> board pixels. */
export function toBoardX(px: number): number {
  return (px / 100) * BOARD_W;
}

export function toBoardY(py: number): number {
  return (py / 100) * BOARD_H;
}

/** Isotropic lengths are a percent of board height. */
export function toBoardLen(len: number): number {
  return (len / 100) * BOARD_H;
}

/**
 * The paper: background plus the faint grid, as SVG markup. Shared verbatim by
 * the composition and the preview.
 */
export function boardSvg(): string {
  return (
    `<defs><pattern id="board-grid" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse">` +
    `<path d="M ${GRID_STEP} 0 L 0 0 0 ${GRID_STEP}" fill="none" stroke="${GRID}" stroke-width="1"/>` +
    `</pattern></defs>` +
    `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="${PAPER}"/>` +
    `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="url(#board-grid)"/>`
  );
}
