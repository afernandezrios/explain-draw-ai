/**
 * Where the shapes actually end up.
 *
 * The model is asked for a storyboard in absolute board coordinates, and it is
 * asked for the relationships between those shapes -- which label names which
 * box, which arrow joins which two things. It is good at the second and bad at
 * the first, because the first is arithmetic it cannot do: it does not know how
 * wide a word will be in Caveat at size 6, so it cannot centre that word in a
 * circle, and it cannot find the point where a line meets a rectangle's edge.
 * Measured across the storyboards in this repo before this module existed, half
 * the labels overflowed the shape they named and a third of the arrows ended in
 * empty space.
 *
 * So the division of labour is: the model says what relates to what, and this
 * module computes where that leaves everything. It is pure -- no clock, no
 * randomness, no I/O -- and it is a **fixed point**: laying out an already
 * laid-out scene returns it unchanged. That matters because it runs on every
 * path that reads a storyboard (generation, `readScenes`, the worker's own
 * `loadScenes`), and a pass that drifted would make a scene look one way in the
 * preview and another way in the render.
 *
 * It never refuses anything. An anchor it cannot resolve -- a missing shape, a
 * kind that cannot be joined -- is cleared to null and the shape is drawn where
 * the model put it, with a line reported in the validator's own `path: message`
 * form so a repair pass can carry it back. Losing a whole storyboard over a
 * mis-numbered arrow would be a far worse outcome than drawing that one arrow
 * slightly wrong.
 */

import { BOARD_H, BOARD_W, toBoardLen, toBoardX, toBoardY } from './board.ts';
import { ARM_SPREAD, FEET_BELOW, HEAD_ABOVE, HEAD_RADIUS, LEG_SPREAD } from './figure.ts';
import { MIN_LABEL_SIZE, type Scene, type Scenes, type Shape } from './schema.ts';
import { textWidthEm } from './text-metrics.ts';

/* ────────────────────────── what may anchor to what ─────────────── */

/** What a label can sit inside and be centred in. A figure wears a caption. */
const LABEL_CONTAINERS: ReadonlySet<Shape['kind']> = new Set<Shape['kind']>([
  'box',
  'circle',
  'cloud',
]);

/**
 * What an arrow or a line can run between. A stick figure is a thing in the
 * diagram -- people are most of what a diagram is about -- so it is linkable;
 * a label is not, because a line to a word is a line to the word's *subject*,
 * and the model can say that directly by pointing at the shape itself.
 */
const LINKABLE: ReadonlySet<Shape['kind']> = new Set<Shape['kind']>([
  'box',
  'circle',
  'cloud',
  'stickFigure',
]);

/** What a cross can be drawn over. Anything with a footprint, words included. */
const CROSSABLE: ReadonlySet<Shape['kind']> = new Set<Shape['kind']>([
  'box',
  'circle',
  'cloud',
  'stickFigure',
  'label',
]);

/* ───────────────────────────── tuning ───────────────────────────── */

/**
 * How much of its container a label may fill across, and down.
 *
 * Text that fills a box edge to edge reads as cramped even though it fits, and
 * a caption that fills its circle has no room for the stroke. Shrinking stops
 * at `MIN_LABEL_SIZE` regardless -- past that the words stop being words, and a
 * too-big label that overhangs slightly is more legible than a tiny one that
 * fits.
 */
const LABEL_FIT_WIDTH = 0.86;
const LABEL_FIT_HEIGHT = 0.6;

/**
 * Where the baseline sits relative to a vertically centred line of text. The
 * face hangs most of its mass above the baseline, so centring the baseline
 * itself would ride the words visibly high.
 */
const BASELINE_SINK = 0.35;

/** A caption is sized off its figure, within these. */
const CAPTION_RATIO = 0.4;
const CAPTION_MAX_SIZE = 8;
const CAPTION_GAP = 1.05;

/** Distinct from any real gap, so "no room" is not mistaken for "nearly none". */
const MIN_UNDERLINE_WIDTH = 2;

