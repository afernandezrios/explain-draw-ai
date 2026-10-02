/**
 * Scene -> SVG.
 *
 * This is the only place a scene is turned into pictures. The Remotion
 * composition feeds it a draw progress per shape for the current frame; the
 * preview route feeds it 1 for everything. Because both go through here, the
 * preview cannot disagree with the render about what a scene looks like.
 */

import {
  BOARD_H,
  BOARD_W,
  boardSvg,
  COLOR_VALUES,
  FONT_FAMILY,
  GRID,
  HEADER_HEIGHT,
  HEADER_PAD_X,
  HEADER_PROGRESS_BAR_HEIGHT,
  HEADER_TITLE_SIZE,
  PAPER,
} from './board.ts';
import { labelPlacement, shapePaths } from './doodle.ts';
import {
  badgePlacement,
  bulletListPlacement,
  captionPlacement,
  cardTitlePlacement,
} from './layout.ts';
import type { Scene } from './schema.ts';
import { textWidthEm } from './text-metrics.ts';

/** Fills start fading in once the outline is this far along. */
export const FILL_FADE_START = 0.35;

export type SceneSvgOptions = {
  /**
   * Base64 woff2 of the handwriting face, embedded in the SVG so the preview
   * carries its own font. The renderer leaves this out and loads the same face
   * into the page instead.
   */
  fontDataUri?: string | null;
  /**
   * Where this scene sits in the storyboard, for the header's progress chrome.
   * The renderer's props always carry both; a standalone call without them
   * draws a header as if the scene were the only one.
   */
  sceneIndex?: number;
  totalScenes?: number;
  width?: number | string;
  height?: number | string;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fillOpacity(progress: number, start: number = FILL_FADE_START): number {
  return clamp01((progress - start) / (1 - start));
}

/**
 * One run of hand lettering. Labels, figure captions and the words the
 * composite shapes carry (card titles, badge symbols, bullet lists) are all
 * drawn the same way, so a change to how text looks happens here once.
 */
function textSvg(
  x: number,
  y: number,
  text: string,
  fontSize: number,
  color: string,
  opacity: number,
): string {
  return (
    `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}, cursive" font-size="${fontSize}"` +
    ` fill="${color}" opacity="${opacity.toFixed(4)}" xml:space="preserve">${escapeXml(text)}</text>`
  );
}

/**
 * The scene header: the scene's title, a "N / M" read-out and a bar that fills
 * as the scene's shapes draw. Drawn last, over the art, because it is chrome
 * rather than content.
 */
function chromeSvg(title: string, index: number, total: number, fraction: number): string {
  // The title shrinks to fit the space left of the read-out: scene titles are
  // bounded only by the schema's character cap, so overflow is a real risk.
  const room = BOARD_W - HEADER_PAD_X - 380;
  const titleSize = Math.max(16, Math.min(HEADER_TITLE_SIZE, room / textWidthEm(title)));
  const titleBaseline = HEADER_HEIGHT / 2 + titleSize * 0.35;
  const readoutBaseline = HEADER_HEIGHT / 2 + HEADER_TITLE_SIZE * 0.35;
  return (
    `<rect x="0" y="0" width="${BOARD_W}" height="${HEADER_HEIGHT}" fill="${PAPER}"/>` +
    `<text x="${HEADER_PAD_X}" y="${titleBaseline.toFixed(2)}" font-family="${FONT_FAMILY}, cursive"` +
    ` font-size="${titleSize.toFixed(2)}" fill="${COLOR_VALUES.ink}" xml:space="preserve">${escapeXml(title)}</text>` +
    `<text x="${BOARD_W - HEADER_PAD_X}" y="${readoutBaseline.toFixed(2)}" font-family="${FONT_FAMILY}, cursive"` +
    ` font-size="${HEADER_TITLE_SIZE}" fill="${COLOR_VALUES.gray}" text-anchor="end" xml:space="preserve">` +
    `${index + 1} / ${total}</text>` +
    `<rect x="0" y="${HEADER_HEIGHT - HEADER_PROGRESS_BAR_HEIGHT - 2}" width="${BOARD_W}" height="2"` +
    ` fill="${GRID}"/>` +
    `<rect x="0" y="${HEADER_HEIGHT - HEADER_PROGRESS_BAR_HEIGHT}" width="${(BOARD_W * clamp01(fraction)).toFixed(2)}"` +
    ` height="${HEADER_PROGRESS_BAR_HEIGHT}" fill="${COLOR_VALUES.accent}"/>`
  );
}

/**
 * @param progress one 0..1 draw progress per shape, in scene order. Missing
 * entries are treated as fully drawn.
 */
export function sceneSvg(scene: Scene, progress: number[] = [], options: SceneSvgOptions = {}): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_W} ${BOARD_H}" width="${
      options.width ?? BOARD_W
    }" height="${options.height ?? BOARD_H}" preserveAspectRatio="xMidYMid meet">`,
  ];

  if (options.fontDataUri) {
    parts.push(
      `<style>@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${options.fontDataUri}) format("woff2");}</style>`,
    );
  }

  parts.push(boardSvg());

  scene.shapes.forEach((shape, index) => {
    const drawn = clamp01(progress[index] ?? 1);

    if (shape.kind === 'label') {
      const label = labelPlacement(shape);
      parts.push(textSvg(label.x, label.y, label.text, label.fontSize, label.color, drawn));
      return;
    }

    for (const path of shapePaths(shape, scene.shapes)) {
      const common = `d="${path.d}" stroke="${path.color}" stroke-width="${path.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
      if (path.kind === 'fill') {
        // Fill-kind paths fade in rather than dash-draw: a flat fill, or an
        // outline that carries a dash pattern of its own (a container's
        // grouping box) and so cannot also wear the reveal dash.
        const opacity = fillOpacity(drawn, path.fadeStart).toFixed(4);
        parts.push(
          path.strokeWidth > 0
            ? `<path ${common} fill="none"${
                path.dashPattern === undefined ? '' : ` stroke-dasharray="${path.dashPattern}"`
              } opacity="${opacity}"/>`
            : `<path d="${path.d}" stroke="none" fill="${path.color}" opacity="${opacity}"${
                path.shadow ? ' filter="url(#board-shadow)"' : ''
              }/>`,
        );
      } else {
        // Draw-on: pathLength normalises the outline to 1 unit so a single
        // dash offset sweeps the stroke along the path.
        parts.push(
          `<path ${common} fill="none" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(
            1 - drawn
          ).toFixed(4)}"/>`,
        );
      }
    }

    // Carried text: the words a shape draws itself, off its own fields, riding
    // the shape's own draw progress. None of it is a shape in the storyboard --
    // materialising one would add an entry to `shapes` and shift every index
    // after it, which is what the anchors address -- so each is placed here
    // instead, and cannot appear before the thing that carries it.
    const ink = COLOR_VALUES[shape.color ?? 'ink'];
    if (shape.kind === 'card') {
      const title = cardTitlePlacement(shape);
      if (title !== null) {
        parts.push(textSvg(title.x, title.y, title.text, title.fontSize, ink, drawn));
      }
    } else if (shape.kind === 'badge') {
      const symbol = badgePlacement(shape);
      if (symbol !== null) {
        parts.push(textSvg(symbol.x, symbol.y, symbol.text, symbol.fontSize, ink, drawn));
      }
    } else if (shape.kind === 'bulletList') {
      const list = bulletListPlacement(shape);
      const lines = list.title === null ? list.items : [list.title, ...list.items];
      for (const line of lines) {
        parts.push(textSvg(line.x, line.y, line.text, line.fontSize, ink, drawn));
      }
    } else if (shape.kind === 'stickFigure') {
      const caption = captionPlacement(shape);
      if (caption !== null) {
        parts.push(textSvg(caption.x, caption.y, caption.text, caption.fontSize, ink, drawn));
      }
    }
  });

  // The header rides the scene's own draw: the bar reaches (index + 1) / total
  // exactly when the last shape finishes, which is also the still the preview
  // shows.
  const total = Math.max(1, options.totalScenes ?? 1);
  const index = Math.min(Math.max(0, options.sceneIndex ?? 0), total - 1);
  const drawnMax = scene.shapes.reduce((max, _shape, i) => Math.max(max, clamp01(progress[i] ?? 1)), 0);
  parts.push(chromeSvg(scene.title, index, total, (index + drawnMax) / total));

  parts.push('</svg>');
  return parts.join('');
}

/** The finished drawing: what the preview and the storyboard strip show. */
export function fullSceneSvg(scene: Scene, options: SceneSvgOptions = {}): string {
  return sceneSvg(scene, scene.shapes.map(() => 1), options);
}
