/**
 * The Scene DSL: the one contract every stage of the pipeline reads.
 *
 * `textToScript` -> `scriptToScenes` -> `scenesToVideo` all agree on this shape,
 * the model is asked for exactly this shape, and the render worker refuses to
 * draw a `scenes.json` that does not validate against it.
 *
 * Two rules constrain the schema definitions below, and both are load-bearing:
 *
 *  1. This schema is ALSO what generates the JSON Schema we send to the model
 *     (see `scenesResponseFormat` in llm.ts). The provider's strict structured
 *     output accepts only a subset of JSON Schema, so:
 *       - the root must be an object, hence the `{ scenes: [...] }` envelope
 *       - `.optional()` is rejected; absent values must be `.nullable()`
 *       - `.default()` emits a `default` keyword, which is rejected
 *       - array `.min()/.max()` emit minItems/maxItems, which are rejected
 *     Bounds on numbers are fine, and that is where the per-scene caps live.
 *
 *  2. The model-facing prompt derives its vocabulary from the constants here --
 *     `SCENES_SYSTEM_PROMPT` in llm.ts is built by mapping over `SHAPE_KINDS`
 *     and `SHAPE_NOTES` and reading the caps above -- so the prompt and the
 *     validator cannot drift apart.
 */

import { z } from 'zod';
// Explicit .ts extension: this module is also loaded by the render worker, a
// plain Node process that runs these files directly via type stripping, and
// Node requires the extension on relative imports. Webpack and esbuild resolve
// the same specifier, so one convention serves all three consumers.
import { BOARD_H, BOARD_W, COLOR_NAMES } from './board.ts';
import { ARM_SPREAD, FEET_BELOW, HEAD_ABOVE, HEAD_RADIUS, LEG_SPREAD } from './figure.ts';

/* ────────────────────────────── caps ────────────────────────────── */

export const MIN_SCENE_SECONDS = 7;
export const MAX_SCENE_SECONDS = 20;

/**
 * The one and only label-word constant. It caps the total number of words
 * across every label in a scene, so a single label can never exceed it either
 * -- which is why there is no second per-label constant to disagree with.
 */
export const MAX_LABEL_WORDS = 20;

export const MIN_LABEL_SIZE = 4;
export const MAX_LABEL_SIZE = 14;

export const MIN_SHAPES_PER_SCENE = 3;
export const MAX_SHAPES_PER_SCENE = 12;

/** Where a ~5 minute video should land, and the window the renderer accepts. */
export const TARGET_TOTAL_SECONDS = 300;
export const MIN_TOTAL_SECONDS = 270;
export const MAX_TOTAL_SECONDS = 330;

/* ─────────────────────────── primitives ─────────────────────────── */

/**
 * Every number in the DSL is a percentage of the 16:9 board, which is what
 * makes a scene render identically at preview size and at 1920x1080.
 * `Percent` spans one axis; `Height` is isotropic, so round things stay round.
 */
const Percent = z.number().min(0).max(100);
const Height = z.number().min(2).max(100).describe('percent of board height');
const LabelSize = z
  .number()
  .min(MIN_LABEL_SIZE)
  .max(MAX_LABEL_SIZE)
  .describe('text height as a percent of board height');

const PointSchema = z.object({
  x: Percent.describe('horizontal position, 0 = left edge, 100 = right edge'),
  y: Percent.describe('vertical position, 0 = top edge, 100 = bottom edge'),
});

const ColorSchema = z
  .enum(COLOR_NAMES)
  .nullable()
  .describe('null for the default dark ink; accent is the single blue highlight; emphasis is red');

/* ──────────────────────── the shape vocabulary ──────────────────── */

/**
 * The eight doodles, keyed by kind. This object is the source of the kind list,
 * so adding a ninth kind automatically reaches the model through
 * `SHAPE_KINDS`; the exhaustive `SHAPE_NOTES` record below then forces you to
 * describe it rather than leaving the model silently unaware.
 */
const SHAPE_SPECS = {
  arrow: z.object({
    kind: z.literal('arrow'),
    from: PointSchema.describe('tail of the arrow'),
    to: PointSchema.describe('tip of the arrow'),
    color: ColorSchema,
  }),
  circle: z.object({
    kind: z.literal('circle'),
    x: Percent.describe('centre, across'),
    y: Percent.describe('centre, down'),
    r: Height.describe('radius, percent of board height'),
    color: ColorSchema,
  }),
  box: z.object({
    kind: z.literal('box'),
    x: Percent.describe('left edge, across'),
    y: Percent.describe('top edge, down'),
    w: Percent.describe('width, percent of board width'),
    h: Percent.describe('height, percent of board height'),
    color: ColorSchema,
  }),
  label: z.object({
    kind: z.literal('label'),
    x: Percent.describe('left edge of the text, across'),
    y: Percent.describe('baseline of the text, down'),
    text: z.string().min(1).max(160).describe('a few handwritten words, not a sentence'),
    size: LabelSize,
    color: ColorSchema,
  }),
  stickFigure: z.object({
    kind: z.literal('stickFigure'),
    x: Percent.describe('centre of the figure, across'),
    y: Percent.describe('centre of the figure, down'),
    height: Height.describe('total height head to feet, percent of board height'),
    color: ColorSchema,
  }),
  underline: z.object({
    kind: z.literal('underline'),
    x: Percent.describe('left end, across'),
    y: Percent.describe('the line sits just below this y'),
    w: Percent.describe('length, percent of board width'),
    color: ColorSchema,
  }),
  connector: z.object({
    kind: z.literal('connector'),
    from: PointSchema,
    to: PointSchema,
    color: ColorSchema,
  }),
  cloud: z.object({
    kind: z.literal('cloud'),
    x: Percent.describe('centre, across'),
    y: Percent.describe('centre, down'),
    w: Percent.describe('width, percent of board width'),
    h: Percent.describe('height, percent of board height'),
    color: ColorSchema,
  }),
} as const;

