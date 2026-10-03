/**
 * GET /api/projects/<id>/status -- polled while a render runs.
 *
 * `renderActive` comes from the lock, not from status.json. The two can
 * disagree: status.json is written by the worker and goes stale the moment it
 * is killed, whereas the lock is reclaimed as soon as its pid is gone. The UI
 * treats a terminal status as final only when it also started before the job it
 * is describing.
 */

import { NextResponse } from 'next/server';
import { requireProjectId } from '../../../../../lib/http.ts';
import { hasVideo, readScenes, readStatus } from '../../../../../lib/pipeline.ts';
import { activeJob } from '../../../../../lib/render-jobs.ts';
import { checkBudget } from '../../../../../lib/schema.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  const scenes = readScenes(id);

  return NextResponse.json({
    status: readStatus(id),
    renderActive: activeJob()?.projectId === id,
    hasVideo: hasVideo(id),
    budget: scenes.ok ? checkBudget(scenes.scenes) : null,
  });
}
