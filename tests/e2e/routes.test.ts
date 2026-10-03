/**
 * The route layer, called directly.
 *
 * These are the decisions that live in the handlers and nowhere else: which
 * renders the budget window refuses, what a malformed scene index does, and how
 * video bytes are served. Route handlers are plain functions of (Request, ctx),
 * so they are called as such.
 *
 * A live lock is written by hand in some cases. That is real state read by the
 * real code, and it is what keeps a test from spawning an actual browser
 * render when the request is accepted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { POST as startRender } from '../../src/app/api/projects/[id]/render/route.ts';
import { GET as video } from '../../src/app/api/projects/[id]/video/route.ts';
import { fakeScenes } from '../../src/lib/fixtures.ts';
import { projectFiles, projectsRoot, readStatus } from '../../src/lib/pipeline.ts';
import { LOCK_FILENAME } from '../../src/lib/render-config.ts';
import {
  fullStoryboard,
  makeProject,
  releaseLock,
  useTempProjectsRoot,
  writeLock,
} from './helpers.ts';

let root = '';

beforeAll(() => {
  root = useTempProjectsRoot();
});

afterEach(() => {
  releaseLock();
});

afterAll(() => {
  releaseLock();
  fs.rmSync(root, { recursive: true, force: true });
});

/** The 39x7s window-passing storyboard, stretched past the maximum. */
function overBudgetScenes() {
  return fullStoryboard(39).map((scene) => ({ ...scene, durationSeconds: 10 }));
}