export type ShapeKind = keyof typeof SHAPE_SPECS;

/** Derived from the schema, never hand-listed. */
export const SHAPE_KINDS = Object.keys(SHAPE_SPECS) as ShapeKind[];

/** How each kind is laid out, fed to the model. Exhaustive by construction. */
export const SHAPE_NOTES: Record<ShapeKind, string> = {
  arrow: 'a wobbly arrow from `from` to `to`, with an open head at `to`',
  circle: 'an imperfect circle centred at `x`,`y` with radius `r`',
  box: 'a rough rectangle with its top-left corner at `x`,`y`',
  label: 'handwritten text anchored at its left edge and baseline',
  stickFigure: 'a stick person centred at `x`,`y`',
  underline: 'a wobbly line under text, starting at `x`,`y` and running right `w`',
  connector: 'a plain wobbly line from `from` to `to`, for linking two things',
  cloud: 'a cloud outline centred at `x`,`y`, for thoughts or "the cloud"',
};

const shapeVariants = Object.values(SHAPE_SPECS) as unknown as [
  (typeof SHAPE_SPECS)['arrow'],
  ...(typeof SHAPE_SPECS)[ShapeKind][],
];

export const ShapeSchema = z.discriminatedUnion('kind', shapeVariants);
export type Shape = z.infer<typeof ShapeSchema>;

/* ────────────────────────────── scenes ──────────────────────────── */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countLabelWords(shapes: Shape[]): number {
  return shapes
    .filter((s): s is Extract<Shape, { kind: 'label' }> => s.kind === 'label')
    .reduce((total, s) => total + countWords(s.text), 0);
}

const SceneObjectSchema = z.object({
  title: z.string().min(1).max(120).describe('a few words naming this scene, for the progress list'),
  durationSeconds: z
    .number()
    .min(MIN_SCENE_SECONDS)
    .max(MAX_SCENE_SECONDS)
    .describe(`how long this scene is drawn and held, ${MIN_SCENE_SECONDS}-${MAX_SCENE_SECONDS} seconds`),
  shapes: z.array(ShapeSchema).describe('everything drawn in this scene, in drawing order'),
});

/**
 * Nothing may be drawn off the board.
 *
 * Individual fields are in range by construction (every percent is 0-100), but
 * their *sum* is not: a box at x=80 with w=30 is a valid box whose right-hand
 * third is clipped away, and a label anchored inside it would be truncated too.
 *
 * Lengths are checked against the axis they are measured on. `w` is a percent of
 * board width; `h`, radii and figure heights are percents of board *height*, so
 * a length reaches `len * BOARD_H / BOARD_W` of the width. The two are not
 * interchangeable: `x + r` refuses a circle that fits the right edge and accepts
 * one hanging off the bottom.
 *
 * Anchored shapes (`box`, `underline`) cannot leave the left or the top: their
 * x and y *are* their left and top, and both are 0-100 already. Centred shapes
 * (`circle`, `cloud`, `stickFigure`) can poke out on any side, so all four are
 * checked.
 */
function checkBoardExtents(shapes: Shape[], ctx: z.RefinementCtx): void {
  /** A length in percent of board height, as a percent of board width. */
  const across = (len: number): number => (len * BOARD_H) / BOARD_W;

  const over = (index: number, field: string, reaches: number, edge: number): void => {
    ctx.addIssue({
      code: 'custom',
      path: ['shapes', index, field],
      message: `this shape reaches ${Number(reaches.toFixed(1))} on the board; the edge is ${edge}`,
    });
  };

  /** A centred shape, which reaches the same distance each way on that axis. */
  const centred = (index: number, field: string, near: number, far: number): void => {
    if (far > 100) {
      over(index, field, far, 100);
    }
    if (near < 0) {
      over(index, field, near, 0);
    }
  };

  shapes.forEach((shape, index) => {
    switch (shape.kind) {
      case 'box':
        if (shape.x + shape.w > 100) {
          over(index, 'w', shape.x + shape.w, 100);
        }
        if (shape.y + shape.h > 100) {
          over(index, 'h', shape.y + shape.h, 100);
        }
        break;
      case 'underline':
        if (shape.x + shape.w > 100) {
          over(index, 'w', shape.x + shape.w, 100);
        }
        break;
      case 'cloud':
        // `x`,`y` are the centre, so half of each size reaches either way.
        centred(index, 'w', shape.x - shape.w / 2, shape.x + shape.w / 2);
        centred(index, 'h', shape.y - shape.h / 2, shape.y + shape.h / 2);
        break;
      case 'circle': {
        const half = across(shape.r);
        centred(index, 'r', shape.x - half, shape.x + half);
        centred(index, 'r', shape.y - shape.r, shape.y + shape.r);
        break;
      }
      case 'stickFigure': {
        // Also centred, and `height` is isotropic: the feet are half a height
        // below the centre and the top of the head is `HEAD_ABOVE` plus the
        // head's radius above it (see `doodle.ts`).
        const { height: h } = shape;
        const side = across(h * Math.max(ARM_SPREAD, LEG_SPREAD));
        centred(index, 'height', shape.x - side, shape.x + side);
        centred(index, 'height', shape.y - h * (HEAD_ABOVE + HEAD_RADIUS), shape.y + h * FEET_BELOW);
        break;
      }
      case 'label':
      case 'arrow':
      case 'connector':
        // Positioned by points, each of which is already inside 0-100.
        break;
    }
  });
}

