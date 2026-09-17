/**
 * rough.js geometry for the nine doodles.
 *
 * Determinism is a hard requirement: the composition re-renders the same scene
 * on every frame, and a shape whose wobble changed between frames would shimmer
 * on screen. Two things guarantee it:
 *
 *   - a FRESH seeded generator per shape, seeded from the shape's own content,
 *     so output never depends on how many shapes were drawn before it; and
 *   - a module-scope memo, so each shape's path data is computed once and then
 *     reused for all of that scene's frames.
 *
 * A single shared generator would make each shape's wobble depend on every
 * shape drawn before it -- changing one shape would reshuffle all the rest.
 *
 * `crossOut` is the one shape whose drawing is not its own: it is an X over
 * another shape's bounds, so its geometry is a function of a *neighbour*. Both
 * the seed and the memo key therefore fold that neighbour's geometry in -- two
 * crosses at the same array index in two different scenes are different
 * drawings, and a memo that thought otherwise would hand the second scene the
 * first scene's X.
 */

import rough from 'roughjs';
import type { Drawable, OpSet, Options } from 'roughjs/bin/core';
import type { RoughGenerator } from 'roughjs/bin/generator';
import { COLOR_VALUES, FILL_VALUES, toBoardLen, toBoardX, toBoardY } from './board.ts';
import { shapeBox } from './layout.ts';
import {
  ARM_BELOW,
  ARM_SPREAD,
  FEET_BELOW,
  HEAD_ABOVE,
  HEAD_RADIUS,
  HIP_BELOW,
  LEG_SPREAD,
  SHOULDER_ABOVE,
} from './figure.ts';
import type { Shape, ShapeKind } from './schema.ts';

const ROUGHNESS = 1.1;
const BOWING = 1;
const STROKE_WIDTH = 3.4;
const HACHURE_GAP = 8;
const FILL_WEIGHT = 2.2;

const ARROW_HEAD_ANGLE = 0.44;
const ARROW_HEAD_MIN = 22;
const ARROW_HEAD_MAX = 42;

/** Shapes that get a hachure fill behind their outline. */
const FILLED: ReadonlySet<ShapeKind> = new Set<ShapeKind>(['box', 'circle', 'cloud']);

/** One paintable path: `stroke` paths are dash-drawn, `fill` paths fade in. */
export type DrawnPath = {
  d: string;
  kind: 'stroke' | 'fill';
  color: string;
  strokeWidth: number;
};

/** What the preview needs to draw a label, which has no rough geometry. */
export type LabelPlacement = {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
};

/* ──────────────────────────── determinism ───────────────────────── */

/** The shape without its colour: what the drawing is made of. */
function geometryOf(shape: Shape): Record<string, unknown> {
  const { color: _color, ...geometry } = shape;
  return geometry;
}

/**
 * The geometry a shape is drawn from, which for a cross is partly its
 * neighbour's. Used for the seed and the memo key, never for painting.
 */
function drawnFrom(shape: Shape, shapes?: readonly Shape[]): unknown {
  const own = geometryOf(shape);
  if (shape.kind !== 'crossOut') {
    return own;
  }
  const target = shapes?.[shape.target];
  return { ...own, of: target === undefined ? null : geometryOf(target) };
}

/**
 * FNV-1a over the shape's geometry only, so recolouring never reshuffles it.
 * A cross hashes the shape it crosses too, so the X sits the same way on every
 * frame but differs between one target and another.
 */
