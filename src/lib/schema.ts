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
 *
 * What the model is *held to* is the structural half only: the refinements below
 * are applied on this side, where a storyboard that breaks one can still be sent
 * back for repair. `SceneShapeSchema` carries that reasoning.
 */

import { z } from 'zod';
// Explicit .ts extension: this module is also loaded by the render worker, a
// plain Node process that runs these files directly via type stripping, and
// Node requires the extension on relative imports. Webpack and esbuild resolve
// the same specifier, so one convention serves all three consumers.
import { BOARD_H, BOARD_W, COLOR_NAMES } from './board.ts';
import { ARM_SPREAD, FEET_BELOW, HEAD_ABOVE, HEAD_RADIUS, LEG_SPREAD } from './figure.ts';
import { BULLET_MAX_ITEMS, bulletItemSize, bulletListHeight } from './list-metrics.ts';

/* ────────────────────────────── caps ────────────────────────────── */

export const MIN_SCENE_SECONDS = 7;
export const MAX_SCENE_SECONDS = 20;

/**
 * The one and only label-word constant. It caps the total number of words
 * across every label in a scene, so a single label can never exceed it either
 * -- which is why there is no second per-label constant to disagree with.
 */
export const MAX_LABEL_WORDS = 20;

/**
 * How fast narration is spoken: words per second. The single constant behind
 * both the rule the model is given and the cap the validator enforces -- a
 * scene's duration sets its narration word budget (`maxNarrationWords`), and the
 * render worker refuses narration audio that would overrun the scene rather than
 * speeding the voice up to fit.
 *
 * Calibrated against the voice that speaks it. Piper measured ~3.6 words/s, so
 * the long-standing 2.5 left ~30% of slack; Kokoro's af_heart measured 2.28-3.05
 * across a real storyboard (mean 2.60) and scenes written to the full 2.5 budget
 * were refused at the slow end, so the rate is 2.0 -- about 12% under the
 * slowest measured text. Re-measure when `KOKORO_VOICE` changes.
 */
export const NARRATION_WPS = 2.0;

/**
 * The words one scene's narration may run to: that scene's own length at
 * `NARRATION_WPS`, floored. Per-scene rather than one flat number, so a 7 second
 * scene is held to a shorter line than a 20 second one -- and the prompt quotes
 * the same arithmetic.
 */
export function maxNarrationWords(durationSeconds: number): number {
  return Math.floor(durationSeconds * NARRATION_WPS);
}

/**
 * The schema's own length cap on one scene's narration, which the provider's
 * strict mode requires as a bound on the string. Derived from the word budget
 * that actually binds -- the longest scene's words, at a deliberately roomy
 * 12 characters per word -- so a narration that fits its scene can never trip
 * this first no matter how long its words are. The per-scene word check is the
 * rule; this only keeps the field finite for the provider.
 */
export const NARRATION_MAX_CHARS = maxNarrationWords(MAX_SCENE_SECONDS) * 12;

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
  .describe(
    'null for the default dark ink; accent is the blue highlight; emphasis is red for failures or removals; success and warn are green and amber for good and bad; violet, teal and gray are extra categories and de-emphasised parts',
  );

/* ──────────────────────────── anchors ───────────────────────────── */

/**
 * An anchor says which *other shape* a shape belongs to, by its index in the
 * same scene's `shapes` array.
 *
 * This is the difference between a pile of coordinates and a diagram. A label
 * that names a box can say which box, and `layOutScenes` then centres it in
 * that box and shrinks it until it fits; an arrow can say which two things it
 * joins, and the layout pass moves its ends onto their edges. The model is good
 * at the relationship -- "this arrow runs from the users to the server" -- and
 * bad at the arithmetic that relationship implies, because it cannot know how
 * wide a word will be in this handwriting or where a circle's edge falls. So
 * the model states the relationship and the code computes the geometry.
 *
 * Anchors are optional in the stored form: a scene with none is laid out
 * exactly as written, which is what every storyboard generated before this
 * existed is. Whether an anchor actually *resolves* -- the index in range, the
 * target of an acceptable kind -- is a whole-scene question and is settled by
 * the layout pass and the refinements below, not by these field definitions.
 */
function shapeRef(description: string) {
  return z
    .number()
    .int()
    .min(0)
    .max(MAX_SHAPES_PER_SCENE - 1)
    .nullable()
    .optional()
    .describe(`${description}; 0-based index into this scene's shapes, or null`);
}

