/**
 * The Scene DSL: the one contract every stage of the pipeline reads.
 *
 * `textToScript` -> `scriptToScenes` -> `scenesToVideo` all agree on this shape,
 * the model is asked for exactly this shape, and the render worker refuses to
 * draw a `scenes.json` that does not validate against it.
 *
 * A scene is one of seven kinds -- title, points, flow, topology, sequence,
 * code, concept -- and each kind is drawn by its own choreographed component
 * (see `SCENE_NOTES`). The kind and its fields are a discriminated union: the
 * model picks a kind and fills in that kind's fields.
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
 *     Bounds on numbers are fine. Caps that are about how many items a list
 *     holds -- and the written-word budgets -- cannot be expressed in the
 *     subset, so they live in the refinements below and the prompt quotes them
 *     from these same constants.
 *
 *  2. The model-facing prompt derives its vocabulary from the constants here --
 *     `SCENES_SYSTEM_PROMPT` in llm.ts is built by mapping over `SCENE_KINDS`
 *     and `SCENE_NOTES` and reading the caps above -- so the prompt and the
 *     validator cannot drift apart.
 *
 * What the model is *held to* is the structural half only: the refinements at
 * the bottom are applied on this side, where a storyboard that breaks one can
 * still be sent back for repair. `SceneShapeSchema` carries that reasoning.
 */

import { z } from 'zod';

/* ────────────────────────────── caps ────────────────────────────── */

export const MIN_SCENE_SECONDS = 7;
export const MAX_SCENE_SECONDS = 20;

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

/** Where a ~5 minute video should land, and the window the renderer accepts. */
export const TARGET_TOTAL_SECONDS = 300;
export const MIN_TOTAL_SECONDS = 270;
export const MAX_TOTAL_SECONDS = 330;

/* ─────────────────────── the scene vocabulary ───────────────────── */

/**
 * The accent tints a scene may ask for. Null is the block's own default, and
 * the prompt tells the model to spend an accent on the one thing that matters
 * in a scene rather than to colour things decoratively.
 */