function shapeSeed(shape: Shape, shapes?: readonly Shape[]): number {
  const text = JSON.stringify(drawnFrom(shape, shapes));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * What makes two shapes the same drawing for the memo.
 *
 * Colour is part of it -- the paths carry their resolved ink -- but for every
 * kind except `crossOut` that is all the shape's own fields. Only a cross has
 * to look outside itself, because only a cross is drawn from somewhere else.
 */
function memoKey(shape: Shape, shapes?: readonly Shape[]): string {
  return shape.kind === 'crossOut'
    ? JSON.stringify([shape, drawnFrom(shape, shapes)])
    : JSON.stringify(shape);
}

/* ───────────────────────────── plumbing ─────────────────────────── */

function baseOptions(seed: number, stroke: string, fill: string | undefined): Options {
  return {
    seed,
    roughness: ROUGHNESS,
    bowing: BOWING,
    stroke,
    strokeWidth: STROKE_WIDTH,
    disableMultiStroke: true,
    // The roughjs renderer reads `disableMultiStrokeFill` for fills and
    // `disableMultiStroke` for outlines. Setting only the first leaves the
    // doubled pen pass on exactly the hachure fills we meant to switch off.
    disableMultiStrokeFill: true,
    ...(fill === undefined
      ? {}
      : { fill, fillStyle: 'hachure', hachureGap: HACHURE_GAP, fillWeight: FILL_WEIGHT }),
  };
}

/**
 * Reads the op sets straight off the drawable rather than going through
 * `toPaths()`, which flattens outline, solid fill and hachure hatching into
 * indistinguishable `{d, stroke, fill}` records -- and a hachure fill needs a
 * different animation (fade) from an outline (dash-draw).
 */
function emit(gen: RoughGenerator, set: OpSet, strokeColor: string, fillColor: string): DrawnPath {
  const d = gen.opsToPath(set);
  if (set.type === 'path') {
    return { d, kind: 'stroke', color: strokeColor, strokeWidth: STROKE_WIDTH };
  }
  return {
    d,
    kind: 'fill',
    color: fillColor,
    strokeWidth: set.type === 'fillSketch' ? FILL_WEIGHT : 0,
  };
}

/* ─────────────────────────── shape builders ─────────────────────── */

function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const head = Math.min(ARROW_HEAD_MAX, Math.max(ARROW_HEAD_MIN, length * 0.3));
  const left = angle + Math.PI - ARROW_HEAD_ANGLE;
  const right = angle + Math.PI + ARROW_HEAD_ANGLE;
  const lx = x2 + Math.cos(left) * head;
  const ly = y2 + Math.sin(left) * head;
  const rx = x2 + Math.cos(right) * head;
  const ry = y2 + Math.sin(right) * head;
  return `M ${lx} ${ly} L ${x2} ${y2} L ${rx} ${ry}`;
}

function segment(ax: number, ay: number, bx: number, by: number): string {
  return `M ${ax} ${ay} L ${bx} ${by}`;
}

/**
 * A closed cloud outline: a ring of control points (a fat, lumpy blob) joined
 * by Catmull-Rom curves, converted to cubic beziers so roughjs can wobble them.
 */
const CLOUD_RING: readonly [number, number][] = [
  [0.0, -0.32],
  [0.24, -0.46],
  [0.46, -0.32],
  [0.5, -0.04],
  [0.42, 0.18],
  [0.2, 0.32],
  [-0.06, 0.34],
  [-0.31, 0.25],
  [-0.49, 0.06],
  [-0.5, -0.14],
  [-0.38, -0.32],
  [-0.2, -0.42],
];

function cloudPath(cx: number, cy: number, w: number, h: number): string {
  const points = CLOUD_RING.map(([px, py]) => [cx + px * w, cy + py * h] as const);
  const n = points.length;
  const commands: string[] = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    // Catmull-Rom to cubic bezier.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`);
  }
  commands.push('Z');
  return commands.join(' ');
}

