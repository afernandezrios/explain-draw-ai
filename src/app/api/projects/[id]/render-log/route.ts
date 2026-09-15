/**
 * GET /api/projects/<id>/render-log -- the worker's most recent output.
 *
 * `render.log` is written by the server while the worker runs (see
 * `scenesToVideo` in lib/pipeline.ts), so it survives a server restart and a
 * render failure is readable without opening a terminal. Only the tail is
 * served: a full render prints a lot, and the failure UI wants the end of it.
 */

import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { pathExists } from '../../../../../lib/atomic.ts';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { projectFiles } from '../../../../../lib/pipeline.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The most the failure UI needs to show; the file itself is not capped. */
const MAX_LOG_LINES = 100;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  const logPath = projectFiles(id).renderLog;
  if (!pathExists(logPath)) {
    return apiError(404, 'NO_RENDER_LOG', `No render log for project ${id}. Run a render first.`);
  }

  let lines: string[];
  try {
    lines = fs
      .readFileSync(logPath, 'utf8')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '')
      .slice(-MAX_LOG_LINES);
  } catch {
    return apiError(500, 'LOG_READ_FAILED', `Could not read the render log for project ${id}.`);
  }

  return NextResponse.json({ lines });
}