export const ACCENTS = ['blue', 'cyan', 'violet', 'green', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

/** Dark is the default page; light is a change of register. */
export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** The languages the code scene may name on its badge. */
export const CODE_LANGUAGES = [
  'ts',
  'tsx',
  'js',
  'python',
  'go',
  'rust',
  'java',
  'sql',
  'bash',
  'json',
  'yaml',
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/**
 * The per-kind caps -- how many items a list may hold, how long a listing may
 * run. All of them are rules the strict output subset cannot express as array
 * or string bounds, so each is enforced by a refinement below and quoted by the
 * prompt from the same constant.
 */
export const MIN_POINTS_ITEMS = 2;
export const MAX_POINTS_ITEMS = 5;
export const MIN_FLOW_STAGES = 2;
export const MAX_FLOW_STAGES = 5;
export const MIN_FLOW_PACKETS = 1;
export const MAX_FLOW_PACKETS = 12;
export const MIN_TOPOLOGY_NODES = 3;
export const MAX_TOPOLOGY_NODES = 10;
export const MIN_SEQUENCE_STEPS = 2;
export const MAX_SEQUENCE_STEPS = 5;
export const CODE_MAX_LINES = 24;
export const CODE_MAX_LINE_CHARS = 100;
export const MIN_CONCEPT_TERMS = 1;
export const MAX_CONCEPT_TERMS = 4;
export const MAX_CONCEPT_KEY_POINTS = 4;

/* ─────────────────────────── primitives ─────────────────────────── */

/**
 * A run of text a scene may carry: a subtitle, an item's detail line, a
 * node's role. Optional in the stored form and required-but-nullable in the
 * provider form, the same treatment every optional scalar gets -- see
 * `anchored()`.
 *
 * The description goes on the inner schema, before the wrappers. `anchored()`
 * strips the wrappers to rebuild the provider form, and a description sitting
 * on a wrapper would be stripped with them -- which is exactly how a field
 * reaches the model bare, with no hint of what belongs in it.
 */
function optionalText(max: number, description: string) {
  return z.string().min(1).max(max).describe(description).nullable().optional();
}

/**
 * The provider-facing form of a field the model may leave out: the same field
 * with its `.optional()` stripped, so it is required-but-nullable.
 *
 * The strict structured-output subset has no way to say "may be absent" --
 * every property must appear in `required` -- so absence is spelled `null`,
 * and this is the one place that knows it. Stripping beats writing the field a
 * second time with the same bounds and description, which is a pair that can
 * drift.
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

/**
 * `anchored()` down through a schema: every optional field, at any depth,
 * becomes required-but-nullable.
 *
 * The strict subset requires every property of every object to appear in
 * `required`, nested objects inside arrays included -- an item's `detail` is as
 * visible to the grammar as a scene's `title`. So the walk follows arrays into
 * their elements and objects into their fields, and only the fields that are
 * actually optional are rebuilt; everything else is passed through untouched.
 */
function anchoredDeep(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
    return anchored(field);
  }
  if (field instanceof z.ZodArray) {
    const rebuilt = z.array(anchoredDeep(field.element as z.ZodTypeAny));
    // An array's own description is model-facing guidance about what the list
    // means -- "the points, first to last", "exactly one root" -- and rebuilding
    // the array would drop it. Carried over by hand, because the rebuilt array
    // is a new schema and there is nothing left on it to remember the old one.
    return field.description === undefined ? rebuilt : rebuilt.describe(field.description);
  }
  if (field instanceof z.ZodObject) {
    const spec = field as z.ZodObject<z.ZodRawShape>;
    // `ZodRawShape` is declared in zod's core vocabulary, and its schemas come
    // back out as core types even though the classic classes went in -- so the
    // fields are read into the classic vocabulary here, once, where the two
    // meet.
    const shape = { ...spec.shape } as Record<string, z.ZodTypeAny>;
    for (const key of Object.keys(shape)) {
      shape[key] = anchoredDeep(shape[key]);
    }
    return spec.extend(shape);
  }
  return field;
}

/* ──────────────────────── the scene vocabulary ──────────────────── */

/**
 * What every scene carries, whatever its kind. Spread into each kind's spec
 * below rather than composed on top, so the fields are declared exactly once
 * and every variant keeps its literal `kind` type -- which is what the
 * discriminated union needs to tell the kinds apart.
 */
const COMMON_SCENE_FIELDS = {
  title: z.string().min(1).max(120).describe('a few words naming this scene, for the progress list'),
  durationSeconds: z
    .number()
    .min(MIN_SCENE_SECONDS)
    .max(MAX_SCENE_SECONDS)
    .describe(
      `how long this scene is on screen, ${MIN_SCENE_SECONDS}-${MAX_SCENE_SECONDS} seconds`,
    ),
  theme: z
    .enum(THEMES)
    .describe('"dark" or "light" for the page behind the scene')
    .nullable()
    .optional(),
  accent: z
    .enum(ACCENTS)
    .describe(
      `the accent tint for the one thing that matters most in this scene, or null for the block default; one of ${ACCENTS.join(', ')}`,
    )
    .nullable()
    .optional(),
  narration: z
    .string()
    .min(1)
    .max(NARRATION_MAX_CHARS)
    .describe(
      'the English narration spoken aloud while this scene is on screen, one scene long; never empty',
    ),
};

/**
 * The scene vocabulary, keyed by kind. This object is the source of the kind
 * list, so adding a kind automatically reaches the model through `SCENE_KINDS`;
 * the exhaustive `SCENE_NOTES`/`SCENE_CAPS` records below then force you to
 * describe it rather than leaving the model silently unaware.
 *
 * What each kind carries is what its component draws: the block's own props,
 * named as the model should name them. A list holds objects with a label and a
 * detail line; a chart holds nodes that name their parent by index; a listing
 * is a string, a language and the lines to highlight.
 */
const SCENE_KIND_SPECS = {
  title: z.object({
    kind: z.literal('title'),
    ...COMMON_SCENE_FIELDS,
    subtitle: optionalText(160, 'a second line under the headline, or null for none'),
    eyebrow: optionalText(60, 'a small label above the headline, or null for none'),
    meta: optionalText(
      80,
      'a small line under the subtitle -- the date, the source, the run time -- or null for none',
    ),
  }),
  points: z.object({
    kind: z.literal('points'),
    ...COMMON_SCENE_FIELDS,
    eyebrow: optionalText(60, 'a small label above the list, or null for none'),
    items: z
      .array(
        z.object({
          label: z.string().min(1).max(80).describe('one point, a few words'),
          detail: optionalText(120, 'a second line under the point, or null for none'),
        }),
      )
      .describe(`the points, first to last, ${MIN_POINTS_ITEMS}-${MAX_POINTS_ITEMS} of them`),
  }),
  flow: z.object({
    kind: z.literal('flow'),
    ...COMMON_SCENE_FIELDS,
    stages: z
      .array(
        z.object({
          label: z.string().min(1).max(60).describe('the stage name, one or two words'),
          detail: optionalText(
            100,
            'a second line under the stage -- the queue, the worker, the region -- or null for none',
          ),
        }),
      )
      .describe(
        `the stages the payload passes through, in order, ${MIN_FLOW_STAGES}-${MAX_FLOW_STAGES} of them`,
      ),
    unit: optionalText(40, 'what flows through the pipeline, e.g. "requests", or null for none'),
    packets: z
      .number()
      .int()
      .min(MIN_FLOW_PACKETS)
      .max(MAX_FLOW_PACKETS)
      .describe(
        `how many payloads are pushed through, ${MIN_FLOW_PACKETS}-${MAX_FLOW_PACKETS}`,
      )
      .nullable()
      .optional(),
  }),
  topology: z.object({
    kind: z.literal('topology'),
    ...COMMON_SCENE_FIELDS,
    nodes: z
      .array(
        z.object({
          name: z.string().min(1).max(60).describe('the name inside the node'),
          role: optionalText(60, 'a line under the name, or null for none'),
          parent: z
            .number()
            .int()
            .min(0)
            .max(MAX_TOPOLOGY_NODES - 1)
            .describe(
              'the 0-based index of the node this one hangs under, which must be listed before it; null on the one root',
            )
            .nullable()
            .optional(),
        }),
      )
      .describe(
        `the nodes, ${MIN_TOPOLOGY_NODES}-${MAX_TOPOLOGY_NODES} of them: exactly one root, and every parent listed before its children`,
      ),
  }),
  sequence: z.object({
    kind: z.literal('sequence'),
    ...COMMON_SCENE_FIELDS,
    eyebrow: optionalText(60, 'a small label above the rail, or null for none'),
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(80).describe('the step, a few words'),
          description: optionalText(160, 'a line under the step, or null for none'),
        }),
      )
      .describe(`the steps in order, ${MIN_SEQUENCE_STEPS}-${MAX_SEQUENCE_STEPS} of them`),
  }),
  code: z.object({
    kind: z.literal('code'),
    ...COMMON_SCENE_FIELDS,
    code: z
      .string()
      .min(1)
      .max(CODE_MAX_LINES * (CODE_MAX_LINE_CHARS + 1))
      .describe(
        `the listing itself, up to ${CODE_MAX_LINES} lines of at most ${CODE_MAX_LINE_CHARS} characters`,
      ),
    language: z
      .enum(CODE_LANGUAGES)
      .describe('the language badge on the editor, or null for none')
      .nullable()
      .optional(),
    startLine: z
      .number()
      .int()
      .min(1)
      .max(9999)
      .describe('the first line number shown in the gutter, for an excerpt; null starts at 1')
      .nullable()
      .optional(),
    highlightedLines: z
      .array(z.number().int().min(1).max(9999))
      .describe(
        'the 1-based line numbers to focus once the listing is written; empty for none',
      ),
    filename: optionalText(80, 'the filename on the editor tab, or null for none'),
  }),
  concept: z.object({
    kind: z.literal('concept'),
    ...COMMON_SCENE_FIELDS,
    eyebrow: optionalText(60, 'a small label above the explanation, or null for none'),
    explanation: z
      .string()
      .min(1)
      .max(800)
      .describe('the explanation, one short paragraph of plain prose'),
    terms: z
      .array(
        z.object({
          term: z.string().min(1).max(60).describe('a term worth defining'),
          note: optionalText(120, 'a short gloss of the term, or null for none'),
        }),
      )
      .describe(`the terms worth defining, ${MIN_CONCEPT_TERMS}-${MAX_CONCEPT_TERMS} of them`),
    keyPoints: z
      .array(z.string().min(1).max(120))
      .describe(`the points to leave the viewer with, up to ${MAX_CONCEPT_KEY_POINTS}; empty for none`),
    takeaway: optionalText(160, 'the one line to remember, or null for none'),
  }),
} as const;

