/**
 * The maths behind a diagram, with no React in sight.
 *
 * Nodes are rectangles and edges are lines between them, and the whole job of
 * this module is to answer two questions well: where does a line leave a box,
 * and where is a point part-way along a path. Keeping it as plain functions
 * means a scene can be reasoned about -- and later validated -- without
 * rendering anything.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function rectFromCenter(center: Point, w: number, h: number): Rect {
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

/**
 * Where the ray from a box's centre towards `toward` crosses the box's border.
 *
 * This is what makes an arrow stop at the edge of the node it points at rather
 * than disappearing underneath it: scale the direction until whichever axis
 * runs out first -- which is exactly the border -- is reached. A direction of
 * zero falls back to the centre instead of dividing by it.
 */
export function borderPoint(rect: Rect, toward: Point): Point {
  const center = centerOf(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : rect.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : rect.h / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** The visible span of an edge between two boxes: border to border. */
export function segmentBetween(from: Rect, to: Rect): { from: Point; to: Point } {
  return {
    from: borderPoint(from, centerOf(to)),
    to: borderPoint(to, centerOf(from)),
  };
}

/**
 * A path from one point to another, optionally bowed sideways.
 *
 * `bend` is how far the line bulges at its middle in pixels, and it is the
 * *visible* offset, not the control point's -- a quadratic curve passes half
 * way to its control point, so the control point is placed at twice the
 * requested distance. Two edges that would otherwise overlap (A to B and B to
 * A) can be pulled apart by giving them opposite bends.
 */
export function bendControl(from: Point, to: Point, bend: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: (from.x + to.x) / 2 + (-dy / length) * bend * 2,
    y: (from.y + to.y) / 2 + (dx / length) * bend * 2,
  };
}

export function pathBetween(from: Point, to: Point, bend = 0): string {
  const move = `M ${round(from.x)} ${round(from.y)}`;
  if (bend === 0) {
    return `${move} L ${round(to.x)} ${round(to.y)}`;
  }
  const control = bendControl(from, to, bend);
  return `${move} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`;
}

/** A point at `t` along the edge `pathBetween` would draw -- where a label or a
 * travelling pulse goes. */
export function pointOnEdge(from: Point, to: Point, bend: number, t: number): Point {
  if (bend === 0) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  const control = bendControl(from, to, bend);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

/**
 * A message an actor sends itself, in a sequence diagram: out to the right and
 * back, ending where it started plus `drop`. Drawn as one cubic so the loop has
 * no corners to round.
 */
export function selfLoopPath(from: Point, reach: number, drop: number): string {
  const { x, y } = from;
  return `M ${round(x)} ${round(y)} C ${round(x + reach)} ${round(y)} ${round(x + reach)} ${round(y + drop)} ${round(x)} ${round(y + drop)}`;
}

/** A rectangle with rounded corners, as a path -- for a highlight that is not
 * a full box, and for anything drawn outside a `Surface`. */
export function roundedRectPath(rect: Rect, radius: number): string {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  const { x, y, w, h } = rect;
  return (
    `M ${round(x + r)} ${round(y)}` +
    ` H ${round(x + w - r)} A ${r} ${r} 0 0 1 ${round(x + w)} ${round(y + r)}` +
    ` V ${round(y + h - r)} A ${r} ${r} 0 0 1 ${round(x + w - r)} ${round(y + h)}` +
    ` H ${round(x + r)} A ${r} ${r} 0 0 1 ${round(x)} ${round(y + h - r)}` +
    ` V ${round(y + r)} A ${r} ${r} 0 0 1 ${round(x + r)} ${round(y)} Z`
  );
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * The point at `t` (0 to 1) along a polyline, measured by distance rather than
 * by segment index -- so a pulse travelling a path of uneven segments keeps a
 * steady speed.
 */
export function pointAlong(points: Point[], t: number): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const total = polylineLength(points);
  if (total === 0) {
    return points[0];
  }
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segment || i === points.length - 1) {
      const ratio = segment === 0 ? 0 : remaining / segment;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= segment;
  }
  return points[points.length - 1];
}

/** Two decimals is under a hundredth of a pixel at 1080p, and keeps path
 * strings short enough to read in a diff. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
