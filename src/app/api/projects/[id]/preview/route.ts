/**
 * GET /api/projects/<id>/preview?scene=n[&w=pixels][&v=token] -- one frame of
 * the composition, as PNG.
 *
 * This is the Board pane's thumbnail strip and artwork: the same composition
 * the worker renders, drawn by the same blocks, so the preview cannot disagree
 * with the video about what a scene looks like. The first request in a server
 * process pays for the webpack bundle and the browser download; the renders
 * themselves are serialized and cached in `lib/still.ts`.
 *
 * `v` is the page's version token. When it is present the URL is treated as
 * content-addressed and may be cached for a year -- the page bumps the token
 * whenever the storyboard changes. Without it the response is not cacheable by
 * the browser at all.
 */

import { NextResponse } from 'next/server';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { renderSceneStill } from '../../../../../lib/still.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The still's size bounds in pixels, and the default (the full canvas). */
const MIN_STILL_WIDTH = 160;
const MAX_STILL_WIDTH = 1920;
const DEFAULT_STILL_WIDTH = 1920;

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  const query = new URL(request.url).searchParams;

  // Absent means scene 0, exactly as the SVG route behaved; anything that is
  // not a plain non-negative integer is refused rather than guessed at.
  const requestedScene = query.get('scene');
  if (requestedScene !== null && !/^\d+$/.test(requestedScene)) {
    return apiError(400, 'BAD_SCENE', `"scene" must be a non-negative integer, got "${requestedScene}".`);
  }
  const sceneIndex = requestedScene === null ? 0 : Number.parseInt(requestedScene, 10);

  const requestedWidth = query.get('w');
  if (requestedWidth !== null && !/^\d+$/.test(requestedWidth)) {
    return apiError(400, 'BAD_WIDTH', `"w" must be a whole number of pixels, got "${requestedWidth}".`);
  }
  const width =
    requestedWidth === null
      ? DEFAULT_STILL_WIDTH
      : Math.min(MAX_STILL_WIDTH, Math.max(MIN_STILL_WIDTH, Number.parseInt(requestedWidth, 10)));

  const version = query.get('v');

  const result = await renderSceneStill({ projectId: id, sceneIndex, width, version });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  // A fresh Uint8Array, not the Buffer itself: the Response constructor's
  // BodyInit does not accept node Buffers under these types, and one still's
  // worth of pixels is cheap to copy once per cache miss.
  return new Response(new Uint8Array(result.png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Content-addressed only when the page said so: with a token the URL
      // changes whenever the storyboard does, so a year is safe; without one,
      // a cached image could go stale behind the page's back.
      'Cache-Control':
        version === null || version === '' ? 'no-store' : 'public, max-age=31536000, immutable',
    },
  });
}