export type SceneKind = keyof typeof SCENE_KIND_SPECS;

/** Derived from the schema, never hand-listed. */
export const SCENE_KINDS = Object.keys(SCENE_KIND_SPECS) as SceneKind[];

/**
 * The caps each kind is held to, as a short clause -- empty for a kind whose
 * fields carry no counts. Derived, and exhaustive by construction: a new kind
 * will not compile until it says what its caps are. The prompt quotes these;
 * `SceneSchema` enforces them.
 */
export const SCENE_CAPS: Record<SceneKind, string> = {
  title: '',
  points: `${MIN_POINTS_ITEMS}-${MAX_POINTS_ITEMS} items`,
  flow: `${MIN_FLOW_STAGES}-${MAX_FLOW_STAGES} stages and ${MIN_FLOW_PACKETS}-${MAX_FLOW_PACKETS} packets`,
  topology: `${MIN_TOPOLOGY_NODES}-${MAX_TOPOLOGY_NODES} nodes with exactly one root, every parent listed before its children`,
  sequence: `${MIN_SEQUENCE_STEPS}-${MAX_SEQUENCE_STEPS} steps`,
  code: `at most ${CODE_MAX_LINES} lines of at most ${CODE_MAX_LINE_CHARS} characters`,
  concept: `${MIN_CONCEPT_TERMS}-${MAX_CONCEPT_TERMS} terms and up to ${MAX_CONCEPT_KEY_POINTS} key points`,
};