function renderRequest(body?: unknown): Request {
  return new Request('http://localhost/api/projects/x/render', {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /render', () => {
  it('refuses a full render outside the window with the computed total', async () => {
    const project = makeProject(overBudgetScenes(), { input: 'over budget' });

    const response = await startRender(renderRequest(), ctx(project.id));
    expect(response.status).toBe(409);

    const payload = await body(response);
    expect(payload.code).toBe('BUDGET');
    expect(payload.error).toContain('6:30');
  });

  it('does not apply the window to a single-scene preview', async () => {
    const project = makeProject(overBudgetScenes(), { input: 'preview exemption' });

    // A live lock, so an accepted request stops at BUSY rather than rendering.
    writeLock(project.id, process.pid);

    const response = await startRender(renderRequest({ sceneIndex: 0 }), ctx(project.id));
    const payload = await body(response);

    // BUSY is the proof: the request reached the lock, so the budget gate that
    // refused the full render above did not refuse this one.
    expect(payload.code).toBe('BUSY');
    expect(response.status).toBe(409);
  });

  it('lets an in-window full render through the budget gate', async () => {
    const project = makeProject(fullStoryboard(39), { input: 'in window' });
    writeLock(project.id, process.pid);

    const response = await startRender(renderRequest(), ctx(project.id));
    expect((await body(response)).code).toBe('BUSY');
  });

  it('rejects a present-but-malformed sceneIndex instead of rendering everything', async () => {
    const project = makeProject(fakeScenes(), { input: 'bad scene index' });

    for (const bad of [1.5, '2', -1, true, [0]]) {
      const response = await startRender(renderRequest({ sceneIndex: bad }), ctx(project.id));
      expect(response.status).toBe(400);
      expect((await body(response)).code).toBe('BAD_SCENE_INDEX');
    }

    // No scene was rendered, and nothing was written.
    expect(fs.readdirSync(path.join(project.dir, 'clips'))).toEqual([]);
  });

  it('rejects a body that is not JSON', async () => {
    const project = makeProject(fakeScenes(), { input: 'bad json' });
    const request = new Request('http://localhost/api/projects/x/render', {
      method: 'POST',
      body: '{not json',
    });

    const response = await startRender(request, ctx(project.id));
    expect(response.status).toBe(400);
    expect((await body(response)).code).toBe('BAD_JSON');
  });

  it('rejects JSON that is not an object instead of rendering everything', async () => {
    const project = makeProject(fullStoryboard(39), { input: 'scalar body' });
    writeLock(project.id, process.pid);

    // Every one of these parses as JSON and carries no sceneIndex. Read as
    // "render everything" they would start a 273s full render from a caller's
    // typo; they must be refused, and refused before the lock is consulted.
    for (const raw of ['7', '"all"', 'true', 'null', '[0]', '[]']) {
      const request = new Request('http://localhost/api/projects/x/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      });

      const response = await startRender(request, ctx(project.id));
      expect(response.status).toBe(400);
      expect((await body(response)).code).toBe('BAD_JSON');
    }

    // And the normal no-body request still means "render everything".
    const empty = await startRender(renderRequest(), ctx(project.id));
    expect((await body(empty)).code).toBe('BUSY');
  });

  it('stands down when the lock is taken in the race window', async () => {
    const project = makeProject(fullStoryboard(39), { input: 'lost the race' });

    // Something is in the way of the exclusive create that is not a lock the
    // read can parse: this is the race window between the read and the `wx`
    // write, made deterministic. The route must stand down rather than render
    // unguarded, and must stop the worker it already spawned.
    const lock = path.join(projectsRoot(), LOCK_FILENAME);
    fs.mkdirSync(lock, { recursive: true });
    try {
      const response = await startRender(renderRequest(), ctx(project.id));
      expect(response.status).toBe(409);
      expect((await body(response)).code).toBe('BUSY');

      // No phantom job: the loser never claims the status file.
      expect(readStatus(project.id)).toBeNull();
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  });

  it('refuses a storyboard that does not match the format', async () => {
    const project = makeProject(
      [{ title: 'Bad', durationSeconds: 999, shapes: [] }] as never,
      { input: 'bad scenes' },
    );

    const response = await startRender(renderRequest(), ctx(project.id));
    expect(response.status).toBe(422);
    const payload = await body(response);
    expect(payload.code).toBe('INVALID_SCENES');
    expect(payload.details).toBeInstanceOf(Array);
  });

  it('rejects an id that could escape the projects directory', async () => {
    const response = await startRender(renderRequest(), ctx('../etc'));
    expect(response.status).toBe(400);
    expect((await body(response)).code).toBe('BAD_PROJECT_ID');
  });
});

describe('GET /video', () => {
  /** Stands in for a rendered file: the route serves bytes, not video. */
  function putBytes(file: string, bytes: number, fill: number): void {
    fs.writeFileSync(file, Buffer.alloc(bytes, fill));
  }

  it('serves the whole file when no range is asked for', async () => {
    const project = makeProject(fakeScenes(), { input: 'video' });
    putBytes(projectFiles(project.id).out, 1000, 7);

    const response = await video(new Request('http://localhost/v'), ctx(project.id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it('answers a range with 206 and the bytes it promised', async () => {
    const project = makeProject(fakeScenes(), { input: 'ranged' });
    putBytes(projectFiles(project.id).out, 1000, 7);

    const response = await video(
      new Request('http://localhost/v', { headers: { range: 'bytes=0-99' } }),
      ctx(project.id),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(response.headers.get('content-length')).toBe('100');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(100);
    expect(bytes[0]).toBe(7);
  });

  it('understands open-ended and suffix ranges', async () => {
    const project = makeProject(fakeScenes(), { input: 'ranges' });
    putBytes(projectFiles(project.id).out, 1000, 7);

    const open = await video(
      new Request('http://localhost/v', { headers: { range: 'bytes=900-' } }),
      ctx(project.id),
    );
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe('bytes 900-999/1000');

    const suffix = await video(
      new Request('http://localhost/v', { headers: { range: 'bytes=-100' } }),
      ctx(project.id),
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 900-999/1000');

    const clamped = await video(
      new Request('http://localhost/v', { headers: { range: 'bytes=950-5000' } }),
      ctx(project.id),
    );
    expect(clamped.status).toBe(206);
    expect(clamped.headers.get('content-range')).toBe('bytes 950-999/1000');
  });

  it('answers 416 for a range that cannot be satisfied', async () => {
    const project = makeProject(fakeScenes(), { input: 'unsatisfiable' });
    putBytes(projectFiles(project.id).out, 1000, 7);

    const response = await video(
      new Request('http://localhost/v', { headers: { range: 'bytes=5000-' } }),
      ctx(project.id),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */1000');
  });

  it('ignores a range it cannot parse, as RFC 9110 requires', async () => {
    const project = makeProject(fakeScenes(), { input: 'bad range' });
    putBytes(projectFiles(project.id).out, 1000, 7);

    for (const range of ['bytes=abc', 'bytes=0-1,5-6', 'items=0-5', 'bytes=--5']) {
      const response = await video(
        new Request('http://localhost/v', { headers: { range } }),
        ctx(project.id),
      );
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBe(1000);
    }
  });

  it('serves the scene preview from the same route', async () => {
    const project = makeProject(fakeScenes(), { input: 'preview video' });
    putBytes(projectFiles(project.id).preview, 500, 9);

    const response = await video(
      new Request('http://localhost/v?kind=preview'),
      ctx(project.id),
    );
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(500);

    // The joined video is a different file: asking for it here must not fall
    // back to the preview.
    const missingVideo = await video(new Request('http://localhost/v'), ctx(project.id));
    expect(missingVideo.status).toBe(404);
    expect((await body(missingVideo)).code).toBe('NO_VIDEO');
  });

  it('reports a project with no video', async () => {
    const project = makeProject(fakeScenes(), { input: 'no video' });

    const response = await video(new Request('http://localhost/v'), ctx(project.id));
    expect(response.status).toBe(404);
    expect((await body(response)).code).toBe('NO_VIDEO');
  });

  it('treats a zero-byte file as no video rather than as an empty one', async () => {
    // What a render killed mid-write leaves behind. A 200 with zero bytes makes
    // the player look broken, so it is a 404 like any other missing video.
    const project = makeProject(fakeScenes(), { input: 'empty video' });
    fs.writeFileSync(projectFiles(project.id).out, Buffer.alloc(0));

    const response = await video(new Request('http://localhost/v'), ctx(project.id));
    expect(response.status).toBe(404);
    const payload = await body(response);
    expect(payload.code).toBe('NO_VIDEO');
    expect(payload.error).toContain('empty');
  });
});
