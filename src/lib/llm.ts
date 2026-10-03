/**
 * The LLM boundary.
 *
 * This is the only seam the tests fake: everything behind it (validation,
 * rendering, files) is the real thing in test as in production. That keeps the
 * suite honest and fast.
 *
 * The model is asked for the DSL in the schema's own vocabulary. The scene-kind
 * list, the per-kind caps and the written-word budgets below are all read out of
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
import { logEvent } from './logger.ts';
import { MAX_INPUT_CHARS, MAX_TITLE_CHARS } from './render-config.ts';
import type { Script } from './types.ts';
import {
  ACCENTS,
  MAX_SCENE_SECONDS,
  MAX_TOTAL_SECONDS,
  MIN_SCENE_SECONDS,
  MIN_TOTAL_SECONDS,
  NARRATION_WPS,
  ProviderScenesEnvelopeSchema,
  SCENE_CAPS,
  SCENE_KINDS,
  SCENE_NOTES,
  ScenesEnvelopeSchema,
  TARGET_TOTAL_SECONDS,
  THEMES,
  checkBudget,
  countWords,
  formatClock,
  issueDetails,
  maxNarrationWords,
  maxWrittenWords,
  validateScenes,
  type BudgetCheck,
  type Scenes,
} from './schema.ts';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * A generate call gets four minutes, then it gives up. Two of those are the
 * storyboard: with thinking enabled, one call can run past the old two-minute
 * mark, and a timeout there loses the whole generate.
 */
export const REQUEST_TIMEOUT_MS = 240_000;
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
  /**
   * Per-call records written by the real client, read by `generate.ts` for the
   * numbers the UI shows. Optional so the test fake implements nothing extra.
   */
  readonly callLog?: readonly LlmCallMeta[];
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

/* ────────────────────────── call metadata ───────────────────────── */

/** `json_schema` is the strict structured-outputs mode; `json_object` the fallback. */
export type LlmCallMode = 'json_schema' | 'json_object';

export type LlmCallOutcome = 'ok' | 'fallback' | 'invalid-output' | 'request-failed' | 'missing-key';

/**
 * What one logical model call cost. The strict request and its plain-JSON
 * fallback are two entries (mode tells them apart); a `fallback` entry carries
 * zero usage because the provider rejected the strict request without an
 * answer, so the fallback's usage is the traffic that actually happened.
 */