/** How each kind is drawn and used, fed to the model. Exhaustive by construction. */
export const SCENE_NOTES: Record<SceneKind, string> = {
  title:
    'the opening title card: the scene title is the headline, with an optional subtitle, a small eyebrow above it and a meta line below',
  points: `a ticked-off list of ${SCENE_CAPS.points}, each a short label with an optional detail line`,
  flow: `a left-to-right pipeline of ${SCENE_CAPS.flow}, naming the unit the payload is counted in`,
  topology: `a hierarchy of ${SCENE_CAPS.topology} -- for org charts, taxonomies and family trees`,
  sequence: `an ordered process of ${SCENE_CAPS.sequence} walked step by step along a rail, each a title with an optional description`,
  code: `a code editor revealing a listing of ${SCENE_CAPS.code}, with the lines that matter highlighted once it is written`,
  concept: `an explanation: a paragraph of plain prose with ${SCENE_CAPS.concept}, plus an optional one-line takeaway`,
};

/**
 * The words each kind may write on screen, counted by `countWrittenWords`. One
 * budget per kind rather than a flat number: a title card holds a headline and
 * no more, while a chart of ten labelled nodes legitimately writes more. The
 * listing in a code scene is deliberately outside the count -- its budget is
 * lines and characters -- so only the filename and language badge are words.
 */
const MAX_WRITTEN_WORDS: Record<SceneKind, number> = {
  title: 30,
  points: 65,
  flow: 45,
  topology: 70,
  sequence: 65,
  code: 40,
  concept: 55,
};

/** The written-word budget for one kind. See `MAX_WRITTEN_WORDS`. */
export function maxWrittenWords(kind: SceneKind): number {
  return MAX_WRITTEN_WORDS[kind];
}

/* ──────────────────────── the two schema forms ──────────────────── */

/**
 * The same vocabulary with every optional field -- at any depth -- made
 * required-but-nullable, built from `SCENE_KIND_SPECS` rather than written out
 * again: re-declaring the fields would be a second copy of their bounds and
 * descriptions, and two copies of `2-5` do not stay equal.
 */
const providerVariants = SCENE_KINDS.map((kind) =>
  anchoredDeep(SCENE_KIND_SPECS[kind]),
) as unknown as [
  (typeof SCENE_KIND_SPECS)['title'],
  ...(typeof SCENE_KIND_SPECS)[SceneKind][],
];

const sceneVariants = SCENE_KINDS.map((kind) => SCENE_KIND_SPECS[kind]) as unknown as [
  (typeof SCENE_KIND_SPECS)['title'],
  ...(typeof SCENE_KIND_SPECS)[SceneKind][],
];

/**
 * What a storyboard is parsed with, and what the `Scene` type comes from: an
 * optional field may be absent, and absent means none.
 */
export const SceneShapeSchema = z.discriminatedUnion('kind', sceneVariants);

/**
 * What the provider is asked to produce. Identical but for the optional fields,
 * which the strict subset can only express as required-nullable -- it has no way
 * to say "may be absent", so absence is spelled `null` there.
 *
 * A reply is still *parsed* with the loose `SceneShapeSchema` above, never with
 * this: the model omitting a field whose only sensible value was `null` is not
 * worth discarding a storyboard over, and parsing loosely is what makes the
 * two forms agree. This schema exists to be sent, not to judge.
 */
export const ProviderSceneShapeSchema = z.discriminatedUnion('kind', providerVariants);

