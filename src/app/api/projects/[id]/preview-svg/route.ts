/**
 * GET /api/projects/<id>/preview-svg?scene=n -- gone.
 *
 * TEMPORARY BRIDGE (Stage 1 of the RemotionUI migration): this route served the
 * stroke-drawn SVG, which died with the old drawing path. Stage 3 replaces it
 * with `/api/projects/<id>/preview`, which renders a real frame of the
 * composition. Until then the route answers 503, so the Board pane's thumbnails
 * fail quietly instead of 404ing.
 */

import { apiError } from '../../../../../lib/http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, _context: Params): Promise<Response> {
  return apiError(
    503,
    'PREVIEW_UNAVAILABLE',
    'The storyboard preview is being replaced; it returns in a later stage of the RemotionUI migration.',
  );
}