/** A caption under a stick figure. Optional, and empty is not a caption. */
function optionalCaption() {
  return z
    .string()
    .min(1)
    .max(160)
    .nullable()
    .optional()
    .describe(
      'a short caption drawn beneath the figure, or null for none; counts toward the scene label-word budget',
    );
}

/**
 * A short run of text a shape carries and draws itself -- a card's title, a
 * badge's symbol, a list's heading. Optional in the stored form and
 * required-nullable in the provider form, the same treatment a caption gets,
 * and for the same reason: a model that leaves out a field whose only sensible
 * value was `null` should not cost the storyboard. See `ANCHORED_FIELDS`.
 */
function optionalText(max: number, description: string) {
  return z.string().min(1).max(max).nullable().optional().describe(description);
}

/**
 * The provider-facing form of an anchored field: the same field with its
 * `.optional()` stripped, so it is required-but-nullable.
 *
 * Stripping beats writing the field a second time with the same bounds and
 * description, which is a pair that can drift. The strict structured-output
 * subset has no way to say "may be absent" -- every property must appear in
 * `required` -- so absence is spelled `null`, and this is the one place that
 * knows it. See `SHAPE_SPECS` below for where it is applied.
 */
function anchored(field: z.ZodTypeAny): z.ZodTypeAny {
  // Stripped, not re-wrapped. `.nullable()` on an optional leaves the result
  // optional, the JSON Schema keeps the field out of `required`, and the model
  // is never told it exists -- which is the one thing this is here to prevent.
  // So both wrappers come off before the one that stays goes back on.
  //
  // The cast is zod's typing, not ours: `unwrap()` on the classic classes is
  // declared against the core schema they are built on, so the compiler loses
  // track of a value that is the very schema passed in.
  let bare: z.ZodTypeAny = field;
  while (bare instanceof z.ZodOptional || bare instanceof z.ZodNullable) {
    bare = bare.unwrap() as z.ZodTypeAny;
  }
  return bare.nullable();
}

/* ──────────────────────── the shape vocabulary ──────────────────── */

/**
 * The shape vocabulary, keyed by kind. This object is the source of the kind
 * list, so adding a shape kind automatically reaches the model through
 * `SHAPE_KINDS`; the exhaustive `SHAPE_NOTES` record below then forces you to
 * describe it rather than leaving the model silently unaware.
 *
 * The first nine are the primitives; the last five are composites -- one shape
 * that carries the words and structure of several primitives, so a scene gets
 * more done inside the 12-shape cap.
 */
