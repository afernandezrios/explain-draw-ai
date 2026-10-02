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

/**
 * The kind is the vocabulary the model speaks; the value is the ink on paper.
 * The first three are the default vocabulary the prompt steers by; the rest are
 * extra categories the model may reach for when a scene needs more than three.
 */
export const COLOR_NAMES = [
  'ink',
  'accent',
  'emphasis',
  'success',
  'warn',
  'violet',
  'teal',
  'gray',
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_VALUES: Record<ColorName, string> = {
  ink: '#1f2933',
  accent: '#2563eb',
  emphasis: '#dc2626',
  success: '#059669',
  warn: '#d97706',
  violet: '#7c3aed',
  teal: '#0d9488',
  gray: '#64748b',
};

/**
 * Flat fill colour for filled shapes. Deliberately a pale tint of the same ink
 * so a filled area still reads as the shape's colour rather than as a second
 * stroke.
 */
export const FILL_VALUES: Record<ColorName, string> = {
  ink: '#e9ecf2',
  accent: '#dbe6fe',
  emphasis: '#fde3e3',
  success: '#d6f0e5',
  warn: '#fcebcf',
  violet: '#eae0fb',
  teal: '#d5efec',
  gray: '#e4e8ef',
};

export const PAPER = '#fdfdfb';
export const GRID = '#d6dbe6';
export const GRID_STEP = 64;

/**
 * The scene header: the app draws the scene's title and a progress bar across
 * the top of every scene. Geometry is in board pixels; the header overlays the
 * board, so drawing coordinates should stay below it.
 */
export const HEADER_HEIGHT = 64;
export const HEADER_PAD_X = 40;
export const HEADER_TITLE_SIZE = 26;
export const HEADER_PROGRESS_BAR_HEIGHT = 4;

/** The handwriting face. Loaded by @remotion/google-fonts in the renderer and
 * from a bundled woff2 in the app; see src/app/globals.css and fonts.ts. */
export const FONT_FAMILY = 'Architects Daughter';

/**
 * The bundled copy of that face, served from public/fonts. The app embeds it in
 * preview SVGs and declares it in globals.css, so the preview shows the same
 * handwriting as the render without fetching anything at runtime.
 */
export const FONT_FILE = 'architects-daughter-latin-400.woff2';

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
 * The paper: background, dot grid and the shared defs, as SVG markup. Shared
 * verbatim by the composition and the preview.
 *
 * The shadow filter's region is widened past the 10%/+20% default: a drop
 * shadow reaches outside its source's bounds, and the default region clips it.
 */
export function boardSvg(): string {
  return (
    `<defs>` +
    `<pattern id="board-dots" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse">` +
    `<circle cx="2" cy="2" r="1.5" fill="${GRID}"/>` +
    `</pattern>` +
    `<filter id="board-shadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1f2933" flood-opacity="0.18"/>` +
    `</filter>` +
    `</defs>` +
    `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="${PAPER}"/>` +
    `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="url(#board-dots)"/>`
  );
}
