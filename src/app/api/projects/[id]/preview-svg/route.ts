/**
 * GET /api/projects/<id>/preview-svg?scene=n -- the finished drawing of one scene.
 *
 * This is the whiteboard preview and the storyboard strip. It goes through the
 * same `fullSceneSvg` the composition uses, so what you see here is what gets
 * rendered, and the handwriting face travels inside the SVG so the preview does
 * not depend on the page having loaded the font.
 */

import fs from 'node:fs';
import path from 'node:path';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { FONT_FILE } from '../../../../../lib/board.ts';
import { readScenes } from '../../../../../lib/pipeline.ts';
import { fullSceneSvg } from '../../../../../lib/svg.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

let fontCache: string | null | undefined;

/** The bundled woff2, base64, read at most once per server process. */
function fontDataUri(): string | null {
  if (fontCache !== undefined) {
    return fontCache;
  }
  try {
    fontCache = fs
      .readFileSync(path.join(process.cwd(), 'public', 'fonts', FONT_FILE))
      .toString('base64');
  } catch {
    // The asset is part of the repo, so this only happens if it was deleted.
    // The preview still draws, in whatever cursive face the browser has.
    console.warn(`[preview] public/fonts/${FONT_FILE} is missing; previews will not use the render font.`);
    fontCache = null;
  }
  return fontCache;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  const requested = new URL(request.url).searchParams.get('scene');
  if (requested !== null && !/^\d+$/.test(requested)) {
    return apiError(400, 'BAD_SCENE', `"scene" must be a non-negative integer, got "${requested}".`);
  }
  const sceneIndex = requested === null ? 0 : Number.parseInt(requested, 10);

  const scenes = readScenes(id);
  if (!scenes.ok) {
    return apiError(
      422,
      'INVALID_SCENES',
      'scenes.json does not match the scene format.',
      scenes.errors,
    );
  }

  const scene = scenes.scenes[sceneIndex];
  if (scene === undefined) {
    return apiError(
      404,
      'NO_SCENE',
      `Scene ${sceneIndex} does not exist; this storyboard has ${scenes.scenes.length}.`,
    );
  }

  return new Response(fullSceneSvg(scene, { fontDataUri: fontDataUri() }), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // scenes.json can be regenerated, so a cached preview would go stale.
      'Cache-Control': 'no-store',
    },
  });
}