const SHAPE_SPECS = {
  arrow: z.object({
    kind: z.literal('arrow'),
    from: PointSchema.describe('tail of the arrow'),
    to: PointSchema.describe('tip of the arrow'),
    fromShape: shapeRef('the shape the arrow starts on'),
    toShape: shapeRef('the shape the arrow points into'),
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
    inShape: shapeRef('the shape this text sits inside and names'),
    size: LabelSize,
    color: ColorSchema,
  }),
  stickFigure: z.object({
    kind: z.literal('stickFigure'),
    x: Percent.describe('centre of the figure, across'),
    y: Percent.describe('centre of the figure, down'),
    height: Height.describe('total height head to feet, percent of board height'),
    label: optionalCaption(),
    color: ColorSchema,
  }),
  underline: z.object({
    kind: z.literal('underline'),
    x: Percent.describe('left end, across'),
    y: Percent.describe('the line sits just below this y'),
    w: Percent.describe('length, percent of board width'),
    underLabel: shapeRef('the label this line runs under'),
    color: ColorSchema,
  }),
  connector: z.object({
    kind: z.literal('connector'),
    from: PointSchema,
    to: PointSchema,
    fromShape: shapeRef('the shape the line starts on'),
    toShape: shapeRef('the shape the line ends on'),
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
  crossOut: z.object({
    kind: z.literal('crossOut'),
    target: z
      .number()
      .int()
      .min(0)
      .max(MAX_SHAPES_PER_SCENE - 1)
      .describe('0-based index of the shape to cross out; the X lands on its bounds'),
    color: ColorSchema,
  }),
  card: z.object({
    kind: z.literal('card'),
    x: Percent.describe('left edge, across'),
    y: Percent.describe('top edge, down'),
    w: Percent.describe('width, percent of board width'),
    h: Percent.describe('height, percent of board height'),
    title: optionalText(
      80,
      'a few words drawn inside the top of the card, or null for a plain card; counts toward the scene label-word budget',
    ),
    color: ColorSchema,
  }),
  container: z.object({
    kind: z.literal('container'),
    x: Percent.describe('left edge, across'),
    y: Percent.describe('top edge, down'),
    w: Percent.describe('width, percent of board width'),
    h: Percent.describe('height, percent of board height'),
    color: ColorSchema,
  }),
  badge: z.object({
    kind: z.literal('badge'),
    x: Percent.describe('centre, across'),
    y: Percent.describe('centre, down'),
    r: Height.describe('radius, percent of board height'),
    text: optionalText(
      3,
      'a 1-3 character symbol drawn inside the badge, like a step number or a tick, or null for an empty dot; counts toward the scene label-word budget',
    ),
    color: ColorSchema,
  }),
  bulletList: z.object({
    kind: z.literal('bulletList'),
    x: Percent.describe('left edge, across'),
    y: Percent.describe('top edge, down; the list runs down from here'),
    w: Percent.describe('width, percent of board width'),
    title: optionalText(
      80,
      'a heading drawn above the items, or null for an untitled list; counts toward the scene label-word budget',
    ),
    items: z
      .array(z.string().min(1).max(80))
      .describe(
        'one short phrase per bullet, first to last; every word counts toward the scene label-word budget',
      ),
    color: ColorSchema,
  }),
  divider: z.object({
    kind: z.literal('divider'),
    x: Percent.describe('left end, across'),
    y: Percent.describe('the line runs through this y'),
    w: Percent.describe('length, percent of board width'),
    color: ColorSchema,
  }),
} as const;

export type ShapeKind = keyof typeof SHAPE_SPECS;

/** Derived from the schema, never hand-listed. */
export const SHAPE_KINDS = Object.keys(SHAPE_SPECS) as ShapeKind[];

/** How each kind is laid out, fed to the model. Exhaustive by construction. */
export const SHAPE_NOTES: Record<ShapeKind, string> = {
  arrow:
    'an arrow from `from` to `to`, with a solid head at `to`; name the two shapes it joins in `fromShape`/`toShape` and its ends are moved onto their edges for you',
  circle: 'a clean circle centred at `x`,`y` with radius `r`',
  box: 'a crisp rounded rectangle with its top-left corner at `x`,`y`',
  label:
    'handwritten text anchored at its left edge and baseline; name the box, circle or cloud it sits in via `inShape` and it is centred inside that shape and shrunk until it fits. One label per shape: a second label naming the same shape lands on top of the first',
  stickFigure:
    'a stick person centred at `x`,`y`; put whatever it represents in `label` and the words are written under its feet, so it is never an unlabelled figure',
  underline:
    'a line under text, starting at `x`,`y` and running right `w`; name the label in `underLabel` and the line is sized to the words it underlines',
  connector:
    'a plain line from `from` to `to`, for linking two things; name the shapes in `fromShape`/`toShape` and its ends are moved onto their edges',
  cloud: 'a cloud outline centred at `x`,`y`, for thoughts or "the cloud"',
  crossOut:
    'a large X drawn across another shape, for something broken, cancelled or removed; `target` is the index of the shape it crosses',
  card: 'a flat rounded rectangle at `x`,`y` with a few words in `title` drawn inside its top; use it for one concept -- a titled card with a label centred in it beats a box plus a separate title label',
  container:
    'a large dashed rounded rectangle with a faint tint, drawn behind other shapes to group them; list it BEFORE the shapes inside it so they draw on top',
  badge:
    'a small filled circle centred at `x`,`y` holding a 1-3 character symbol in `text`, like a numbered step or a tick; size it with `r`',
  bulletList:
    'a titled list running down the board from `x`,`y`: `title` first, then each `items` phrase on its own dotted line, at most 6 short phrases; every word counts toward the scene label-word budget',
  divider:
    'a short horizontal rule from `x`,`y` running right `w`, for separating one part of the board from another',
};

/**
 * Which fields are optional in the stored form and required-but-nullable for
 * the provider. Most are anchors, which say which other shape a shape belongs
 * to; `stickFigure.label` and the composite kinds' text fields are carried text
 * rather than anchors, but they need the same treatment -- the strict subset has
 * no way to leave a property out of `required`. Adding one here reaches the
 * provider.
 */
const ANCHORED_FIELDS: Partial<Record<ShapeKind, readonly string[]>> = {
  arrow: ['fromShape', 'toShape'],
  label: ['inShape'],
  stickFigure: ['label'],
  underline: ['underLabel'],
  connector: ['fromShape', 'toShape'],
  card: ['title'],
  badge: ['text'],
  bulletList: ['title'],
};

/**
 * The same vocabulary with every anchored field made required-but-nullable,
 * built from `SHAPE_SPECS` rather than written out again -- re-declaring the
 * fields would be a second copy of their bounds and descriptions, and two
 * copies of `0..11` do not stay equal.
 *
 * Kinds with nothing to make required pass through untouched, so this cannot
 * alter a shape that has no anchors to speak of.
 */
function providerVariantsFor(kind: ShapeKind): z.ZodTypeAny {
  // The kind is a runtime value here, so the union's per-kind types are gone;
  // the fields are read back out and extended generically. `ANCHORED_FIELDS`
  // is what keeps the names honest.
  const spec = SHAPE_SPECS[kind] as unknown as z.ZodObject<z.ZodRawShape>;
  const keys = ANCHORED_FIELDS[kind];
  if (keys === undefined) {
    return spec;
  }
  // `ZodRawShape` is declared in zod's core vocabulary, and its schemas come
  // back out as core types even though the classic classes went in -- so the
  // fields are read into the classic vocabulary here, once, where the two meet.
  const shape = { ...spec.shape } as Record<string, z.ZodTypeAny>;
  for (const key of keys) {
    shape[key] = anchored(shape[key]);
  }
  return spec.extend(shape);
}

const shapeVariants = Object.values(SHAPE_SPECS) as unknown as [
  (typeof SHAPE_SPECS)['arrow'],
  ...(typeof SHAPE_SPECS)[ShapeKind][],
];

const providerShapeVariants = SHAPE_KINDS.map(providerVariantsFor) as unknown as [
  (typeof SHAPE_SPECS)['arrow'],
  ...(typeof SHAPE_SPECS)[ShapeKind][],
];

/**
 * What a storyboard is parsed with, and what the `Shape` type comes from: an
 * anchor may be absent, and absent means none.
 */
export const ShapeSchema = z.discriminatedUnion('kind', shapeVariants);
export type Shape = z.infer<typeof ShapeSchema>;

/**
 * What the provider is asked to produce. Identical but for the anchors, which
 * the strict subset can only express as required-nullable -- it has no way to
 * say "may be absent", so absence is spelled `null` there.
 *
 * A reply is still *parsed* with the loose `ShapeSchema` above, never with
 * this: the model omitting a field whose only sensible value was `null` is not
 * worth discarding a storyboard over, and parsing loosely is what makes the
 * two forms agree. This schema exists to be sent, not to judge.
 */
export const ProviderShapeSchema = z.discriminatedUnion('kind', providerShapeVariants);

/* ────────────────────────────── scenes ──────────────────────────── */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Every word the scene writes on the board: the labels, the captions under the
 * figures, and the words the composite shapes carry -- a card's title, a
 * badge's symbol, a list's heading and items. One budget covers all of them --
 * they are written in the same handwriting as a label and take up the same
 * room, so letting carried text go uncounted would be a way to get words onto
 * the board past the cap.
 */
export function countLabelWords(shapes: Shape[]): number {
  let total = 0;
  for (const shape of shapes) {
    if (shape.kind === 'label') {
      total += countWords(shape.text);
    } else if (shape.kind === 'stickFigure' && shape.label) {
      total += countWords(shape.label);
    } else if (shape.kind === 'card' && shape.title) {
      total += countWords(shape.title);
    } else if (shape.kind === 'badge' && shape.text) {
      total += countWords(shape.text);
    } else if (shape.kind === 'bulletList') {
      total += shape.title ? countWords(shape.title) : 0;
      for (const item of shape.items) {
        total += countWords(item);
      }
    }
  }
  return total;
}

/**
 * The structural half of a scene: types, ranges, enums, and nothing that has to
 * look at the scene as a whole to decide. This is the half the provider's reply
 * is held to -- `ScenesEnvelopeSchema` below is built from it -- and the half
 * `SceneSchema` refines.
 *
 * The split is load-bearing. Refinements never reach the JSON Schema the model
 * is sent, so an envelope carrying them could only ever enforce them *inside*
 * the request: the reply would be rejected during parsing, before
 * `generateScenes` could hand the validator's complaints back for its one repair
 * pass -- leaving that repair dead code for exactly the failures it was written
 * for. Kept apart, a storyboard survives the parse, is judged by `validateScenes`
 * where the repair can see it, and is still refused, with details, if the repair
 * fails too.
 *
 * It is written once and pointed at either vocabulary, so the two forms can
 * only ever differ in their shapes -- the scene's own fields, and the rules
 * about them, cannot drift apart between what is sent and what is parsed.
 */
function sceneOf<T extends z.ZodTypeAny>(shapes: T) {
  return z.object({
    title: z.string().min(1).max(120).describe('a few words naming this scene, for the progress list'),
    durationSeconds: z
      .number()
      .min(MIN_SCENE_SECONDS)
      .max(MAX_SCENE_SECONDS)
      .describe(
        `how long this scene is drawn and held, ${MIN_SCENE_SECONDS}-${MAX_SCENE_SECONDS} seconds`,
      ),
    shapes: z.array(shapes).describe('everything drawn in this scene, in drawing order'),
    narration: z
      .string()
      .min(1)
      .max(NARRATION_MAX_CHARS)
      .describe(
        'the English narration spoken aloud while this scene is on screen, one scene long; never empty',
      ),
  });
}

export const SceneShapeSchema = sceneOf(ShapeSchema);

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
 * Anchored shapes (`box`, `card`, `container`, `underline`, `divider`) cannot
 * leave the left or the top: their x and y *are* their left and top, and both
 * are 0-100 already. A `bulletList` is the same about its left edge, and its
 * bottom is measured from the size it settles on -- the same arithmetic the
 * layout pass places it with. Centred shapes (`circle`, `badge`, `cloud`,
 * `stickFigure`) can poke out on any side, so all four are checked.
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
      case 'card':
      case 'container':
        if (shape.x + shape.w > 100) {
          over(index, 'w', shape.x + shape.w, 100);
        }
        if (shape.y + shape.h > 100) {
          over(index, 'h', shape.y + shape.h, 100);
        }
        break;
      case 'underline':
      case 'divider':
        if (shape.x + shape.w > 100) {
          over(index, 'w', shape.x + shape.w, 100);
        }
        break;
      case 'cloud':
        // `x`,`y` are the centre, so half of each size reaches either way.
        centred(index, 'w', shape.x - shape.w / 2, shape.x + shape.w / 2);
        centred(index, 'h', shape.y - shape.h / 2, shape.y + shape.h / 2);
        break;
      case 'circle':
      case 'badge': {
        const half = across(shape.r);
        centred(index, 'r', shape.x - half, shape.x + half);
        centred(index, 'r', shape.y - shape.r, shape.y + shape.r);
        break;
      }
      case 'bulletList': {
        // The bottom is the list's own arithmetic: the size it settles on,
        // measured by the same `list-metrics` functions the layout pass places
        // it with, so the validator and the renderer cannot disagree about how
        // tall a list is.
        if (shape.x + shape.w > 100) {
          over(index, 'w', shape.x + shape.w, 100);
        }
        const bottom = shape.y + bulletListHeight(shape, bulletItemSize(shape));
        if (bottom > 100) {
          over(index, 'h', bottom, 100);
        }
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
      case 'crossOut':
        // Drawn on its target's own bounds, so it reaches exactly as far as the
        // target does -- and the target is checked where it is. Nothing to
        // check here, and deliberately no attempt to resolve the index: the
        // layout pass owns that, and can leave a crossOut pointing nowhere.
        break;
    }
  });
}

