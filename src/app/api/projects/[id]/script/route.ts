/**
 * PUT  /api/projects/<id>/script -- save an edited script.
 * POST /api/projects/<id>/script -- regenerate the storyboard from it.
 *
 * Both refuse while this project is rendering. The worker holds its own copy of
 * the storyboard, so it would keep drawing the old one while scenes.json moved
 * on underneath it, and out.mp4 would not describe the scenes on disk.
 */

import { NextResponse } from 'next/server';
import { regenerateStoryboard } from '../../../../../lib/generate.ts';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { readScript, writeScript } from '../../../../../lib/pipeline.ts';
import { activeJob } from '../../../../../lib/render-jobs.ts';
import { MAX_INPUT_CHARS, MAX_TITLE_CHARS } from '../../../../../lib/render-config.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Shared prologue: a known project, and no render in flight for it. */
function guard(id: string): NextResponse | null {
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }
  if (readScript(id) === null) {
    return apiError(404, 'NO_PROJECT', `There is no project ${id}.`);
  }
  const active = activeJob();
  if (active && active.projectId === id) {
    return apiError(409, 'BUSY', 'This project is rendering; cancel it before changing the script.');
  }
  return null;
}

export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const blocked = guard(id);
  if (blocked) {
    return blocked;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'BAD_JSON', 'Send a JSON body like {"title": "...", "text": "..."}.');
  }

  const candidate = body as { title?: unknown; text?: unknown } | null;
  if (typeof candidate?.text !== 'string') {
    return apiError(400, 'BAD_SCRIPT', 'The request needs a "text" string.');
  }
  const text = candidate.text.trim();
  if (text === '') {
    return apiError(400, 'EMPTY_SCRIPT', 'The script cannot be empty.');
  }
  if (text.length > MAX_INPUT_CHARS) {
    return apiError(
      400,
      'SCRIPT_TOO_LONG',
      `The script is ${text.length.toLocaleString()} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString()}.`,
    );
  }

  const rawTitle = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  // The title is not decoration: it travels to the model with the script (see
  // `requestStoryboard`), so an unbounded one would be the one input on this
  // route with no cap on what the provider is asked to read.
  if (rawTitle.length > MAX_TITLE_CHARS) {
    return apiError(
      400,
      'SCRIPT_TOO_LONG',
      `The title is ${rawTitle.length.toLocaleString()} characters; the limit is ${MAX_TITLE_CHARS}.`,
    );
  }

  const title = rawTitle !== '' ? rawTitle : (readScript(id)?.title ?? 'Untitled');

  const script = { title, text };
  writeScript(id, script);
  return NextResponse.json({ ok: true, script });
}

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const blocked = guard(id);
  if (blocked) {
    return blocked;
  }

  // The rebuild itself is in lib/generate.ts, together with its guarantee: the
  // script is untouched and scenes.json still holds the previous storyboard, so
  // a failed regeneration cannot destroy a working one.
  const result = await regenerateStoryboard(id);
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json({ scenes: result.scenes, budget: result.budget, meta: result.meta });
}
