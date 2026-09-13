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
import { checkBudget, type BudgetCheck, type Scenes } from './schema.ts';

export type GenerateResult =
  | { ok: true; projectId: string; script: Script; scenes: Scenes; budget: BudgetCheck }
  | ApiFailure;

export type StoryboardResult = { ok: true; script: Script; scenes: Scenes; budget: BudgetCheck } | ApiFailure;

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

  let projectId: string | null = null;
  try {
    // Validates emptiness and length before the model is called, and before any
    // folder exists.
    const script = await textToScript(input, llm);
    projectId = createProject(input);
    writeScript(projectId, script);

    const scenes = await scriptToScenes(script, llm);
    writeScenes(projectId, scenes);

    return { ok: true, projectId, script, scenes, budget: checkBudget(scenes) };
  } catch (error) {
    if (projectId) {
      // A folder holding half a project would list as a project with everything
      // missing. Deleted by id, never by parent.
      removeProject(projectId);
    }
    return failureFrom(error);
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
    return failure(404, 'NO_PROJECT', `There is no project ${id}.`);
  }

  try {
    const scenes = await scriptToScenes(script, llm);
    writeScenes(id, scenes);
    return { ok: true, script, scenes, budget: checkBudget(scenes) };
  } catch (error) {
    return failureFrom(error);
  }
}