/* ─────────────────────── what a scene writes ────────────────────── */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The words in a run of optional text; absent or empty counts zero. */
function optionalWords(text: string | null | undefined): number {
  return text ? countWords(text) : 0;
}

/**
 * Every word the scene writes on screen: its title, and the text its kind
 * carries -- a list's labels and details, a chart's names and roles, an
 * explanation's prose, terms and points, a code scene's filename and language.
 *
 * One budget covers all of them because they are all written in the same face
 * at the same scale, so leaving any of them uncounted would be a way to get
 * words onto the screen past the cap. The code listing itself is the one
 * exception: it is the scene's subject rather than its writing, and it is
 * bounded by lines and characters instead.
 */
export function countWrittenWords(scene: Scene): number {
  const title = countWords(scene.title);
  switch (scene.kind) {
    case 'title':
      return (
        title + optionalWords(scene.subtitle) + optionalWords(scene.eyebrow) + optionalWords(scene.meta)
      );
    case 'points':
      return (
        title +
        optionalWords(scene.eyebrow) +
        scene.items.reduce((sum, item) => sum + countWords(item.label) + optionalWords(item.detail), 0)
      );
    case 'flow':
      return (
        title +
        optionalWords(scene.unit) +
        scene.stages.reduce(
          (sum, stage) => sum + countWords(stage.label) + optionalWords(stage.detail),
          0,
        )
      );
    case 'topology':
      return (
        title +
        scene.nodes.reduce((sum, node) => sum + countWords(node.name) + optionalWords(node.role), 0)
      );
    case 'sequence':
      return (
        title +
        optionalWords(scene.eyebrow) +
        scene.steps.reduce(
          (sum, step) => sum + countWords(step.title) + optionalWords(step.description),
          0,
        )
      );
    case 'code':
      return title + optionalWords(scene.filename) + optionalWords(scene.language);
    case 'concept':
      return (
        title +
        optionalWords(scene.eyebrow) +
        countWords(scene.explanation) +
        scene.terms.reduce((sum, term) => sum + countWords(term.term) + optionalWords(term.note), 0) +
        scene.keyPoints.reduce((sum, point) => sum + countWords(point), 0) +
        optionalWords(scene.takeaway)
      );
  }
}

/* ──────────────────────────── validation ────────────────────────── */

/**
 * The rules a scene can only be judged against as a whole.
 *
 * The structural schema above catches field shapes and number bounds; what is
 * left is the half the strict output subset cannot express -- how many items a
 * list holds, how long a listing runs, where a chart's parent indices point --
 * plus the two budgets that are about the scene as a whole, its written words
 * and its narration.
 */
