/**
 * POST /api/projects/<id>/cancel -- stop this project's render.
 *
 * Signalling the worker is all this does; the worker turns the signal into a
 * `cancelled` status and exit code 130, and the route that spawned it releases
 * the lock and records the outcome if the worker never got that far.
 */

import { NextResponse } from 'next/server';
import { requireProjectId } from '../../../../../lib/http.ts';
import { cancelJob } from '../../../../../lib/render-jobs.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  // False simply means the job finished (or was never running) before the
  // signal landed; that is not an error the UI needs to shout about.
  return NextResponse.json({ cancelled: cancelJob(id) });
}
