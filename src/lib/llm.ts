/**
 * The LLM boundary.
 *
 * This is the only seam the tests fake: everything behind it (validation,
 * rendering, files) is the real thing in test as in production. That keeps the
 * suite honest and fast.
 *
 * The model is asked for the DSL in the schema's own vocabulary. The shape list,
 * the per-scene caps and the label size bounds below are all read out of
 * `schema.ts` rather than restated, so a prompt can never promise the model
 * something the validator will reject.
 */

import OpenAI, { APIError } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { FAKE_SCRIPT, fakeScenes } from './fixtures.ts';
import { MAX_INPUT_CHARS, MAX_TITLE_CHARS } from './render-config.ts';
import type { Script } from './types.ts';
import {
  MAX_LABEL_SIZE,
  MAX_LABEL_WORDS,
  MAX_SCENE_SECONDS,
  MAX_SHAPES_PER_SCENE,
  MAX_TOTAL_SECONDS,
  MIN_LABEL_SIZE,
  MIN_SCENE_SECONDS,
  MIN_SHAPES_PER_SCENE,
  MIN_TOTAL_SECONDS,
  SHAPE_KINDS,
  SHAPE_NOTES,
  ScenesEnvelopeSchema,
  TARGET_TOTAL_SECONDS,
  validateScenes,
  type Scene,
  type Scenes,
} from './schema.ts';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-5.6-terra';

/** A generate call gets two minutes, then it gives up. */
export const REQUEST_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 1;

export type { Script };

export interface Llm {
  generateScript(input: string): Promise<Script>;
  /**
   * Returns a storyboard that already satisfies the Scene DSL. The real client
   * gets `MAX_STORYBOARD_ATTEMPTS` tries at that: a rejected storyboard is sent
   * back to the model with the validator's complaints before it gives up.
   */
  generateScenes(script: Script): Promise<Scenes>;
}

export type LlmErrorKind = 'missing-key' | 'invalid-output' | 'request-failed';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** Per-field validation problems, when the failure was a bad storyboard. */
  readonly details: string[];

  constructor(kind: LlmErrorKind, message: string, details: string[] = []) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.details = details;
  }
}

/* ──────────────────────────── prompts ───────────────────────────── */

/** Words a ~5 minute spoken script would run to; only a steer for the model. */
const TARGET_SCRIPT_WORDS = Math.round((TARGET_TOTAL_SECONDS / 60) * 140);

/** Derived, so the prompt cannot quote a range the validator disagrees with. */
const MIN_SCENES = Math.ceil(TARGET_TOTAL_SECONDS / MAX_SCENE_SECONDS);
const MAX_SCENES = Math.floor(TARGET_TOTAL_SECONDS / MIN_SCENE_SECONDS);

export const SCRIPT_SYSTEM_PROMPT = [
  'You write scripts for short hand-drawn whiteboard explainer videos.',
  `Write for about ${TARGET_TOTAL_SECONDS} seconds (${Math.floor(
    TARGET_TOTAL_SECONDS / 60,
  )} minutes) of spoken explanation, roughly ${TARGET_SCRIPT_WORDS} words.`,
  'Structure the script as a short title plus markdown-ish body text with one heading per beat.',
  'Every beat must be something that can be drawn: objects, arrows, labels, stick figures.',
  'Plain language, no jargon dumps, no bullet-point walls.',
].join(' ');