export const SceneSchema = SceneShapeSchema.superRefine((scene, ctx) => {
  // The written-word budget. Anchored at the title because the complaint is
  // about the scene's words as a whole and the repair pass maps `N.field`
  // paths back to 1-based scene numbers; a bare scene-level path would lose
  // the number entirely. The title is one of the counted runs, so naming it
  // is not misleading.
  const written = countWrittenWords(scene);
  const writtenCap = maxWrittenWords(scene.kind);
  if (written > writtenCap) {
    ctx.addIssue({
      code: 'custom',
      path: ['title'],
      message: `this scene writes ${written} words on screen, over the ${scene.kind} cap of ${writtenCap}`,
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

  // The per-kind caps. Arrays are declared without `.min()/.max()` -- the
  // strict subset rejects minItems/maxItems -- so the counts are checked here,
  // where the repair pass can see them.
  switch (scene.kind) {
    case 'title':
      break;
    case 'points':
      if (scene.items.length < MIN_POINTS_ITEMS || scene.items.length > MAX_POINTS_ITEMS) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: `this scene lists ${scene.items.length} points; between ${MIN_POINTS_ITEMS} and ${MAX_POINTS_ITEMS} fit the list`,
        });
      }
      break;
    case 'flow':
      if (scene.stages.length < MIN_FLOW_STAGES || scene.stages.length > MAX_FLOW_STAGES) {
        ctx.addIssue({
          code: 'custom',
          path: ['stages'],
          message: `this scene has ${scene.stages.length} stages; between ${MIN_FLOW_STAGES} and ${MAX_FLOW_STAGES} fit the pipeline`,
        });
      }
      break;
    case 'topology': {
      if (scene.nodes.length < MIN_TOPOLOGY_NODES || scene.nodes.length > MAX_TOPOLOGY_NODES) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes'],
          message: `this scene has ${scene.nodes.length} nodes; between ${MIN_TOPOLOGY_NODES} and ${MAX_TOPOLOGY_NODES} fit the chart`,
        });
      }
      // The one relational rule left in the DSL: a node's parent is an index
      // into its own array, and the drawing builds levels in array order -- so
      // the parent must come first, or the node would hang off something that
      // does not exist yet. That also makes cycles impossible. `parent` is a
      // required field with a structural range, so an out-of-range index is
      // caught above; what is left to check is the ordering.
      let roots = 0;
      scene.nodes.forEach((node, index) => {
        const parent = node.parent ?? null;
        if (parent === null) {
          roots += 1;
          return;
        }
        if (parent >= index) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', index, 'parent'],
            message: `this node names node ${parent} as its parent, which is not listed before it; name an earlier node, or null if this node is the root`,
          });
        }
      });
      if (roots !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes'],
          message: `this chart has ${roots} root nodes; exactly one node may have no parent`,
        });
      }
      break;
    }
    case 'sequence':
      if (scene.steps.length < MIN_SEQUENCE_STEPS || scene.steps.length > MAX_SEQUENCE_STEPS) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps'],
          message: `this scene has ${scene.steps.length} steps; between ${MIN_SEQUENCE_STEPS} and ${MAX_SEQUENCE_STEPS} fit the rail`,
        });
      }
      break;
    case 'code': {
      // Surrounding blank lines are trimmed, exactly as the editor trims them,
      // so a stray newline neither counts toward the cap nor hides a violation.
      const lines = scene.code.split('\n');
      while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
      }
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      if (lines.length > CODE_MAX_LINES) {
        ctx.addIssue({
          code: 'custom',
          path: ['code'],
          message: `this listing runs to ${lines.length} lines; at most ${CODE_MAX_LINES} fit the editor`,
        });
      }
      // The gutter number the reader would see, so the message names the line
      // the model wrote rather than its offset from the excerpt.
      const firstLine = scene.startLine ?? 1;
      lines.forEach((line, index) => {
        if (line.length > CODE_MAX_LINE_CHARS) {
          ctx.addIssue({
            code: 'custom',
            path: ['code'],
            message: `line ${firstLine + index} is ${line.length} characters; at most ${CODE_MAX_LINE_CHARS} fit across the editor`,
          });
        }
      });
      break;
    }
    case 'concept':
      if (scene.terms.length < MIN_CONCEPT_TERMS || scene.terms.length > MAX_CONCEPT_TERMS) {
        ctx.addIssue({
          code: 'custom',
          path: ['terms'],
          message: `this scene defines ${scene.terms.length} terms; between ${MIN_CONCEPT_TERMS} and ${MAX_CONCEPT_TERMS} fit`,
        });
      }
      if (scene.keyPoints.length > MAX_CONCEPT_KEY_POINTS) {
        ctx.addIssue({
          code: 'custom',
          path: ['keyPoints'],
          message: `this scene has ${scene.keyPoints.length} key points; at most ${MAX_CONCEPT_KEY_POINTS} fit`,
        });
      }
      break;
  }
});

export type Scene = z.infer<typeof SceneSchema>;

/**
 * A storyboard read structurally, before anything has looked at it as a whole.
 *
 * This is the first of the two steps every read path runs -- structure, then
 * `validateScenes` -- and it is the only one that can reject an unreadable
 * file, which is why it is a schema rather than a cast: `readScenes` has to
 * tell "this is not a storyboard" apart from "this storyboard breaks a rule".
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
 * `scenesResponseFormat`. Identical to the one above but for the optional
 * fields, which the strict subset has no way to leave out -- so there they are
 * required, and a model that means "no value" has to say `null`.
 *
 * That is a demand the prompt makes, not a demand parsing enforces: a reply is
 * read with `ScenesEnvelopeSchema` above, which does not mind a missing field.
 * The two together are the point -- the model is asked for the strict shape,
 * and forgiven for the loose one, which is what keeps a storyboard whose only
 * fault is an omitted `null` from being thrown away.
 */
export const ProviderScenesEnvelopeSchema = z.object({
  scenes: z
    .array(ProviderSceneShapeSchema)
    .describe('the storyboard, in order; scene 1 is the title scene'),
});

export type ScenesValidation =
  | { ok: true; scenes: Scenes }
  | { ok: false; errors: string[] };

/**
 * One `path: message` line per problem -- the form every reporter uses, so a
 * caller can hand the result to the repair prompt as one list.
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