function buildDrawables(
  gen: RoughGenerator,
  shape: Shape,
  opts: Options,
  shapes?: readonly Shape[],
): Drawable[] {
  switch (shape.kind) {
    case 'box':
      // Widths are a percent of board width and heights of board height, so a
      // `w`/`h` pair reads the way you would draw it on screen.
      return [
        gen.rectangle(
          toBoardX(shape.x),
          toBoardY(shape.y),
          toBoardX(shape.w),
          toBoardY(shape.h),
          opts,
        ),
      ];
    case 'circle':
      return [gen.circle(toBoardX(shape.x), toBoardY(shape.y), toBoardLen(shape.r) * 2, opts)];
    case 'cloud':
      return [
        gen.path(
          cloudPath(toBoardX(shape.x), toBoardY(shape.y), toBoardX(shape.w), toBoardY(shape.h)),
          opts,
        ),
      ];
    case 'arrow': {
      const x1 = toBoardX(shape.from.x);
      const y1 = toBoardY(shape.from.y);
      const x2 = toBoardX(shape.to.x);
      const y2 = toBoardY(shape.to.y);
      return [gen.path(`${segment(x1, y1, x2, y2)} ${arrowHead(x1, y1, x2, y2)}`, opts)];
    }
    case 'connector':
      return [
        gen.path(
          segment(
            toBoardX(shape.from.x),
            toBoardY(shape.from.y),
            toBoardX(shape.to.x),
            toBoardY(shape.to.y),
          ),
          opts,
        ),
      ];
    case 'underline': {
      const x = toBoardX(shape.x);
      const y = toBoardY(shape.y);
      return [gen.path(segment(x, y, x + toBoardX(shape.w), y), opts)];
    }
    case 'stickFigure': {
      const cx = toBoardX(shape.x);
      const cy = toBoardY(shape.y);
      const h = toBoardLen(shape.height);
      const shoulderY = cy - h * SHOULDER_ABOVE;
      const hipY = cy + h * HIP_BELOW;
      const feetY = cy + h * FEET_BELOW;
      const armY = cy + h * ARM_BELOW;
      const body = [
        segment(cx - h * ARM_SPREAD, armY, cx, shoulderY),
        segment(cx, shoulderY, cx + h * ARM_SPREAD, armY),
        segment(cx, shoulderY, cx, hipY),
        segment(cx, hipY, cx - h * LEG_SPREAD, feetY),
        segment(cx, hipY, cx + h * LEG_SPREAD, feetY),
      ].join(' ');
      // Head and body are separate drawables so the head can be a true circle.
      return [
        gen.circle(cx, cy - h * HEAD_ABOVE, h * HEAD_RADIUS * 2, opts),
        gen.path(body, { ...opts, fill: undefined }),
      ];
    }
    case 'crossOut': {
      // Corner to corner over the target's own bounds, which is what makes it
      // read as "this one, no" rather than as a stray diagonal. A target that
      // is not there, or is itself a cross, draws nothing -- `layOutScenes`
      // reports that so the model can be asked to fix it, but the answer here
      // is never to guess at some other shape on its behalf.
      const target = shapes?.[shape.target];
      if (target === undefined || target.kind === 'crossOut') {
        return [];
      }
      const box = shapeBox(target, shapes);
      if (box === null) {
        return [];
      }
      return [
        gen.path(
          `${segment(box.x1, box.y1, box.x2, box.y2)} ${segment(box.x1, box.y2, box.x2, box.y1)}`,
          opts,
        ),
      ];
    }
    case 'label':
      // Labels are text, not geometry; see `labelPlacement`.
      return [];
  }
}

/* ──────────────────────── memoised public API ───────────────────── */

const pathsMemo = new Map<string, DrawnPath[]>();

/**
 * Path data for one shape. Computed once, then reused for every frame.
 *
 * `shapes` is the scene the shape belongs to, and is only read by `crossOut`,
 * which is drawn from the bounds of the shape it crosses. Passing it for the
 * other eight costs a lookup and changes nothing -- the memo key does not
 * mention it, so their cache entries are shared as they always were.
 */
export function shapePaths(shape: Shape, shapes?: readonly Shape[]): DrawnPath[] {
  const key = memoKey(shape, shapes);
  const cached = pathsMemo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const name = shape.color ?? 'ink';
  const strokeColor = COLOR_VALUES[name];
  const fillColor = FILL_VALUES[name];
  const opts = baseOptions(
    shapeSeed(shape, shapes),
    strokeColor,
    FILLED.has(shape.kind) ? fillColor : undefined,
  );

  const gen = rough.generator();
  const paths: DrawnPath[] = [];
  for (const drawable of buildDrawables(gen, shape, opts, shapes)) {
    for (const set of drawable.sets) {
      paths.push(emit(gen, set, strokeColor, fillColor));
    }
  }
  pathsMemo.set(key, paths);
  return paths;
}

/** Where a label's text goes, in board pixels, plus its resolved ink. */
export function labelPlacement(shape: Extract<Shape, { kind: 'label' }>): LabelPlacement {
  return {
    x: toBoardX(shape.x),
    y: toBoardY(shape.y),
    text: shape.text,
    fontSize: toBoardLen(shape.size),
    color: COLOR_VALUES[shape.color ?? 'ink'],
  };
}