/**
 * The rules a scene can only be judged against as a whole.
 *
 * Anchors are deliberately absent from this list. Whether one resolves depends
 * on the rest of the scene, but the answer is never "refuse": `layOutScenes`
 * clears an anchor it cannot resolve and draws the shape where the model put
 * it, so by the time a scene is validated every surviving anchor is a good one
 * and the only anchors left to complain about are the ones already gone. That
 * is why the shape kinds an anchor may point at live in `layout.ts` rather than
 * here -- one owner, and it is the module that acts on them.
 */
export const SceneSchema = SceneShapeSchema.superRefine((scene, ctx) => {
  const words = countLabelWords(scene.shapes);
  if (words > MAX_LABEL_WORDS) {
    ctx.addIssue({
      code: 'custom',
      path: ['shapes'],
      message: `scene has ${words} label words, over the cap of ${MAX_LABEL_WORDS}`,
    });
  }
  // Narration is spoken at a fixed rate, so the scene's own duration is its
  // word budget. A line over that budget cannot be spoken in the time the
  // scene is on screen, and the voice is never sped up to make it fit.
  const narrationWords = countWords(scene.narration);
  const narrationBudget = maxNarrationWords(scene.durationSeconds);
  if (narrationWords === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['narration'],
      message: 'narration is empty; every scene is spoken aloud',
    });
  } else if (narrationWords > narrationBudget) {
    ctx.addIssue({
      code: 'custom',
      path: ['narration'],
      message: `narration runs to ${narrationWords} words; ${scene.durationSeconds} seconds of scene speaks at most ${narrationBudget} of them at ${NARRATION_WPS} words per second`,
    });
  }
  if (scene.shapes.length < MIN_SHAPES_PER_SCENE || scene.shapes.length > MAX_SHAPES_PER_SCENE) {
    ctx.addIssue({
      code: 'custom',
      path: ['shapes'],
      message: `scene draws ${scene.shapes.length} shapes, outside the range ${MIN_SHAPES_PER_SCENE}-${MAX_SHAPES_PER_SCENE}`,
    });
  }
  // The strict output subset cannot express `maxItems`, so the list cap lives
  // here with the other whole-scene rules, where the repair pass can see it.
  scene.shapes.forEach((shape, index) => {
    if (shape.kind !== 'bulletList') {
      return;
    }
    if (shape.items.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['shapes', index, 'items'],
        message: 'a bulletList with no items draws nothing; give it at least one short phrase',
      });
    } else if (shape.items.length > BULLET_MAX_ITEMS) {
      ctx.addIssue({
        code: 'custom',
        path: ['shapes', index, 'items'],
        message: `this list has ${shape.items.length} items; at most ${BULLET_MAX_ITEMS} fit on one list`,
      });
    }
  });
  checkBoardExtents(scene.shapes, ctx);
});