/* ──────────────────────────── geometry ──────────────────────────── */

export type Box = { x1: number; y1: number; x2: number; y2: number };

function boxWidthPx(box: Box): number {
  return box.x2 - box.x1;
}

function boxHeightPx(box: Box): number {
  return box.y2 - box.y1;
}

function centreOf(box: Box): { x: number; y: number } {
  return { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
}

/** A length the model gives as a percent of board width, in pixels. */
function widthPx(percent: number): number {
  return toBoardX(percent);
}

/** A run of text as it will be drawn, in board pixels. */
function labelWidthPx(text: string, size: number): number {
  return textWidthEm(text) * toBoardLen(size);
}

/** The same, back in the units `x` and `w` are written in. */
function labelWidthPercent(text: string, size: number): number {
  return (labelWidthPx(text, size) / BOARD_W) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The box a shape occupies, in board pixels, or null for the shapes that are
 * only a line and have no area.
 *
 * `shapes` is needed for one kind: a `crossOut` has no position of its own and
 * takes its target's. Anything else ignores it.
 */
export function shapeBox(shape: Shape, shapes?: readonly Shape[]): Box | null {
  switch (shape.kind) {
    case 'box':
      return {
        x1: toBoardX(shape.x),
        y1: toBoardY(shape.y),
        x2: toBoardX(shape.x + shape.w),
        y2: toBoardY(shape.y + shape.h),
      };
    case 'circle': {
      // Isotropic: a radius is a percent of board *height*, which in pixels is
      // the same distance on both axes. That is the whole reason circles stay
      // round on a 16:9 board.
      const r = toBoardLen(shape.r);
      const cx = toBoardX(shape.x);
      const cy = toBoardY(shape.y);
      return { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r };
    }
    case 'cloud':
      return {
        x1: toBoardX(shape.x - shape.w / 2),
        y1: toBoardY(shape.y - shape.h / 2),
        x2: toBoardX(shape.x + shape.w / 2),
        y2: toBoardY(shape.y + shape.h / 2),
      };
    case 'stickFigure': {
      // The bounds of the drawing, not of the `x`,`y` centre -- the figure
      // hangs from its head, so its box is lopsided about that point. Same
      // arithmetic the board-extent check does; see `figure.ts` for the joints.
      const h = toBoardLen(shape.height);
      const side = h * Math.max(ARM_SPREAD, LEG_SPREAD);
      const cx = toBoardX(shape.x);
      const cy = toBoardY(shape.y);
      return {
        x1: cx - side,
        y1: cy - h * (HEAD_ABOVE + HEAD_RADIUS),
        x2: cx + side,
        y2: cy + h * FEET_BELOW,
      };
    }
    case 'label':
      return {
        x1: toBoardX(shape.x),
        y1: toBoardY(shape.y - shape.size),
        x2: toBoardX(shape.x) + labelWidthPx(shape.text, shape.size),
        y2: toBoardY(shape.y),
      };
    case 'crossOut': {
      // Drawn on its target, so it reaches exactly as far as the target does.
      const target = shapes?.[shape.target];
      if (target === undefined || target.kind === 'crossOut') {
        return null;
      }
      return shapeBox(target, shapes);
    }
    case 'arrow':
    case 'connector':
    case 'underline':
      // A line, with no area to centre anything in or cross anything out over.
      return null;
  }
}

/**
 * How far the boundary of an ellipse inscribed in `halfW` x `halfH` lies from
 * its centre, along the unit direction `(dx, dy)`. A circle is the case where
 * the two halves are equal; a cloud is close enough to one on the outside.
 */
function ellipseReach(halfW: number, halfH: number, dx: number, dy: number): number {
  return 1 / Math.hypot(dx / halfW, dy / halfH);
}

/** The same for a rectangle: whichever side the ray leaves through, first. */
function rectReach(halfW: number, halfH: number, dx: number, dy: number): number {
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  return Math.min(tx, ty);
}

/* ─────────────────────────── caption ────────────────────────────── */

export type CaptionPlacement = {
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

/**
 * Where a figure's caption goes, and how big it is drawn. Exported because the
 * renderer needs it too: a caption is not a shape in the storyboard -- see the
 * note on `layOutScenes` -- so `svg.ts` asks for this rather than looking one
 * up, and both the preview and the render get the same answer from the same
 * arithmetic.
 *
 * Centred under the feet, and pushed back onto the board if that would hang it
 * off an edge.
 */
export function captionPlacement(figure: Extract<Shape, { kind: 'stickFigure' }>): CaptionPlacement | null {
  const text = figure.label;
  if (text === null || text === undefined || text.trim() === '') {
    return null;
  }
  const size = Math.min(
    CAPTION_MAX_SIZE,
    Math.max(MIN_LABEL_SIZE, Math.round(figure.height * CAPTION_RATIO)),
  );
  const width = labelWidthPx(text, size);
  const centreX = toBoardX(figure.x);
  // Clamped rather than allowed to overhang: a caption half off the board is
  // worse than a caption not quite under its figure.
  const x = Math.min(Math.max(centreX - width / 2, 0), BOARD_W - width);
  const feet = toBoardY(figure.y) + toBoardLen(figure.height) * FEET_BELOW;
  const baseline = feet + toBoardLen(size) * CAPTION_GAP;
  return {
    x: round2(x),
    y: round2(Math.min(baseline, BOARD_H - 2)),
    text,
    fontSize: size,
  };
}

/* ─────────────────────────── the pass ───────────────────────────── */

export type LayoutOutcome = {
  scenes: Scenes;
  /**
   * Anchors that could not be resolved and were cleared, one line each in the
   * `path: message` form `validateScenes` uses -- so a repair pass can hand
   * them back exactly as it hands back validation errors.
   */
  issues: string[];
};

/** One label, centred in the shape it names and shrunk until it fits inside. */
function fitLabelInto(
  label: Extract<Shape, { kind: 'label' }>,
  container: Box,
): { x: number; y: number; size: number } {
  // The size that fits, before we consider what the model asked for: how much
  // of the container the text may span, divided by how much one em of this
  // text costs at that size.
  const em = textWidthEm(label.text);
  const widthRoom = boxWidthPx(container) * LABEL_FIT_WIDTH;
  const heightRoom = boxHeightPx(container) * LABEL_FIT_HEIGHT;
  const sizeForWidth = em === 0 ? label.size : (widthRoom / (em * BOARD_H)) * 100;
  const sizeForHeight = (heightRoom / BOARD_H) * 100;
  const size = Math.max(
    MIN_LABEL_SIZE,
    Math.min(label.size, sizeForWidth, sizeForHeight),
  );

  const centre = centreOf(container);
  const width = labelWidthPx(label.text, size);
  // Clamped onto the board: when even the smallest size overflows, overhanging
  // inwards is better than half the word leaving the paper.
  const x = Math.min(Math.max(centre.x - width / 2, 0), BOARD_W - width);
  const y = centre.y + toBoardLen(size) * BASELINE_SINK;
  return { x: (x / BOARD_W) * 100, y: (y / BOARD_H) * 100, size };
}

/**
 * Resolves every anchor in one scene.
 *
 * Order is load-bearing and is the order the dependencies run: labels first,
 * because underlines are sized to them and a cross can be drawn over one;
 * then lines, whose ends snap to shapes that never move.
 */
function layOutScene(scene: Scene, sceneIndex: number): { scene: Scene; issues: string[] } {
  const issues: string[] = [];
  const shapes: Shape[] = scene.shapes.map((shape) => ({ ...shape }));

  const note = (index: number, field: string, message: string): void => {
    issues.push(`${sceneIndex}.shapes.${index}.${field}: ${message}`);
  };

  /**
   * Checks one anchor and returns the index if it can be used, or null if it
   * cannot -- reporting why, in the model's own vocabulary, when it cannot.
   */
  const resolve = (
    target: number | null | undefined,
    allowed: ReadonlySet<Shape['kind']>,
    self: number,
    field: string,
  ): number | null => {
    if (target === null || target === undefined) {
      return null;
    }
    const found = shapes[target];
    if (found === undefined) {
      note(self, field, `this scene has no shape ${target} to point at`);
      return null;
    }
    if (target === self) {
      note(self, field, 'a shape cannot point at itself');
      return null;
    }
    if (!allowed.has(found.kind)) {
      note(
        self,
        field,
        `shape ${target} is a ${found.kind}, and this can only point at ${[...allowed].join(' or ')}`,
      );
      return null;
    }
    return target;
  };

  /* 1. labels: centred in what they name, and shrunk until they fit. */
  /** Which label already took which container, for the clash report below. */
  const claimed = new Map<number, number>();
  shapes.forEach((shape, index) => {
    if (shape.kind !== 'label') {
      return;
    }
    const target = resolve(shape.inShape, LABEL_CONTAINERS, index, 'inShape');
    if (target === null) {
      // Cleared only if it was there to clear. Writing `null` into a field the
      // model never sent would add a key to every label in the storyboard, and
      // a scene with no anchors is supposed to come back untouched.
      if (shape.inShape !== undefined) {
        shape.inShape = null;
      }
      return;
    }
    const container = shapeBox(shapes[target], shapes);
    if (container === null) {
      return;
    }
    // Centring is what this pass is for, and centring two labels in one shape
    // writes them on top of each other -- worse than what the model left, which
    // at least had them apart. The overlap is reported for repair, but both are
    // still centred: the contract is "a label is centred in what it names", and
    // a pass that sometimes declined to honour it would be harder to predict
    // than one that always does and says when the result is a pile-up.
    const other = claimed.get(target);
    if (other !== undefined) {
      note(
        index,
        'inShape',
        `shape ${target} is already named by label ${other}; a shape holds one label`,
      );
    } else {
      claimed.set(target, index);
    }
    const fitted = fitLabelInto(shape, container);
    shape.x = round2(fitted.x);
    shape.y = round2(fitted.y);
    shape.size = round2(fitted.size);
  });

  /* 2. underlines: run under the label they name, exactly as wide as it is. */
  shapes.forEach((shape, index) => {
    if (shape.kind !== 'underline') {
      return;
    }
    const target = resolve(shape.underLabel, new Set<Shape['kind']>(['label']), index, 'underLabel');
    if (target === null) {
      if (shape.underLabel !== undefined) {
        shape.underLabel = null;
      }
      return;
    }
    const label = shapes[target];
    if (label.kind !== 'label') {
      return;
    }
    // Never past the right edge: `checkBoardExtents` refuses `x + w > 100`, and
    // a complaint layout itself caused would survive every repair the model
    // could attempt, so it must not arise. The room is measured from the
    // *rounded* x -- the value that will be written -- because a label's own x
    // is only two decimals when it was laid out, and the un-rounded pair can
    // round its way past the edge.
    const x = round2(label.x);
    const room = round2(100 - x);
    const width = Math.min(round2(labelWidthPercent(label.text, label.size)), room);
    if (width < MIN_UNDERLINE_WIDTH) {
      note(index, 'underLabel', 'there is no room on the board to underline that label');
      shape.underLabel = null;
      return;
    }
    shape.x = x;
    shape.w = width;
  });

  /* 3. arrows and lines: ends placed on the edge of what they join. */
  shapes.forEach((shape, index) => {
    if (shape.kind !== 'arrow' && shape.kind !== 'connector') {
      return;
    }
    const from = resolve(shape.fromShape, LINKABLE, index, 'fromShape');
    const to = resolve(shape.toShape, LINKABLE, index, 'toShape');
    if (from === null && shape.fromShape !== undefined) {
      shape.fromShape = null;
    }
    if (to === null && shape.toShape !== undefined) {
      shape.toShape = null;
    }
    if (from === null && to === null) {
      return;
    }

    // Both ends anchored means the line runs centre to centre, which is the
    // one direction that does not depend on where the ends currently are --
    // and so the one that leaves this pass a fixed point. Were each end to aim
    // at the other's stored position, the second run would move both again.
    const fromBox = from === null ? null : shapeBox(shapes[from], shapes);
    const toBox = to === null ? null : shapeBox(shapes[to], shapes);
    const fromCentre = fromBox === null ? null : centreOf(fromBox);
    const toCentre = toBox === null ? null : centreOf(toBox);

    if (from !== null && fromBox !== null && fromCentre !== null) {
      const aim = toCentre ?? { x: toBoardX(shape.to.x), y: toBoardY(shape.to.y) };
      snapToEdge(shape, shapes[from], fromBox, fromCentre, aim, 'from');
    }
    if (to !== null && toBox !== null && toCentre !== null) {
      const aim = fromCentre ?? { x: toBoardX(shape.from.x), y: toBoardY(shape.from.y) };
      snapToEdge(shape, shapes[to], toBox, toCentre, aim, 'to');
    }
  });

  /* 4. crosses: reported when they point at nothing. */
  shapes.forEach((shape, index) => {
    if (shape.kind !== 'crossOut') {
      return;
    }
    // Reported rather than cleared, which is the one place this pass differs
    // from the others: `target` is a required field with no null to fall back
    // to, so a cross that points nowhere is not drawn at all (see
    // `buildDrawables`) and the note is the only thing that lets the model be
    // asked to point it somewhere real.
    resolve(shape.target, CROSSABLE, index, 'target');
  });

  return { scene: { ...scene, shapes }, issues };
}

/**
 * Moves one end of a line onto the boundary of the shape it is anchored to,
 * along the line from that shape's centre toward `aim`.
 *
 * The aim is the far end of the line, or the far *shape's* centre when that end
 * is anchored too -- see the note in the caller for why that is the stable
 * choice rather than the tidier-looking one.
 */
function snapToEdge(
  line: Extract<Shape, { kind: 'arrow' | 'connector' }>,
  /** The shape this end lands on: its kind picks the edge, its bounds the maths. */
  target: Shape,
  box: Box,
  centre: { x: number; y: number },
  aim: { x: number; y: number },
  end: 'from' | 'to',
): void {
  const dx = aim.x - centre.x;
  const dy = aim.y - centre.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    // The line has no direction to snap along. Leaving the point where the
    // model put it beats dividing by zero to invent one.
    return;
  }
  const halfW = boxWidthPx(box) / 2;
  const halfH = boxHeightPx(box) / 2;
  // A round shape is met at its outline; anything else at the rectangle around
  // it, which is where a box's own ink is. Reading the kind off the *target* is
  // the point: the line arriving is an arrow whatever it lands on.
  const reach =
    target.kind === 'circle' || target.kind === 'cloud'
      ? ellipseReach(halfW, halfH, dx / length, dy / length)
      : rectReach(halfW, halfH, dx / length, dy / length);
  const point = {
    x: round2(((centre.x + (dx / length) * reach) / BOARD_W) * 100),
    y: round2(((centre.y + (dy / length) * reach) / BOARD_H) * 100),
  };
  if (end === 'from') {
    line.from = point;
  } else {
    line.to = point;
  }
}

/**
 * Resolves every scene's anchors, and says what it could not resolve.
 *
 * A shape with no anchors is returned exactly as it was, coordinate for
 * coordinate -- there is no global rounding, so a storyboard written before
 * anchors existed comes back byte-identical.
 */
export function layOutScenes(scenes: Scenes): LayoutOutcome {
  const issues: string[] = [];
  const laid = scenes.map((scene, index) => {
    const result = layOutScene(scene, index);
    issues.push(...result.issues);
    return result.scene;
  });
  return { scenes: laid, issues };
}