export type LlmCallMeta = {
  label: 'script' | 'storyboard';
  model: string;
  mode: LlmCallMode;
  /** 1-based storyboard attempt (the repair loop); always 1 for the script. */
  attempt: number;
  durationMs: number;
  outcome: LlmCallOutcome;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export type LlmCallUsage = LlmCallMeta['usage'];

const EMPTY_USAGE: LlmCallUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/* ──────────────────────────── prompts ───────────────────────────── */

/** Words a ~5 minute spoken script would run to; only a steer for the model. */
const TARGET_SCRIPT_WORDS = Math.round((TARGET_TOTAL_SECONDS / 60) * 140);

/**
 * Scene counts for scenes of 12-18 seconds -- the middle of the 7-20s range a
 * scene may run, and what the prompt quotes. The 15-42 counts the hard bounds
 * allow reach the target only by hugging one edge, and a model that reads them
 * as "anything in here is fine" lands short; quoted, they are a trap.
 */
const TYPICAL_SCENES_LO = Math.round(TARGET_TOTAL_SECONDS / 18);
const TYPICAL_SCENES_HI = Math.round(TARGET_TOTAL_SECONDS / 12);

export const SCRIPT_SYSTEM_PROMPT = [
  'You write scripts for short animated explainer videos: clean, modern diagram scenes built from flat shapes and clear typography.',
  `Write for about ${TARGET_TOTAL_SECONDS} seconds (${Math.floor(
    TARGET_TOTAL_SECONDS / 60,
  )} minutes) of spoken explanation, roughly ${TARGET_SCRIPT_WORDS} words.`,
  'Structure the script as a short title plus markdown-ish body text with one heading per beat.',
  'Every beat must be something that can be shown: a list of points, a pipeline, a hierarchy, an ordered process, a short code listing, or a diagram of an idea.',
  'Plain language, no jargon dumps, no bullet-point walls.',
].join(' ');

/**
 * Every whole-second scene length and the words it allows, as one table.
 *
 * This replaces three anchors (7s, 10s, 20s) that all happened to divide evenly
 * by the rate then in use (2.5). They taught the model to multiply and never to
 * round down, while odd lengths landed on half words -- 2.5 words per second of
 * 19 seconds is 47.5, and the validator floors that to 47. A storyboard one word
 * over on one scene is rejected whole, so the table states the arithmetic rather
 * than leaving the model to interpolate. Derived from `maxNarrationWords`, so
 * the table and the check cannot disagree.
 */
const NARRATION_BUDGET_TABLE = Array.from(
  { length: MAX_SCENE_SECONDS - MIN_SCENE_SECONDS + 1 },
  (_, offset) => {
    const seconds = MIN_SCENE_SECONDS + offset;
    return `${seconds}s: ${maxNarrationWords(seconds)} words`;
  },
).join(', ');

/**
 * The rounding rule, said once and quoted twice -- the prompt and the trailing
 * reminder both need it. The example is an odd scene length: the case that
 * carries a rounding decision whenever the rate is not a whole number.
 */
function narrationRoundingExample(): string {
  // An even maximum means the odd length below it is in range; an odd maximum is
  // one itself.
  const seconds = MAX_SCENE_SECONDS % 2 === 0 ? MAX_SCENE_SECONDS - 1 : MAX_SCENE_SECONDS;
  const budget = maxNarrationWords(seconds);
  return `${seconds} seconds allows ${budget} words, never ${budget + 1}`;
}

export const SCENES_SYSTEM_PROMPT = [
  'You turn an explainer script into a storyboard of clean, animated diagram scenes.',
  '',
  'Each scene is one of these kinds, and the kind decides how it is drawn:',
  ...SCENE_KINDS.map((kind) => `- ${kind}: ${SCENE_NOTES[kind]}`),
  '',
  'Rules:',
  `- every scene lasts ${MIN_SCENE_SECONDS} to ${MAX_SCENE_SECONDS} seconds`,
  `- a scene may write only so many words on screen, and the cap depends on its kind: ${SCENE_KINDS.map(
    (kind) => `${kind} ${maxWrittenWords(kind)}`,
  ).join(', ')}. Count every word the scene shows -- its title, an item's label and detail, a node's name and role, the explanation with its terms and points -- and leave a few words of headroom under the cap`,
  `- the field caps are part of the same rule: ${SCENE_KINDS.filter((kind) => SCENE_CAPS[kind] !== '')
    .map((kind) => `${kind}: ${SCENE_CAPS[kind]}`)
    .join(', ')}`,
  `- theme is ${THEMES.map((theme) => `"${theme}"`).join(' or ')} (null is dark), and accent marks the one thing that matters most in a scene: one of ${ACCENTS.join(', ')}, or null. Use accent as a signal, not decoration`,
  '- in a topology, `parent` is the 0-based index of an earlier node in the same scene, and exactly one node has no parent -- the root. A parent listed after its child is rejected',
  '- every optional field must be present in your reply. When a field does not apply, write null; leaving it out is rejected',
  `- size each narration to its own scene at ${NARRATION_WPS} words per second, rounded DOWN to a whole word. The full budget: ${NARRATION_BUDGET_TABLE}`,
  `- never round up -- ${narrationRoundingExample()} -- because a narration one word over its scene's budget is rejected`,
  '- leave two or three words of headroom under the budget rather than writing right up to it: a scene whose narration ends early is fine, a narration that cannot be spoken in the time the scene is on screen is not',
  '- write narration as plain spoken English in full sentences: it is read aloud, so no headings, no lists, no stage directions',
  `- aim for about ${TARGET_TOTAL_SECONDS} seconds in total, and that total is checked: add up every scene's seconds, and the sum must land between ${MIN_TOTAL_SECONDS} and ${MAX_TOTAL_SECONDS} seconds. Scenes of 12-18 seconds are typical, which is roughly ${TYPICAL_SCENES_LO} to ${TYPICAL_SCENES_HI} scenes -- 9 or 10 short scenes totals under two minutes and is refused. Your best measure is the narration: read at ${NARRATION_WPS} words per second, the script's words are the minutes of your video, so all the scenes' narrations together should re-tell the whole script, not condense it`,
  '- scene 1 is the title scene: the `title` kind, stating the topic like a title card',
  '- choose the kind that fits each beat rather than the same kind for everything: a list of reasons is points, a chain of stages is flow, an ordered walk-through is sequence, who reports to whom is topology, an excerpt to read closely is code, and the one idea the video exists for is concept',
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
 * `minItems`/`maxItems`, so nothing in the grammar stops a points scene listing
 * six items. Interpolated from the same constants the validator uses, so the
 * reminder cannot drift from the rule.
 */
function storyboardCapsReminder(script: Script): string {
  const scriptWords = countWords(script.text);
  return (
    '\n\nReminder: count the words each scene writes on screen -- every kind has ' +
    `its own cap (${SCENE_KINDS.map((kind) => `${kind} ${maxWrittenWords(kind)}`).join(', ')}) -- and keep ` +
    `each scene's narration to the word budget for its own length: ${NARRATION_WPS} words per ` +
    `second rounded DOWN to a whole word (${narrationRoundingExample()}). The script runs to ` +
    `${scriptWords} words, which read aloud at ${NARRATION_WPS} words per second is ` +
    `${formatClock(Math.round(scriptWords / NARRATION_WPS))} of narration: all the scenes' ` +
    `narrations together should re-tell the whole script, not condense it, and the ` +
    `scenes' seconds added together must land between ${formatClock(MIN_TOTAL_SECONDS)} ` +
    `and ${formatClock(MAX_TOTAL_SECONDS)}.`
  );
}

/**
 * The validator's complaints, rewritten as a repair request. Scene indices
 * become 1-based scene numbers, because the prompt calls the title scene
 * "scene 1" and the model must fix the scene the validator means, not the one
 * two doors down.
 *
 * The index arrives in one of two shapes: `scenes.2.items`, when the complaint
 * came from the envelope, or `2.items`, from `validateScenes` walking the
 * unwrapped array -- which is the one `generateScenes` actually feeds in. Both
 * are handled, so neither has to know about the other.
 */
function repairInstruction(errors: string[]): string {
  const problems = errors
    .map(
      (error) =>
        '- ' +
        error.replace(/^(?:scenes\.)?(\d+)\./, (_, index: string) => `scene ${Number(index) + 1}, `),
    )
    .join('\n');
  return (
    '\n\nYour previous storyboard was rejected. Fix exactly these problems and return the ' +
    `complete, corrected storyboard:\n${problems}`
  );
}

/**
 * The total-duration complaint, rewritten as a repair request. The per-scene
 * validator cannot see the window -- that is `checkBudget`'s business -- so a
 * storyboard that is inside every scene rule but outside the window gets this
 * one specific instruction instead of a generic "make it longer": the script's
 * own word count is the anchor, because narration is what fills the time.
 */
function budgetRepairInstruction(
  script: Script,
  budget: Extract<BudgetCheck, { ok: false }>,
): string {
  if (budget.roundedSeconds < MIN_TOTAL_SECONDS) {
    const scriptWords = countWords(script.text);
    return (
      `the storyboard totals ${formatClock(budget.roundedSeconds)}, under the ` +
      `${formatClock(MIN_TOTAL_SECONDS)} minimum: add scenes and lengthen narrations until ` +
      `the seconds total lands between ${formatClock(MIN_TOTAL_SECONDS)} and ` +
      `${formatClock(MAX_TOTAL_SECONDS)}. The script runs to ${scriptWords} words -- about ` +
      `${formatClock(Math.round(scriptWords / NARRATION_WPS))} of narration -- and all the ` +
      `scenes' narrations together must re-tell the whole script, not condense it`
    );
  }
  return (
    `the storyboard totals ${formatClock(budget.roundedSeconds)}, over the ` +
    `${formatClock(MAX_TOTAL_SECONDS)} maximum: shorten or merge scenes until the seconds ` +
    `total lands between ${formatClock(MIN_TOTAL_SECONDS)} and ${formatClock(MAX_TOTAL_SECONDS)}`
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
let scenesFormat: ReturnType<typeof zodResponseFormat<typeof ProviderScenesEnvelopeSchema>> | null =
  null;

/**
 * The JSON Schema actually sent to the provider. Built by the SDK's own
 * zod-to-strict-JSON-Schema converter rather than by hand: the provider accepts
 * only a subset of JSON Schema (object root, `anyOf` but never `oneOf`, no
 * `default`/`minItems`/`maxItems`) and the converter applies those rules by
 * construction. It throws at build time if the schema leaves the subset, which
 * is why these are memoised and why a test asserts the result.
 *
 * The storyboard's is built from `ProviderScenesEnvelopeSchema` rather than the
 * envelope replies are read with, so the model is told about the anchor fields
 * at all: the strict subset cannot spell "may be absent", so in the schema we
 * send they are required and the model writes `null`. Reading the reply back is
 * a separate question, and a looser one -- see `generateScenes`.
 */
export function scriptResponseFormat() {
  scriptFormat ??= zodResponseFormat(ScriptEnvelopeSchema, 'script');
  return scriptFormat;
}

export function scenesResponseFormat() {
  scenesFormat ??= zodResponseFormat(ProviderScenesEnvelopeSchema, 'scenes');
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
 * full storyboard mid-JSON. Sized for thinking mode: reasoning tokens come out
 * of the same budget as the answer, so the cap holds both -- 32k truncated
 * thinking-on storyboards mid-JSON, while 64k is well over anything the
 * ~40-scene DSL needs and well under deepseek-v4-flash's documented 384k
 * output ceiling.
 */
const FALLBACK_MAX_TOKENS = 65_536;

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

/* ─────────────────────────── real client ────────────────────────── */

export function resolveModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export function resolveBaseUrl(): string {
  return process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export function resolveThinkingMode(): boolean {
  return process.env.LLM_THINKING_MODE?.trim() === "true";
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

/** The usage the provider reported; zeros when it reported nothing. */
function usageOf(completion: ChatCompletion): LlmCallUsage {
  const usage = completion.usage;
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

/**
 * The model's reply, cut to what a log line can carry. The strict path has no
 * raw `content` to excerpt from, so its parsed payload stands in.
 */
function responsePreview(completion: ChatCompletion, parsedFallback?: unknown): string {
  const content = completion.choices[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : parsedFallback === undefined
        ? ''
        : JSON.stringify(parsedFallback);
  return text.slice(0, 1000);
}

export class OpenAiLlm implements Llm {
  private client: OpenAI | null = null;

  /** Every logical call this instance made; the test fake never writes these. */
  readonly callLog: LlmCallMeta[] = [];

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
   * The one place a call's outcome is recorded: into this instance's `callLog`
   * (where `generate.ts` reads the numbers the UI shows) and into the log.
   * Purely observational -- callers decide what to throw.
   */
  private recordEnd(
    base: { label: 'script' | 'storyboard'; model: string; mode: LlmCallMode; attempt: number },
    started: number,
    outcome: LlmCallOutcome,
    usage: LlmCallUsage,
    extra?: { errorMessage?: string; details?: string[]; responsePreview?: string },
  ): void {
    const entry: LlmCallMeta = { ...base, durationMs: Date.now() - started, outcome, usage };
    this.callLog.push(entry);
    logEvent(outcome === 'ok' || outcome === 'fallback' ? 'info' : 'error', {
      event: 'llm.response',
      ...base,
      durationMs: entry.durationMs,
      outcome,
      usage,
      ...extra,
    });
  }

  /**
   * Strict structured outputs first; a provider that rejects schema mode gets
   * the same call retried in plain JSON mode. `label` names the artefact in
   * errors the user reads ("the model returned no storyboard").
   *
   * The two schemas can differ, which is why there are two type parameters
   * rather than one: `format` is what the provider is asked to produce, and
   * `envelope` is what we read a reply with. The constraint says the second may
   * be the looser of the two -- the provider's storyboard schema requires the
   * anchor fields, while the one we parse with only allows them -- so what comes
   * back is always assignable to what the caller asked for, and no cast is
   * needed to say so.
   */
  private async requestEnvelope<P extends E, E>(
    system: string,
    user: string,
    label: 'script' | 'storyboard',
    format: EnvelopeFormat<P>,
    envelope: z.ZodType<E>,
    /** Appended after the fallback's schema blob, where the model reads last. */
    trailing = '',
    /** Which storyboard attempt this is; the script call is always 1. */
    attempt = 1,
  ): Promise<E> {
    // Outside the try, so a missing key is still reported before any request.
    let client: OpenAI;
    try {
      client = this.getClient();
    } catch (error) {
      if (error instanceof LlmError && error.kind === 'missing-key') {
        logEvent('error', {
          event: 'llm.error',
          label,
          model: resolveModel(),
          mode: 'json_schema',
          attempt,
          durationMs: 0,
          errorKind: 'missing-key',
          errorMessage: error.message,
        });
      }
      throw error;
    }
    const model = resolveModel();
    const started = Date.now();
    logEvent('info', {
      event: 'llm.request',
      label,
      model,
      mode: 'json_schema',
      attempt,
      system: system + trailing,
      user,
    });
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system + trailing },
      { role: 'user', content: user },
    ];
    const base = { label, model, mode: 'json_schema' as const, attempt };
    // Set by the two throw sites below, so the catch does not record their
    // outcome twice.
    let recorded = false;
    try {
      const completion = await client.chat.completions.parse({
        model,
        messages,
        response_format: format,
      });
      const message = completion.choices[0]?.message;
      if (message?.refusal) {
        this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
          errorMessage: `The model refused: ${message.refusal}`,
          responsePreview: responsePreview(completion),
        });
        recorded = true;
        throw new LlmError('invalid-output', `The model refused: ${message.refusal}`);
      }
      if (!message?.parsed) {
        this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
          errorMessage: `The model returned no ${label}.`,
          responsePreview: responsePreview(completion),
        });
        recorded = true;
        throw new LlmError('invalid-output', `The model returned no ${label}.`);
      }
      this.recordEnd(base, started, 'ok', usageOf(completion), {
        responsePreview: responsePreview(completion, message.parsed),
      });
      return message.parsed;
    } catch (error) {
      if (isUnsupportedStructuredFormat(error)) {
        // The downgrade itself is logged: the strict attempt ends here, and the
        // fallback call below logs its own request and response lines.
        this.recordEnd(base, started, 'fallback', EMPTY_USAGE, {
          errorMessage: error.message,
        });
        return this.requestPlainJson(client, system, user, label, format, envelope, trailing, attempt);
      }
      const llmError = asLlmError(error, label);
      if (!recorded) {
        this.recordEnd(
          base,
          started,
          llmError.kind === 'invalid-output' ? 'invalid-output' : 'request-failed',
          EMPTY_USAGE,
          { errorMessage: llmError.message, details: llmError.details },
        );
      }
      throw llmError;
    }
  }

  /** The retry: schema in the prompt, json_object out, re-validated here. */
  private async requestPlainJson<E>(
    client: OpenAI,
    system: string,
    user: string,
    label: 'script' | 'storyboard',
    /** Read only for its JSON Schema, so what it parses to does not matter. */
    format: EnvelopeFormat<unknown>,
    envelope: z.ZodType<E>,
    trailing: string,
    attempt = 1,
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
    const model = resolveModel();
    const started = Date.now();
    logEvent('info', {
      event: 'llm.request',
      label,
      model,
      mode: 'json_object',
      attempt,
      system: system + schemaInstruction(format) + trailing,
      user,
    });
    const base = { label, model, mode: 'json_object' as const, attempt };
    let completion: ChatCompletion;
    try {
      // The JS SDK has no `extra_body` (that is the Python client); the request
      // options' `body` override is how provider-specific fields travel.
      // Thinking is on by configuration (LLM_THINKING_MODE): v4-flash without
      // it under-produces -- 9-scene storyboards a third of the required
      // length, shape counts one over the cap. Reasoning tokens come out of
      // the same budget as the answer, which is what `FALLBACK_MAX_TOKENS` is
      // sized for. Flipping the knob off is the cheap, less compliant mode.
      const thinkingMode = resolveThinkingMode() ? 'enabled' : 'disabled';
      completion = await client.chat.completions.create(body, {
        body: { ...body, thinking: { type: thinkingMode } },
      });
    } catch (error) {
      const llmError = asLlmError(error, label);
      // The SDK's own retry (maxRetries) is invisible here: one line covers the
      // whole logical attempt, however many HTTP requests it took.
      this.recordEnd(
        base,
        started,
        llmError.kind === 'invalid-output' ? 'invalid-output' : 'request-failed',
        EMPTY_USAGE,
        { errorMessage: llmError.message, details: llmError.details },
      );
      throw llmError;
    }

    const choice = completion.choices[0];
    const message = choice?.message;
    if (message?.refusal) {
      this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
        errorMessage: `The model refused: ${message.refusal}`,
        responsePreview: responsePreview(completion),
      });
      throw new LlmError('invalid-output', `The model refused: ${message.refusal}`);
    }
    if (choice?.finish_reason === 'length') {
      this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
        errorMessage: `The model ran out of tokens writing the ${label}.`,
        responsePreview: responsePreview(completion),
      });
      throw new LlmError('invalid-output', `The model ran out of tokens writing the ${label}.`);
    }
    if (!message?.content || message.content.trim() === '') {
      this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
        errorMessage: `The model returned no ${label}.`,
        responsePreview: responsePreview(completion),
      });
      throw new LlmError('invalid-output', `The model returned no ${label}.`);
    }

    let json: unknown;
    try {
      json = parseJsonContent(message.content);
    } catch {
      this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
        errorMessage: `The model returned a ${label} that is not valid JSON.`,
        responsePreview: responsePreview(completion),
      });
      throw new LlmError('invalid-output', `The model returned a ${label} that is not valid JSON.`);
    }

    const parsed = envelope.safeParse(json);
    if (!parsed.success) {
      const details = issueDetails(parsed.error);
      this.recordEnd(base, started, 'invalid-output', usageOf(completion), {
        errorMessage: `The model returned a ${label} that does not match the expected format.`,
        details,
        responsePreview: responsePreview(completion),
      });
      throw new LlmError(
        'invalid-output',
        `The model returned a ${label} that does not match the expected format.`,
        details,
      );
    }
    this.recordEnd(base, started, 'ok', usageOf(completion), {
      responsePreview: responsePreview(completion),
    });
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
        storyboardCapsReminder(script),
        attempt,
      );

      // Scenes travel wrapped so the JSON Schema root can be an object; unwrap
      // and validate. There is nothing to lay out: each kind's block owns its
      // own placement, and the one relational rule -- a topology's `parent` --
      // is judged here rather than resolved.
      const validation = validateScenes(envelope.scenes);

      if (!validation.ok) {
        if (attempt >= MAX_STORYBOARD_ATTEMPTS) {
          // The model answered and was paid for it; the rejection is on our side.
          const lastCall = this.callLog.at(-1);
          logEvent('error', {
            event: 'llm.error',
            label: 'storyboard',
            model: lastCall?.model ?? resolveModel(),
            mode: lastCall?.mode ?? 'json_schema',
            attempt,
            durationMs: lastCall?.durationMs ?? 0,
            errorKind: 'invalid-output',
            errorMessage: 'The model returned a storyboard that does not match the scene format.',
            details: validation.errors,
          });
          throw new LlmError(
            'invalid-output',
            'The model returned a storyboard that does not match the scene format.',
            validation.errors,
          );
        }
        const errors = validation.errors;
        logEvent('warn', { event: 'storyboard.rejected', attempt, errors });
        // The repair carries the same title and script, plus what the validator
        // said about specific scenes.
        user = request + repairInstruction(errors);
        continue;
      }

      // The storyboard is drawable. One complaint can still be worth a repair
      // ask: a total outside the window, which the per-scene validator cannot
      // see because only `checkBudget` watches it. One ask is worth it; a
      // second round that could throw the whole storyboard away over a
      // still-short total is not, so at the last attempt the storyboard is
      // taken as it is -- the app refuses a render outside the window and
      // offers Regenerate.
      const budget = checkBudget(validation.scenes);
      const complaints = budget.ok ? [] : [budgetRepairInstruction(script, budget)];
      if (complaints.length === 0 || attempt >= MAX_STORYBOARD_ATTEMPTS) {
        return validation.scenes;
      }
      logEvent('warn', { event: 'storyboard.rejected', attempt, errors: complaints });
      user = request + repairInstruction(complaints);
    }
  }
}

function asLlmError(error: unknown, label: string): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  // The strict path hands the reply straight to the envelope's zod schema with a
  // throwing `parse`, so a reply that breaks the structural rules rejects the SDK
  // call with a raw ZodError. That is our verdict on the model's answer, not a
  // failed request -- filed as one it reaches the user as a 502 saying the
  // endpoint failed, when the endpoint answered perfectly well.
  if (error instanceof z.ZodError) {
    return new LlmError(
      'invalid-output',
      `The model returned a ${label} that does not match the expected format.`,
      issueDetails(error),
    );
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