export type Scene = z.infer<typeof SceneSchema>;

/**
 * A storyboard read structurally, before anything has looked at it as a whole.
 *
 * This is the first of the three steps every read path runs -- parse, then
 * `layOutScenes`, then `validateScenes` -- and the order matters: the layout
 * pass can fix what the refinements would refuse (it clamps an underline that
 * runs off the right edge, for one), so judging the geometry before laying it
 * out would reject a storyboard the renderer would have drawn correctly.
 *
 * It is also the only one of the three that can reject an unreadable file, which
 * is why it is a schema rather than a cast: `readScenes` has to tell "this is not
 * a storyboard" apart from "this storyboard breaks a rule".
 */
export const ScenesShapeSchema = z.array(SceneShapeSchema);

/** A storyboard, as stored in scenes.json and rendered by the worker. */
export const ScenesSchema = z.array(SceneSchema);
export type Scenes = z.infer<typeof ScenesSchema>;

/**
 * The envelope a reply is read with, and the one every document in the repo
 * already writes. The provider requires an object at the JSON Schema root, so
 * scenes travel wrapped; unwrap before validating.
 *
 * Carries `SceneShapeSchema`, not `SceneSchema`: the refinements are the
 * validator's to apply, in a place the repair pass can hear about them. See the
 * note on `SceneShapeSchema`.
 */
