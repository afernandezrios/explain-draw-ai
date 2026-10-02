/**
 * A bullet list's arithmetic, as fractions of its own item size.
 *
 * One list, two readers: `schema.ts` bounds how far down the board a list
 * reaches (`checkBoardExtents`), and `layout.ts` places its heading, its items
 * and its dots. Both have to agree about how tall a list is -- a validator that
 * refused a list the renderer would have drawn inside the board, or the reverse,
 * is exactly the drift this module exists to prevent. A leaf module, so
 * `schema.ts` can share it without dragging the layout pass (and rough.js) into
 * everything that validates a storyboard.
 *
 * Everything here is a pure function of the list's own fields -- the width it
 * was given, the room below its top, and the words in it -- and reads back
 * nothing the layout pass wrote. That is what keeps `layOutScenes` a fixed
 * point: laying a list out twice settles on the same size and the same
 * coordinates, because nothing here depends on where the text currently sits.
 */

import { BOARD_H, BOARD_W } from './board.ts';
import { textWidthEm } from './text-metrics.ts';

/**
 * What these functions need of a bullet-list shape: the fields they read, as a
 * structural minimum rather than the schema's own type -- `schema.ts` imports
 * this module, so this module cannot import it back.
 */
export type BulletListShape = {
  /** top edge, percent of board height */
  y: number;
  /** width, percent of board width */
  w: number;
  /** the heading drawn above the items, or null for none */
  title?: string | null;
  items: readonly string[];
};

/** The most items one list may carry. The strict output subset has no `maxItems`. */
export const BULLET_MAX_ITEMS = 6;

/** How much of the list's width the longest line may span. */
export const BULLET_FIT_WIDTH = 0.9;

/** The largest an item is ever drawn, percent of board height. */
export const BULLET_MAX_ITEM_SIZE = 7;

/**
 * The smallest, matching `MIN_LABEL_SIZE` in `schema.ts` -- declared here
 * because this module may not import that one. Past this the words stop being
 * words, and a list that overhangs slightly is more legible than a tiny one
 * that fits.
 */
export const BULLET_MIN_ITEM_SIZE = 4;

/** Vertical rhythm, every measure a multiple of the item size. */
export const BULLET_LINE_RATIO = 1.6;
export const BULLET_TITLE_RATIO = 1.2;
export const BULLET_PAD_TOP = 0.9;
export const BULLET_PAD_BOTTOM = 0.6;

/** Text and dot inset from the list's left edge, as multiples of the item size. */
export const BULLET_INDENT = 1.6;
export const BULLET_DOT_INDENT = 0.8;
/** Dot radius, as a multiple of the item size. */
export const BULLET_DOT_RATIO = 0.22;

/** Where a baseline sits within its own line box. Same idea as `BASELINE_SINK`. */
export const BULLET_BASELINE = 0.32;

/** An empty heading is no heading, the same rule captions follow. */
export function bulletTitle(list: BulletListShape): string | null {
  const title = list.title;
  return title !== null && title !== undefined && title.trim() !== '' ? title : null;
}

/**
 * Total list height in units of the item size: the top and bottom insets, one
 * line per item, and the heading's own line when there is one.
 */
function rowBudget(list: BulletListShape): number {
  return (
    BULLET_PAD_TOP +
    BULLET_PAD_BOTTOM +
    BULLET_LINE_RATIO * list.items.length +
    (bulletTitle(list) === null ? 0 : BULLET_TITLE_RATIO)
  );
}

/**
 * The size a list settles on, as a percent of board height: the largest that
 * fits both the width it was given and the room left below its top, clamped to
 * the band text may live in.
 */
export function bulletItemSize(list: BulletListShape): number {
  // The longest line is what decides the width -- measured from the face's own
  // advances, the same table every other fit in the layout pass uses.
  const longest = [bulletTitle(list) ?? '', ...list.items].reduce(
    (max, line) => Math.max(max, textWidthEm(line)),
    0,
  );
  const widthRoom = (list.w / 100) * BOARD_W * BULLET_FIT_WIDTH;
  const sizeForWidth = longest === 0 ? Number.POSITIVE_INFINITY : (widthRoom / (longest * BOARD_H)) * 100;
  const sizeForHeight = (100 - list.y) / rowBudget(list);
  return Math.max(
    BULLET_MIN_ITEM_SIZE,
    Math.min(BULLET_MAX_ITEM_SIZE, sizeForWidth, sizeForHeight),
  );
}

/**
 * How far the whole list reaches below its top edge, in percent of board
 * height, at the given item size. The board-extent check measures with this,
 * so it refuses exactly the lists that would run off the bottom.
 */
export function bulletListHeight(list: BulletListShape, size: number): number {
  return size * rowBudget(list);
}