export const SceneSchema = SceneObjectSchema.superRefine((scene, ctx) => {
  const words = countLabelWords(scene.shapes);
  if (words > MAX_LABEL_WORDS) {
    ctx.addIssue({
      code: 'custom',
      path: ['shapes'],
      message: `scene has ${words} label words, over the cap of ${MAX_LABEL_WORDS}`,
    });
  }
  if (scene.shapes.length < MIN_SHAPES_PER_SCENE || scene.shapes.length > MAX_SHAPES_PER_SCENE) {
    ctx.addIssue({
      code: 'custom',
      path: ['shapes'],
      message: `scene draws ${scene.shapes.length} shapes, outside the range ${MIN_SHAPES_PER_SCENE}-${MAX_SHAPES_PER_SCENE}`,
    });
  }
  checkBoardExtents(scene.shapes, ctx);
});

export type Scene = z.infer<typeof SceneSchema>;

/** A storyboard, as stored in scenes.json and rendered by the worker. */
export const ScenesSchema = z.array(SceneSchema);
export type Scenes = z.infer<typeof ScenesSchema>;

/**
 * The envelope the model is asked for. The provider requires an object at the
 * JSON Schema root, so scenes travel wrapped; unwrap before validating.
 */
export const ScenesEnvelopeSchema = z.object({
  scenes: z.array(SceneSchema).describe('the storyboard, in order; scene 1 is the title scene'),
});

/* ──────────────────────────── validation ────────────────────────── */

export type ScenesValidation =
  | { ok: true; scenes: Scenes }
  | { ok: false; errors: string[] };

/**
 * Validates a storyboard, reporting every problem with its full path so the UI
 * can say exactly which field is wrong.
 */
export function validateScenes(input: unknown): ScenesValidation {
  const parsed = ScenesSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, scenes: parsed.data };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    }),
  };
}

/* ────────────────────────────── budget ──────────────────────────── */

export function totalSeconds(scenes: Scenes): number {
  return scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
}

/** m:ss at whole-second precision. */
export function formatClock(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export type BudgetCheck =
  | { ok: true; totalSeconds: number; roundedSeconds: number; message: string; label: string }
  | { ok: false; totalSeconds: number; roundedSeconds: number; message: string; label: string };

/**
 * The 270-330s window.
 *
 * The comparison and the message both use the same whole-second value. That is
 * deliberate: rounding only one of them produced a message like "totals 4:30,
 * below the 4:30 minimum". The total appears once in the message.
 *
 * `label` is the same verdict phrased for the UI to print, so the page never
 * has to re-derive the window or format a clock -- and never has to import this
 * module, which would pull zod into the browser bundle.
 */
export function checkBudget(scenes: Scenes): BudgetCheck {
  const total = totalSeconds(scenes);
  const rounded = Math.round(total);
  const window = `${formatClock(MIN_TOTAL_SECONDS)}-${formatClock(MAX_TOTAL_SECONDS)}`;

  if (rounded < MIN_TOTAL_SECONDS) {
    const message = `Storyboard totals ${formatClock(rounded)}, under the ${formatClock(
      MIN_TOTAL_SECONDS,
    )} minimum for a ~5 minute video. Regenerate the storyboard.`;
    return { ok: false, totalSeconds: total, roundedSeconds: rounded, message, label: message };
  }
  if (rounded > MAX_TOTAL_SECONDS) {
    const message = `Storyboard totals ${formatClock(rounded)}, over the ${formatClock(
      MAX_TOTAL_SECONDS,
    )} maximum for a ~5 minute video. Regenerate the storyboard.`;
    return { ok: false, totalSeconds: total, roundedSeconds: rounded, message, label: message };
  }
  return {
    ok: true,
    totalSeconds: total,
    roundedSeconds: rounded,
    message: `Storyboard totals ${formatClock(rounded)}, inside the ${window} window.`,
    label: `Storyboard totals ${formatClock(rounded)}, inside the ${window} window.`,
  };
}
