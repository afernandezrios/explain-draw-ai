/**
 * Scene -> SVG.
 *
 * This is the only place a scene is turned into pictures. The Remotion
 * composition feeds it a draw progress per shape for the current frame; the
 * preview route feeds it 1 for everything. Because both go through here, the
 * preview cannot disagree with the render about what a scene looks like.
 */

import { BOARD_H, BOARD_W, boardSvg, COLOR_VALUES, FONT_FAMILY } from './board.ts';
import { labelPlacement, shapePaths } from './doodle.ts';
import { captionPlacement } from './layout.ts';
import type { Scene } from './schema.ts';

/** Hachure shading starts fading in once the outline is this far along. */
export const FILL_FADE_START = 0.35;

export type SceneSvgOptions = {
  /**
   * Base64 woff2 of the handwriting face, embedded in the SVG so the preview
   * carries its own font. The renderer leaves this out and loads the same face
   * into the page instead.
   */
  fontDataUri?: string | null;
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

function fillOpacity(progress: number): number {
  return clamp01((progress - FILL_FADE_START) / (1 - FILL_FADE_START));
}

/** One run of handwriting. Labels and figure captions are drawn the same way. */
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
        // Hachure shading fades in; it is never dash-drawn.
        const opacity = fillOpacity(drawn).toFixed(4);
        parts.push(
          path.strokeWidth > 0
            ? `<path ${common} fill="none" opacity="${opacity}"/>`
            : `<path d="${path.d}" stroke="none" fill="${path.color}" opacity="${opacity}"/>`,
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

    if (shape.kind === 'stickFigure') {
      // A caption is not a shape in the storyboard -- materialising one would
      // add an entry to `shapes` and shift every index after it, which is what
      // the anchors address -- so it is drawn here, off the figure, and rides
      // the figure's own draw progress so it cannot appear before the person.
      const caption = captionPlacement(shape);
      if (caption !== null) {
        parts.push(
          textSvg(
            caption.x,
            caption.y,
            caption.text,
            caption.fontSize,
            COLOR_VALUES[shape.color ?? 'ink'],
            drawn,
          ),
        );
      }
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

/** The finished drawing: what the preview and the storyboard strip show. */
export function fullSceneSvg(scene: Scene, options: SceneSvgOptions = {}): string {
  return sceneSvg(scene, scene.shapes.map(() => 1), options);
}
