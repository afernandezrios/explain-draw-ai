/**
 * /api/projects -- the whole collection.
 *
 * GET lists the folders on disk for the toolbar's projects menu; POST takes
 * pasted text and returns a project. The pipeline itself (the two model calls,
 * the folder, the cleanup on failure) is in `lib/generate.ts`, where it can be
 * driven with an injected model; this handler owns only the HTTP part.
 */

import { NextResponse } from 'next/server';
import { generateProject } from '../../../lib/generate.ts';
import { apiError } from '../../../lib/http.ts';
import { listProjects } from '../../../lib/pipeline.ts';
import { activeJob } from '../../../render/render-jobs.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  // `renderActive` is composed here, not in `listProjects`: the lock lives in
  // render-jobs, which already imports the pipeline, and the truth about a live
  // render is the lock -- a killed worker's status.json says "running" forever.
  const job = activeJob();
  const projects = listProjects().map((project) => ({
    ...project,
    renderActive: job?.projectId === project.id,
  }));
  return NextResponse.json({ projects });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'BAD_JSON', 'Send a JSON body like {"input": "..."}.');
  }

  const result = await generateProject(body);
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({
    projectId: result.projectId,
    script: result.script,
    scenes: result.scenes,
    budget: result.budget,
    meta: result.meta,
  });
}
