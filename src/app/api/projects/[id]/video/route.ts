/**
 * GET /api/projects/<id>/video -- serves out.mp4, range requests included.
 *
 * Browsers ask for byte ranges when you scrub a video (and Safari opens with a
 * range request before it will play anything), so a plain whole-file response
 * makes the player look broken. RFC 9110: a Range header that does not parse is
 * ignored and the whole file is served with 200; a range that parses but cannot
 * be satisfied gets 416 with the total size.
 *
 * The stat and the read come from one open handle. Statting by path and then
 * opening by path would let a re-render swap the file in between, and the
 * Content-Length we advertised would no longer describe the bytes we send.
 */

import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { apiError, requireProjectId } from '../../../../../lib/http.ts';
import { projectFiles } from '../../../../../lib/pipeline.ts';
import { parseRange } from '../../../../../lib/range.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const invalid = requireProjectId(id);
  if (invalid) {
    return invalid;
  }

  // One route for both files: the storyboard's scene render and the joined
  // video need exactly the same range handling.
  const files = projectFiles(id);
  const kind = new URL(request.url).searchParams.get('kind');
  const previewing = kind === 'preview';
  const file = previewing ? files.preview : files.out;

  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file, 'r');
  } catch {
    return apiError(
      404,
      previewing ? 'NO_PREVIEW' : 'NO_VIDEO',
      previewing
        ? 'This project has no scene preview yet.'
        : 'This project has no finished video yet.',
    );
  }

  try {
    const { size } = await handle.stat();
    if (size === 0) {
      // An empty file is a render that died mid-write, not a playable video.
      await handle.close();
      return apiError(404, previewing ? 'NO_PREVIEW' : 'NO_VIDEO', 'The file is empty.');
    }

    const header = request.headers.get('range');
    const range = header === null ? null : parseRange(header, size);

    if (range === 'unsatisfiable') {
      await handle.close();
      return new Response(null, {
        status: 416,
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` },
      });
    }

    const stream = range
      ? handle.createReadStream({ start: range.start, end: range.end, autoClose: true })
      : handle.createReadStream({ autoClose: true });

    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    return apiError(
      500,
      'VIDEO_READ_FAILED',
      error instanceof Error ? error.message : 'Could not read the video file.',
    );
  }
}