export const SCENES_SYSTEM_PROMPT = [
  'You turn an explainer script into a storyboard of hand-drawn whiteboard scenes.',
  '',
  'Each scene is drawn on one 16:9 board. All positions and sizes are percentages:',
  '- x runs across the board, 0 = left edge, 100 = right edge',
  '- y runs down the board, 0 = top edge, 100 = bottom edge',
  '- widths are a percent of board width; heights, radii, stick-figure heights and',
  '  label sizes are a percent of board height, so circles drawn with r stay round',
  '',
  `Draw between ${MIN_SHAPES_PER_SCENE} and ${MAX_SHAPES_PER_SCENE} shapes per scene. Shapes are drawn in array order, so list background boxes before the labels and arrows that go on them.`,
  '',
  'The available shapes:',
  ...SHAPE_KINDS.map((kind) => `- ${kind}: ${SHAPE_NOTES[kind]}`),
  '',
  'Rules:',
  `- every scene lasts ${MIN_SCENE_SECONDS} to ${MAX_SCENE_SECONDS} seconds`,
  `- keep all label text in a scene to ${MAX_LABEL_WORDS} words or fewer, in total`,
  `- label sizes run from ${MIN_LABEL_SIZE} to ${MAX_LABEL_SIZE}`,
  `- aim for about ${TARGET_TOTAL_SECONDS} seconds in total; it must land between ${MIN_TOTAL_SECONDS} and ${MAX_TOTAL_SECONDS} seconds, which is roughly ${MIN_SCENES} to ${MAX_SCENES} scenes`,
  '- scene 1 is the title scene: it states the topic like a hand-lettered title card',
  '- use color "accent" for the one thing that matters most in a scene and "emphasis" sparingly; null means ordinary dark ink',
  '- spread shapes across the board; do not stack everything in one corner',
  '',
  'Return the storyboard as {"scenes": [...]}.',
].join('\n');

/**
 * How many storyboards one Generate may ask for: the first, plus one repair.
 *
 * A storyboard is a long conjunction of caps that only the prompt enforces --
 * every scene must satisfy all of them, and one miss rejects the lot, so a
 * single roll lands for a ~30-scene script well under half the time. Handing
 * the model the validator's own complaints about specific scenes repairs far
 * more than a blind reroll does, which is why one targeted retry is enough
 * where several rerolls would not be.
 */
const MAX_STORYBOARD_ATTEMPTS = 2;

/**
 * The caps, restated at the very end of whichever prompt is built -- after the
 * fallback's schema blob, which would otherwise be the last thing the model
 * reads. They are prose-only: the strict JSON Schema subset cannot carry
 * `minItems`/`maxItems`, so nothing in the grammar stops a scene drawing 13
 * shapes. Interpolated from the same constants the validator uses, so the
 * reminder cannot drift from the rule.
 */
function storyboardCapsReminder(): string {
  return (
    '\n\nReminder: count the shapes in every scene -- each one must draw between ' +
    `${MIN_SHAPES_PER_SCENE} and ${MAX_SHAPES_PER_SCENE} of them -- and keep each scene's ` +
    `label text within ${MAX_LABEL_WORDS} words.`
  );
}

/**
 * The validator's complaints, rewritten as a repair request. Envelope paths
 * (`scenes.2.shapes`) become 1-based scene numbers, because the prompt calls
 * the title scene "scene 1" and the model must fix the scene the validator
 * means, not the one two doors down.
 */
function repairInstruction(errors: string[]): string {
  const problems = errors
    .map(
      (error) =>
        '- ' +
        error.replace(/^scenes\.(\d+)\./, (_, index: string) => `scene ${Number(index) + 1}, `),
    )
    .join('\n');
  return (
    '\n\nYour previous storyboard was rejected. Fix exactly these problems and return the ' +
    `complete, corrected storyboard:\n${problems}`
  );
}

/* ─────────────────────── provider-strict schemas ────────────────── */

const ScriptEnvelopeSchema = z.object({
  script: z.object({
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe('the video title'),
    text: z
      .string()
      .min(1)
      .max(MAX_INPUT_CHARS)
      .describe('markdown-ish body text with one heading per beat'),
  }),
});

let scriptFormat: ReturnType<typeof zodResponseFormat<typeof ScriptEnvelopeSchema>> | null = null;
let scenesFormat: ReturnType<typeof zodResponseFormat<typeof ScenesEnvelopeSchema>> | null = null;

/**
 * The JSON Schema actually sent to the provider. Built by the SDK's own
 * zod-to-strict-JSON-Schema converter rather than by hand: the provider accepts
 * only a subset of JSON Schema (object root, `anyOf` but never `oneOf`, no
 * `default`/`minItems`/`maxItems`) and the converter applies those rules by
 * construction. It throws at build time if the schema leaves the subset, which
 * is why these are memoised and why a test asserts the result.
 */
export function scriptResponseFormat() {
  scriptFormat ??= zodResponseFormat(ScriptEnvelopeSchema, 'script');
  return scriptFormat;
}

export function scenesResponseFormat() {
  scenesFormat ??= zodResponseFormat(ScenesEnvelopeSchema, 'scenes');
  return scenesFormat;
}

/* ─────────────────────── plain-JSON fallback ────────────────────── */

