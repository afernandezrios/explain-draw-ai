/**
 * POST /api/projects/<id>/render -- start rendering.
 *
 * With no body, renders the whole video and refuses unless the storyboard total
 * is inside the 270-330s window. With `{ "sceneIndex": n }` it renders that one
 * scene as a preview, which is deliberately exempt from the window: previewing a
 * scene is how you look at a storyboard that is still being fixed.
 */

import { NextResponse } from 'next/server';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { readScenes, readScript } from '../../../../../lib/pipeline.ts';
import { startJob } from '../../../../../lib/render-jobs.ts';
import { checkBudget } from '../../../../../lib/schema.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

type SceneIndexResult =
  | { ok: true; sceneIndex?: number }
  | { ok: false; message: string };

/**
 * `sceneIndex` is optional, but when present it must be a non-negative integer.
 * Coercing "1" or 1.5 instead would silently render a scene nobody asked for.
 */
function parseSceneIndex(body: unknown): SceneIndexResult {
  const raw = (body as { sceneIndex?: unknown } | null)?.sceneIndex;
  if (raw === undefined || raw === null) {
    return { ok: true };
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return { ok: false, message: '"sceneIndex" must be a non-negative integer when it is present.' };
  }
  return { ok: true, sceneIndex: raw };
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  // An empty body is the normal case (render everything), so a parse failure is
  // only fatal if something was actually sent.
  const text = await request.text();
  let body: unknown = null;
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return apiError(400, 'BAD_JSON', 'The request body is not valid JSON.');
    }
    // JSON that is not an object cannot carry a sceneIndex, and reading one as
    // "render everything" would turn a caller's typo into a full render.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return apiError(400, 'BAD_JSON', 'The request body must be a JSON object, like {"sceneIndex": 0}.');
    }
  }

  const parsed = parseSceneIndex(body);
  if (!parsed.ok) {
    return apiError(400, 'BAD_SCENE_INDEX', parsed.message);
  }

  // A project that is not there is a 404, not a storyboard problem: the same
  // answer every other route gives for an unknown id, and the one a caller can
  // act on (create it, or fix the id) rather than retrying the render.
  if (readScript(id) === null) {
    return apiError(404, 'NO_PROJECT', `There is no project ${id}.`);
  }

  const scenes = readScenes(id);
  if (!scenes.ok) {
    return apiError(
      422,
      'INVALID_SCENES',
      'scenes.json does not match the scene format, so nothing was rendered.',
      scenes.errors,
    );
  }
  if (scenes.scenes.length === 0) {
    return apiError(422, 'NO_SCENES', 'This project has no scenes to render.');
  }

  const sceneIndex = parsed.sceneIndex;
  const previewing = sceneIndex !== undefined;
  if (sceneIndex !== undefined && sceneIndex >= scenes.scenes.length) {
    return apiError(
      400,
      'SCENE_OUT_OF_RANGE',
      `Scene ${sceneIndex} does not exist; this storyboard has ${scenes.scenes.length}.`,
    );
  }

  if (!previewing) {
    const budget = checkBudget(scenes.scenes);
    if (!budget.ok) {
      // The same check runs again in the worker, which is what makes `npm run
      // render` by hand behave the same as this route.
      return apiError(409, 'BUDGET', budget.message);
    }
  }

  const started = startJob({
    projectId: id,
    mode: previewing ? 'preview' : 'full',
    sceneIndex,
  });
  if (!started.ok) {
    if (started.reason === 'lock-error') {
      // No lock could be written, so the worker we spawned was stopped instead
      // of being left running where nothing could cancel it.
      return apiError(500, 'LOCK_FAILED', started.message);
    }
    return apiError(
      409,
      'BUSY',
      started.activeProjectId === id
        ? 'This project is already rendering.'
        : `Another render is running (${started.activeProjectId}). One at a time -- cancel it or wait.`,
    );
  }

  return NextResponse.json({ ok: true, pid: started.pid, mode: previewing ? 'preview' : 'full' });
}