export const ScenesEnvelopeSchema = z.object({
  scenes: z.array(SceneShapeSchema).describe('the storyboard, in order; scene 1 is the title scene'),
});

/**
 * The envelope the *provider* is shown, and the only thing that reaches
 * `scenesResponseFormat`. Identical to the one above but for the anchors, which
 * the strict subset has no way to leave out -- so there they are required, and
 * a model that means "no anchor" has to say `null`.
 *
 * That is a demand the prompt makes, not a demand parsing enforces: a reply is
 * read with `ScenesEnvelopeSchema` above, which does not mind a missing anchor.
 * The two together are the point -- the model is asked for the strict shape,
 * and forgiven for the loose one, which is what keeps a storyboard whose only
 * fault is an omitted `null` from being thrown away.
 */
export const ProviderScenesEnvelopeSchema = z.object({
  scenes: z
    .array(sceneOf(ProviderShapeSchema))
    .describe('the storyboard, in order; scene 1 is the title scene'),
});

/* ──────────────────────────── validation ────────────────────────── */

export type ScenesValidation =
  | { ok: true; scenes: Scenes }
  | { ok: false; errors: string[] };

/**
 * One `path: message` line per problem -- the form every reporter uses, the
 * validator and the layout pass alike, so a caller can concatenate the two and
 * hand the result to the repair prompt as one list.
 */
export function issueDetails(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates a storyboard, reporting every problem with its full path so the UI
 * can say exactly which field is wrong.
 */
export function validateScenes(input: unknown): ScenesValidation {
  const parsed = ScenesSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, scenes: parsed.data };
  }
  return { ok: false, errors: issueDetails(parsed.error) };
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