/**
 * Not every endpoint accepts strict structured outputs. DeepSeek answers
 * `response_format: json_schema` with HTTP 400 "This response_format type is
 * unavailable now"; it supports `json_object` only, which promises valid JSON
 * and nothing about its shape. So the schema is embedded in the prompt instead
 * and the reply is re-validated here, against the same zod envelope the strict
 * path would have enforced.
 *
 * The fallback fires on exactly one signal -- a 400 that names response_format.
 * A ZodError from a schema-supporting endpoint, a timeout, or any other
 * rejection is reported as it always was: better a loud error than a silent
 * downgrade for an endpoint that was never the problem.
 */

/** A builder's return type for envelope `E`, so call sites need no casts. */
type EnvelopeFormat<E> = ReturnType<typeof zodResponseFormat<z.ZodType<E>>>;

const JSON_OBJECT_FORMAT = { type: 'json_object' } as const;

/**
 * Set on fallback calls so the provider's own, lower default cannot truncate a
 * full storyboard mid-JSON: well over anything the ~40-scene DSL needs, well
 * under the model's documented ceiling.
 */
const FALLBACK_MAX_TOKENS = 32_768;

function isUnsupportedStructuredFormat(error: unknown): error is APIError {
  return error instanceof APIError && error.status === 400 && /response_format/i.test(error.message);
}

/**
 * The contract, restated for the prompt. Derived from the same JSON Schema the
 * strict path sends, so the two modes cannot promise the model different
 * shapes. The literal word "JSON" is required by some providers' json_object
 * mode.
 */
function schemaInstruction(format: EnvelopeFormat<unknown>): string {
  return (
    '\n\nRespond with JSON only, matching this JSON Schema exactly:\n' +
    JSON.stringify(format.json_schema.schema, null, 2)
  );
}

/** One optional markdown fence around the payload; anything else must be JSON already. */
function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/** The same `path: message` shape `validateScenes` reports. */
function zodIssueDetails(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/* ─────────────────────────── real client ────────────────────────── */

export function resolveModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function resolveBaseUrl(): string {
  return process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new LlmError(
      'missing-key',
      'No API key found. Copy .env.local.example to .env.local, set OPENAI_API_KEY, then restart the dev server.',
    );
  }
  return key;
}

