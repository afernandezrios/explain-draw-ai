/**
 * POST /api/projects/<id>/render -- start rendering the whole video.
 *
 * Takes no body. The storyboard must total inside the 270-330s window; the same
 * check runs again in the worker, which is what makes `npm run render` by hand
 * behave the same as this route.
 */

import { NextResponse } from 'next/server';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { readScenes, readScript } from '../../../../../lib/pipeline.ts';
import { startJob } from '../../../../../render/render-jobs.ts';
import { checkBudget } from '../../../../../scenes/schema.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  // A non-empty body is refused rather than ignored: a stale caller still
  // posting the old per-scene preview's `{"sceneIndex": 0}` must not have its
  // typo silently start a full render.
  const text = await request.text();
  if (text.trim() !== '') {
    return apiError(400, 'BAD_JSON', 'POST /render takes no body.');
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

  const budget = checkBudget(scenes.scenes);
  if (!budget.ok) {
    return apiError(409, 'BUDGET', budget.message);
  }

  const started = startJob({ projectId: id });
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

  return NextResponse.json({ ok: true, pid: started.pid });
}
