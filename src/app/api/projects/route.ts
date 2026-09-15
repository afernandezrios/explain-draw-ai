/**
 * POST /api/projects -- paste text in, get a project back.
 *
 * A thin delegate: the pipeline itself (the two model calls, the folder, the
 * cleanup on failure) is in `lib/generate.ts`, where it can be driven with an
 * injected model. This handler owns only the HTTP part -- reading the body.
 */

import { NextResponse } from 'next/server';
import { generateProject } from '../../../lib/generate.ts';
import { apiError } from '../../../lib/http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
