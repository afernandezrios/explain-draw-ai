/**
 * Where a node sits on a grid.
 *
 * `TopologyScene` and `ConceptScene` both let an author place a node by cell --
 * `col`, `row`, and an optional `span` -- rather than by pixel, because the
 * author knows the shape and the component should own the arithmetic. This is
 * that arithmetic, in one place: a node's rectangle is also the rectangle its
 * links snap to, so two scenes solving the same cells differently would be two
 * pictures that drift apart.
 *
 * The optional cap is the difference between the two uses. Without one the
 * cells divide the box exactly, which is what a topology wants -- it is drawn
 * to fill its frame. With one the grid takes its natural size and is centred,
 * which is what a figure wants: two nodes should stay two nodes rather than
 * stretch into two panels because the column beside them is tall.
 *
 * React-free, like the rest of `lib/`: a scene asks for rectangles on the first
 * frame, from numbers it already has.
 */

import type { Rect } from './geometry.ts';

/** One node's place in the grid: a cell, and how many columns it takes. */
export type GridPlacement = {
  /** 0-based column. */
  col: number;
  /** 0-based row. */
  row: number;
  /** Columns the node occupies. Defaults to one. */
  span?: number;
};

export type GridBounds = { columns: number; rows: number };

/**
 * The box a grid is laid out in, in pixels. Structural rather than the layout
 * layer's `FrameBox`, so that a `lib/` module keeps importing nothing from
 * above it.
 */
export type GridBox = { width: number; height: number };

export type GridOptions = {
  /** The widest a cell may become, before the grid is centred instead. */
  maxCellWidth?: number;
  maxCellHeight?: number;
  /**
   * The smallest gap wanted between two neighbouring cells, in pixels. The
   * built-in inset is what a *node* needs to breathe; a gutter is what the
   * *links* between nodes need, and it only ever widens that inset. A figure
   * whose neighbours carry labelled arrows -- above all a pair of arrows
   * between the same two nodes, whose labels are told apart by the width of the
   * gap -- asks for a gutter wider than its own labels.
   */
  gutterX?: number;
  gutterY?: number;
};

/** The grid a set of placements needs: enough columns and rows to hold them. */
export function gridBounds(placements: GridPlacement[]): GridBounds {
  return {
    columns: Math.max(1, ...placements.map((placement) => placement.col + (placement.span ?? 1))),
    rows: Math.max(1, ...placements.map((placement) => placement.row + 1)),
  };
}

/** The rectangle one placement occupies in `box`. */
export function gridRect(
  placement: GridPlacement,
  grid: GridBounds,
  box: GridBox,
  options: GridOptions = {},
): Rect {
  const cellW = Math.min(box.width / grid.columns, options.maxCellWidth ?? Number.POSITIVE_INFINITY);
  const cellH = Math.min(box.height / grid.rows, options.maxCellHeight ?? Number.POSITIVE_INFINITY);
  // The gap between cells: a node never fills its cell, so two neighbours have
  // room between them for the arrow that joins them. A gutter is the caller
  // saying its arrows need more room than that, so it raises the inset rather
  // than replacing it.
  const inset = Math.min(22, cellW * 0.06, cellH * 0.08);
  const insetX = Math.max(inset, (options.gutterX ?? 0) / 2);
  const insetY = Math.max(inset, (options.gutterY ?? 0) / 2);
  // A capped grid is centred in its box; an uncapped one divides it exactly, so
  // both origins are zero and the maths is the same either way.
  const originX = (box.width - cellW * grid.columns) / 2;
  const originY = (box.height - cellH * grid.rows) / 2;
  const left = originX + placement.col * cellW + insetX;
  const right = Math.min(originX + (placement.col + (placement.span ?? 1)) * cellW, box.width) - insetX;
  return {
    x: left,
    y: originY + placement.row * cellH + insetY,
    w: Math.max(80, right - left),
    h: Math.max(72, cellH - insetY * 2),
  };
}