function describeApiError(error: unknown): string {
  if (error instanceof APIError) {
    return `The model endpoint replied ${error.status ?? 'with an error'}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `The model request failed: ${error.message}`;
  }
  return 'The model request failed.';
}

export class OpenAiLlm implements Llm {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: requireApiKey(),
        baseURL: resolveBaseUrl(),
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: MAX_RETRIES,
      });
    }
    return this.client;
  }

  /**
   * Strict structured outputs first; a provider that rejects schema mode gets
   * the same call retried in plain JSON mode. `label` names the artefact in
   * errors the user reads ("the model returned no storyboard").
   */
  private async requestEnvelope<E>(
    system: string,
    user: string,
    label: 'script' | 'storyboard',
    format: EnvelopeFormat<E>,
    envelope: z.ZodType<E>,
    /** Appended after the fallback's schema blob, where the model reads last. */
    trailing = '',
  ): Promise<E> {
    // Outside the try, so a missing key is still reported before any request.
    const client = this.getClient();
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system + trailing },
      { role: 'user', content: user },
    ];
    try {
      const completion = await client.chat.completions.parse({
        model: resolveModel(),
        messages,
        response_format: format,
      });
      const message = completion.choices[0]?.message;
      if (message?.refusal) {
        throw new LlmError('invalid-output', `The model refused: ${message.refusal}`);
      }
      if (!message?.parsed) {
        throw new LlmError('invalid-output', `The model returned no ${label}.`);
      }
      return message.parsed;
    } catch (error) {
      if (isUnsupportedStructuredFormat(error)) {
        return this.requestPlainJson(client, system, user, label, format, envelope, trailing);
      }
      throw asLlmError(error);
    }
  }

  /** The retry: schema in the prompt, json_object out, re-validated here. */
  private async requestPlainJson<E>(
    client: OpenAI,
    system: string,
    user: string,
    label: 'script' | 'storyboard',
    format: EnvelopeFormat<E>,
    envelope: z.ZodType<E>,
    trailing: string,
  ): Promise<E> {
    const body: ChatCompletionCreateParamsNonStreaming = {
      model: resolveModel(),
      messages: [
        { role: 'system', content: system + schemaInstruction(format) + trailing },
        { role: 'user', content: user },
      ],
      response_format: JSON_OBJECT_FORMAT,
      max_tokens: FALLBACK_MAX_TOKENS,
    };
    let completion: ChatCompletion;
    try {
      // The JS SDK has no `extra_body` (that is the Python client); the request
      // options' `body` override is how provider-specific fields travel.
      // DeepSeek V4 thinks by default, and reasoning tokens can eat the budget
      // and leave `content` empty -- off.
      completion = await client.chat.completions.create(body, {
        body: { ...body, thinking: { type: 'disabled' } },
      });
    } catch (error) {
      throw asLlmError(error);
    }

    const choice = completion.choices[0];
    const message = choice?.message;
    if (message?.refusal) {
      throw new LlmError('invalid-output', `The model refused: ${message.refusal}`);
    }
    if (choice?.finish_reason === 'length') {
      throw new LlmError('invalid-output', `The model ran out of tokens writing the ${label}.`);
    }
    if (!message?.content || message.content.trim() === '') {
      throw new LlmError('invalid-output', `The model returned no ${label}.`);
    }

    let json: unknown;
    try {
      json = parseJsonContent(message.content);
    } catch {
      throw new LlmError('invalid-output', `The model returned a ${label} that is not valid JSON.`);
    }

    const parsed = envelope.safeParse(json);
    if (!parsed.success) {
      throw new LlmError(
        'invalid-output',
        `The model returned a ${label} that does not match the expected format.`,
        zodIssueDetails(parsed.error),
      );
    }
    return parsed.data;
  }

  async generateScript(input: string): Promise<Script> {
    const envelope = await this.requestEnvelope(
      SCRIPT_SYSTEM_PROMPT,
      input,
      'script',
      scriptResponseFormat(),
      ScriptEnvelopeSchema,
    );
    return envelope.script;
  }

  async generateScenes(script: Script): Promise<Scenes> {
    const request = `Title: ${script.title}\n\nScript:\n${script.text}`;
    let user = request;

    for (let attempt = 1; ; attempt += 1) {
      const envelope = await this.requestEnvelope(
        SCENES_SYSTEM_PROMPT,
        user,
        'storyboard',
        scenesResponseFormat(),
        ScenesEnvelopeSchema,
        storyboardCapsReminder(),
      );

      // Scenes travel wrapped so the JSON Schema root can be an object; unwrap
      // before validating, and report problems field by field.
      const validation = validateScenes(envelope.scenes);
      if (validation.ok) {
        return validation.scenes;
      }
      if (attempt >= MAX_STORYBOARD_ATTEMPTS) {
        throw new LlmError(
          'invalid-output',
          'The model returned a storyboard that does not match the scene format.',
          validation.errors,
        );
      }
      // The repair carries the same title and script, plus what the validator
      // said about specific scenes.
      user = request + repairInstruction(validation.errors);
    }
  }
}

function asLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  return new LlmError('request-failed', describeApiError(error));
}

/* ──────────────────────────── test fake ─────────────────────────── */

export type FakeLlmOptions = {
  script?: Script;
  /** Deliberately `unknown`: tests feed malformed storyboards through here. */
  scenes?: unknown;
  scriptError?: Error;
  scenesError?: Error;
};

export class FakeLlm implements Llm {
  readonly calls: { script: string[]; scenes: Script[] } = { script: [], scenes: [] };

  constructor(private readonly options: FakeLlmOptions = {}) {}

  async generateScript(input: string): Promise<Script> {
    this.calls.script.push(input);
    if (this.options.scriptError) {
      throw this.options.scriptError;
    }
    return this.options.script ?? FAKE_SCRIPT;
  }

  async generateScenes(script: Script): Promise<Scenes> {
    this.calls.scenes.push(script);
    if (this.options.scenesError) {
      throw this.options.scenesError;
    }
    const validation = validateScenes(this.options.scenes ?? fakeScenes());
    if (!validation.ok) {
      throw new LlmError(
        'invalid-output',
        'The model returned a storyboard that does not match the scene format.',
        validation.errors,
      );
    }
    return validation.scenes;
  }
}
