/**
 * The link between two boxes.
 *
 * A connection is an `Arrow` that works out where to start and stop: give it
 * the rectangles a `Box` or `Node` was placed at and it snaps both ends onto
 * the borders facing each other, so the line touches the boxes instead of
 * disappearing under them. Give it a bare point and it uses the point as
 * given, which is how an arrow is drawn to something that is not a box.
 *
 * The rectangle is the contract between the two components, and it is why
 * markup usually keeps its rects in named constants:
 *
 *   const a = { x: 40, y: 60, w: 180, h: 96 };
 *   const b = { x: 320, y: 60, w: 180, h: 96 };
 *   <Node {...a} label="Client" />
 *   <Connection from={a} to={b} label="POST /orders" />
 *
 * Everything else -- bend, dash, arrowheads, label, arrival -- is `Arrow`'s,
 * passed straight through.
 */

import React from 'react';
import { borderPoint, segmentBetween, type Point, type Rect } from '../lib/geometry.ts';
import { Arrow, type ArrowProps } from './Arrow.tsx';

/** A connection end: a rectangle to stop at, or a point to stop on. */
export type ConnectionAnchor = Point | Rect;

export type ConnectionProps = Omit<ArrowProps, 'from' | 'to'> & {
  from: ConnectionAnchor;
  to: ConnectionAnchor;
};

function isRect(anchor: ConnectionAnchor): anchor is Rect {
  return 'w' in anchor && 'h' in anchor;
}

/**
 * The two end points of the line. Rectangles stop on their borders, aimed at
 * the other end's centre; the maths lives in `lib/geometry.ts` so this and a
 * scene's own edges cannot disagree about where a border is.
 */
function resolveEnds(from: ConnectionAnchor, to: ConnectionAnchor): { from: Point; to: Point } {
  if (isRect(from)) {
    return isRect(to) ? segmentBetween(from, to) : { from: borderPoint(from, to), to };
  }
  return isRect(to) ? { from, to: borderPoint(to, from) } : { from, to };
}

export const Connection: React.FC<ConnectionProps> = ({ from, to, ...arrow }) => {
  const ends = resolveEnds(from, to);
  return <Arrow from={ends.from} to={ends.to} {...arrow} />;
};
