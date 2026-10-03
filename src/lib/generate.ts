/**
 * The generate pipeline, with the model as an injectable parameter.
 *
 * These two calls live here rather than inside the route handlers for two
 * reasons. A Next route module may export nothing but HTTP methods and its route
 * config, so a handler that took an `Llm` could not be reached by a test at all.
 * And this is the part worth testing: what actually exists on disk when the
 * first call succeeds and the second one fails.
 *
 * `llm` is a defaulted parameter, not a module-level constant, so the default is
 * built per call -- constructing `OpenAiLlm` never touches the network or the
 * environment, which is what lets a route test reach the MISSING_KEY path with
 * no key set.
 *
 * Failures come back as data (`ApiFailure`) instead of an HTTP response, so this
 * module stays free of `next/server` and the routes stay one-liners.
 */

import { failure, failureFrom, type ApiFailure } from './http.ts';
import { logEvent } from './logger.ts';
import { OpenAiLlm, type Llm, type Script } from './llm.ts';
import {
  createProject,
  readScript,
  removeProject,
  scriptToScenes,
  textToScript,
  writeScenes,
  writeScript,
} from './pipeline.ts';
import { checkBudget, type BudgetCheck, type Scenes } from '../scenes/schema.ts';

/** The numbers the UI shows in the success notices. */
export type GenerateMeta = {
  /** Wall-clock ms of the script call; null for a rebuild (no script call). */
  scriptMs: number | null;
  storyboardMs: number;
  /** The model name the LLM client used; null when no call was logged (test fake). */
  model: string | null;
  /** Aggregated across every call and attempt of this pipeline run. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export type GenerateResult =
  | {
      ok: true;
      projectId: string;
      script: Script;
      scenes: Scenes;
      budget: BudgetCheck;
      meta: GenerateMeta;
    }
  | ApiFailure;

export type StoryboardResult =
  | { ok: true; script: Script; scenes: Scenes; budget: BudgetCheck; meta: GenerateMeta }
  | ApiFailure;

/**
 * Sums the model client's own records. A `FakeLlm` records nothing, so tests
 * see nulls and zeros on fields they never read.
 */
function buildMeta(llm: Llm, scriptMs: number | null, storyboardMs: number): GenerateMeta {
  const calls = llm.callLog ?? [];
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const call of calls) {
    usage.promptTokens += call.usage.promptTokens;
    usage.completionTokens += call.usage.completionTokens;
    usage.totalTokens += call.usage.totalTokens;
  }
  return {
    scriptMs,
    storyboardMs,
    model: calls.find((call) => call.model !== '')?.model ?? null,
    usage,
  };
}

/**
 * Paste text in, get a project back.
 *
 * The order is load-bearing. Nothing is created on disk until the script has
 * come back, so a missing key, an empty input or a failed request leaves no
 * empty project behind; and once the folder does exist, any later failure
 * removes exactly that folder.
 */
export async function generateProject(
  body: unknown,
  llm: Llm = new OpenAiLlm(),
): Promise<GenerateResult> {
  const input = (body as { input?: unknown } | null)?.input;
  if (typeof input !== 'string') {
    return failure(400, 'BAD_INPUT', 'The request needs an "input" string.');
  }

  logEvent('info', { event: 'generate.start', inputChars: input.length });

  let projectId: string | null = null;
  try {
    // Validates emptiness and length before the model is called, and before any
    // folder exists.
    const scriptStarted = Date.now();
    const script = await textToScript(input, llm);
    const scriptMs = Date.now() - scriptStarted;
    logEvent('info', { event: 'generate.script.done', scriptMs });

    projectId = createProject(input);
    writeScript(projectId, script);

    const scenesStarted = Date.now();
    const scenes = await scriptToScenes(script, llm);
    const storyboardMs = Date.now() - scenesStarted;
    logEvent('info', { event: 'generate.storyboard.done', storyboardMs, scenes: scenes.length });

    writeScenes(projectId, scenes);

    logEvent('info', {
      event: 'generate.done',
      projectId,
      scriptMs,
      storyboardMs,
      scenes: scenes.length,
    });
    return {
      ok: true,
      projectId,
      script,
      scenes,
      budget: checkBudget(scenes),
      meta: buildMeta(llm, scriptMs, storyboardMs),
    };
  } catch (error) {
    if (projectId) {
      // A folder holding half a project would list as a project with everything
      // missing. Deleted by id, never by parent.
      removeProject(projectId);
    }
    const result = failureFrom(error);
    logEvent('error', { event: 'generate.failed', code: result.body.code, error: result.body.error });
    return result;
  }
}

/**
 * Rebuild the storyboard from the saved script, for the "Regenerate" button.
 *
 * scenes.json is written only once the model has returned a storyboard that
 * validates, so a failed regeneration leaves the previous storyboard exactly as
 * it was -- there is no window in which the file is missing or half-written.
 */
export async function regenerateStoryboard(
  id: string,
  llm: Llm = new OpenAiLlm(),
): Promise<StoryboardResult> {
  const script = readScript(id);
  if (script === null) {
    const result = failure(404, 'NO_PROJECT', `There is no project ${id}.`);
    logEvent('warn', { event: 'storyboard.failed', projectId: id, code: result.body.code });
    return result;
  }

  logEvent('info', { event: 'storyboard.start', projectId: id });

  try {
    const started = Date.now();
    const scenes = await scriptToScenes(script, llm);
    const storyboardMs = Date.now() - started;
    writeScenes(id, scenes);
    logEvent('info', { event: 'storyboard.done', projectId: id, storyboardMs, scenes: scenes.length });
    return {
      ok: true,
      script,
      scenes,
      budget: checkBudget(scenes),
      meta: buildMeta(llm, null, storyboardMs),
    };
  } catch (error) {
    const result = failureFrom(error);
    logEvent('error', { event: 'storyboard.failed', projectId: id, code: result.body.code });
    return result;
  }
}
