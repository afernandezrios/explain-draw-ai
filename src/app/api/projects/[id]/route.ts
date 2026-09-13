/**
 * GET /api/projects/<id> -- everything the page needs to render itself.
 *
 * One request rather than five: the page loads, polls status separately, and
 * needs the script, the storyboard, the budget verdict and whether a video or
 * preview exists.
 */

import { NextResponse } from 'next/server';
import { apiError, requireProjectId } from '../../../../lib/http.ts';
import {
  hasPreview,
  hasVideo,
  readInput,
  readScenes,
  readScript,
  readStatus,
} from '../../../../lib/pipeline.ts';
import { activeJob } from '../../../../lib/render-jobs.ts';
import { checkBudget } from '../../../../lib/schema.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  const script = readScript(id);
  if (script === null) {
    return apiError(404, 'NO_PROJECT', `There is no project ${id}.`);
  }

  const scenes = readScenes(id);

  return NextResponse.json({
    projectId: id,
    input: readInput(id),
    script,
    scenes: scenes.ok ? scenes.scenes : [],
    sceneErrors: scenes.ok ? [] : scenes.errors,
    budget: scenes.ok ? checkBudget(scenes.scenes) : null,
    status: readStatus(id),
    hasVideo: hasVideo(id),
    hasPreview: hasPreview(id),
    renderActive: activeJob()?.projectId === id,
  });
}
