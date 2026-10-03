/**
 * The API surface, called directly: generate, read, script, status, cancel.
 *
 * The model is the only fake. Projects, files and the render lock are real, and
 * the failures asserted here are the ones a person hits: an empty paste, a
 * missing key, a model that returns a storyboard the DSL rejects, and a render
 * that is running while the script is being edited.
 *
 * `POST /api/projects` is exercised twice over. Through the handler, for the
 * HTTP mapping; and through `generateProject` with an injected `FakeLlm`, for
 * the part a handler cannot reach on its own -- the two model calls, and the
 * folder cleanup when the second one fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { POST as createProjectRoute } from '../../src/app/api/projects/route.ts';
import { GET as getProject } from '../../src/app/api/projects/[id]/route.ts';
import { PUT as putScript, POST as rebuildStoryboard } from '../../src/app/api/projects/[id]/script/route.ts';
import { GET as getStatus } from '../../src/app/api/projects/[id]/status/route.ts';
import { POST as cancelRender } from '../../src/app/api/projects/[id]/cancel/route.ts';
import { fakeScenes } from '../../src/lib/fixtures.ts';
import { generateProject, regenerateStoryboard } from '../../src/lib/generate.ts';
import { FakeLlm } from '../../src/lib/llm.ts';
import { projectFiles, projectsRoot, readScenes, readScript } from '../../src/lib/pipeline.ts';
import { LOCK_FILENAME, MAX_INPUT_CHARS } from '../../src/render/render-config.ts';
import {
  IMPOSSIBLE_PID,
  makeProject,
  readLockFile,
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

/* ────────────────────────────── plumbing ────────────────────────── */

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** Runs `body` with no API key set, as a fresh clone of the repo would. */
async function withoutApiKey<T>(body: () => Promise<T>): Promise<T> {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await body();
  } finally {
    if (saved !== undefined) {
      process.env.OPENAI_API_KEY = saved;
    }
  }
}

/* ─────────────────────── POST /api/projects ─────────────────────── */

describe('POST /api/projects', () => {
  it('creates the project folder, the script and the storyboard', async () => {
    const llm = new FakeLlm();
    const pasted = 'Explain how a cache works, for a new engineer';

    const result = await generateProject({ input: pasted }, llm);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(llm.calls.script).toEqual([pasted]);
    expect(result.scenes).toHaveLength(3);
    // The verdict travels with the response; the 30s fixture is deliberately
    // out of the 270-330s window and the UI shows exactly this.
    expect(result.budget.ok).toBe(false);
    expect(result.budget.label).toContain('4:30');

    const files = projectFiles(result.projectId);
    expect(fs.readFileSync(files.input, 'utf8')).toBe(pasted);
    expect(readScript(result.projectId)).toEqual(result.script);
    const stored = readScenes(result.projectId);
    expect(stored.ok && stored.scenes).toEqual(result.scenes);
  });

  it('EMPTY_INPUT: refuses a whitespace paste without creating a folder', async () => {
    const before = fs.readdirSync(root);
    const llm = new FakeLlm();

    const result = await generateProject({ input: '   \n\t ' }, llm);
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: 'EMPTY_INPUT' } });
    expect(llm.calls.script).toEqual([]);
    expect(fs.readdirSync(root)).toEqual(before);
  });

  it('INVALID_LLM_JSON: deletes the folder it made and leaves the others alone', async () => {
    // A second project exists first, so the cleanup is proven to be surgical
    // rather than "the root was empty anyway".
    const existing = makeProject(fakeScenes(), { input: 'existing project' });
    const before = fs.readdirSync(root).sort();
    const existingSceneBytes = fs.readFileSync(projectFiles(existing.id).scenes);

    const malformed = [
      {
        title: 'Too short',
        durationSeconds: 2,
        shapes: [{ kind: 'circle', x: 10, y: 10, r: 10, color: null }],
      },
    ];
    const result = await generateProject({ input: 'will fail at the storyboard' }, new FakeLlm({ scenes: malformed }));

    expect(result).toMatchObject({ ok: false, status: 422, body: { code: 'INVALID_LLM_JSON' } });
    if (result.ok) {
      return;
    }
    expect(result.body.details?.some((detail) => detail.includes('durationSeconds'))).toBe(true);

    // Exactly the pre-existing folders, byte for byte.
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(fs.readFileSync(projectFiles(existing.id).scenes).equals(existingSceneBytes)).toBe(true);
  });

  it('MISSING_KEY: maps to 500 and leaves nothing behind', async () => {
    const before = fs.readdirSync(root);

    const response = await withoutApiKey(() =>
      createProjectRoute(jsonRequest('http://localhost/api/projects', 'POST', { input: 'no key configured' })),
    );

    expect(response.status).toBe(500);
    const body = await payload(response);
    expect(body.code).toBe('MISSING_KEY');
    expect(body.error).toContain('OPENAI_API_KEY');

    // The key is checked inside the first model call, which is after the input
    // check and before the folder is created -- so a fresh clone that forgot
    // .env.local leaves no empty project behind.
    expect(fs.readdirSync(root)).toEqual(before);
  });

  it('rejects a body that is not JSON, and a missing input field', async () => {
    const badJson = await createProjectRoute(
      new Request('http://localhost/api/projects', { method: 'POST', body: '{not json' }),
    );
    expect(badJson.status).toBe(400);
    expect((await payload(badJson)).code).toBe('BAD_JSON');

    for (const body of [{}, { input: 42 }, { input: null }]) {
      const response = await createProjectRoute(
        jsonRequest('http://localhost/api/projects', 'POST', body),
      );
      expect(response.status).toBe(400);
      expect((await payload(response)).code).toBe('BAD_INPUT');
    }
  });

  it('EMPTY_INPUT through the handler: no key needed, nothing written', async () => {
    const before = fs.readdirSync(root);
    const response = await createProjectRoute(
      jsonRequest('http://localhost/api/projects', 'POST', { input: '' }),
    );

    expect(response.status).toBe(400);
    expect((await payload(response)).code).toBe('EMPTY_INPUT');
    expect(fs.readdirSync(root)).toEqual(before);
  });
});

/* ───────────────────────── GET /api/projects/[id] ───────────────── */

describe('GET /api/projects/[id]', () => {
  it('returns everything the page needs, including the pasted text', async () => {
    const project = makeProject(fakeScenes(), { input: 'the input this project was made from' });

    const response = await getProject(jsonRequest('http://localhost/api/projects/x', 'GET'), ctx(project.id));
    expect(response.status).toBe(200);

    const data = await payload(response);
    expect(data.projectId).toBe(project.id);
    // Restoring the input is what makes a reloaded page usable: an empty box
    // would leave the Generate button disabled with no way back.
    expect(data.input).toBe('the input this project was made from');
    expect(data.script).toEqual({ title: 'How a Cache Works', text: expect.any(String) });
    expect(data.scenes).toHaveLength(3);
    expect(data.sceneErrors).toEqual([]);
    expect(data.renderActive).toBe(false);
    expect(data.hasVideo).toBe(false);
  });

  it('reports a storyboard that does not validate instead of pretending it is fine', async () => {
    const project = makeProject([{ title: 'Bad', durationSeconds: 999, shapes: [] }] as never, {
      input: 'broken scenes',
    });

    const data = await payload(await getProject(jsonRequest('http://localhost/api/projects/x', 'GET'), ctx(project.id)));
    expect(data.scenes).toEqual([]);
    expect(data.budget).toBeNull();
    expect(data.sceneErrors).toBeInstanceOf(Array);
  });

  it('404s an unknown project and 400s an id that could escape the root', async () => {
    const missing = await getProject(
      jsonRequest('http://localhost/api/projects/x', 'GET'),
      ctx('no-such-project-here'),
    );
    expect(missing.status).toBe(404);
    expect((await payload(missing)).code).toBe('NO_PROJECT');

    const escaping = await getProject(jsonRequest('http://localhost/api/projects/x', 'GET'), ctx('../etc'));
    expect(escaping.status).toBe(400);
    expect((await payload(escaping)).code).toBe('BAD_PROJECT_ID');
  });
});

/* ──────────────────── PUT/POST /api/projects/[id]/script ────────── */

describe('PUT /api/projects/[id]/script', () => {
  it('saves an edited script and keeps the previous title when none is given', async () => {
    const project = makeProject(fakeScenes(), { input: 'editable' });

    const saved = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: 'Tighter words.' }),
      ctx(project.id),
    );
    expect(saved.status).toBe(200);
    expect(readScript(project.id)).toEqual({ title: 'How a Cache Works', text: 'Tighter words.' });

    const retitled = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { title: 'New title', text: 'Body.' }),
      ctx(project.id),
    );
    expect(retitled.status).toBe(200);
    expect(readScript(project.id)).toEqual({ title: 'New title', text: 'Body.' });
  });

  it('refuses an empty or oversized script, and a body that is not a script', async () => {
    const project = makeProject(fakeScenes(), { input: 'script limits' });

    const empty = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: '   ' }),
      ctx(project.id),
    );
    expect(empty.status).toBe(400);
    expect((await payload(empty)).code).toBe('EMPTY_SCRIPT');

    const huge = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: 'x'.repeat(MAX_INPUT_CHARS + 1) }),
      ctx(project.id),
    );
    expect(huge.status).toBe(400);
    expect((await payload(huge)).code).toBe('SCRIPT_TOO_LONG');

    const notJson = await putScript(
      new Request('http://localhost/api/projects/x/script', { method: 'PUT', body: '{oops' }),
      ctx(project.id),
    );
    expect(notJson.status).toBe(400);
    expect((await payload(notJson)).code).toBe('BAD_JSON');

    // Nothing was written by any of the three.
    expect(readScript(project.id)).toEqual({ title: 'How a Cache Works', text: expect.any(String) });
  });

  it('409s while this project is rendering, and only for a live lock', async () => {
    const project = makeProject(fakeScenes(), { input: 'busy script' });

    // A dead pid is not a render: the lock is reclaimed, and the save goes
    // through. This is what a killed worker leaves behind.
    writeLock(project.id, IMPOSSIBLE_PID);
    const stale = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: 'while stale' }),
      ctx(project.id),
    );
    expect(stale.status).toBe(200);
    expect(readLockFile()).toBeNull();

    // A live lock is. `process.pid` is enough: the guard reads the lock and
    // never signals anything.
    writeLock(project.id, process.pid);
    const busy = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: 'while rendering' }),
      ctx(project.id),
    );
    expect(busy.status).toBe(409);
    expect((await payload(busy)).code).toBe('BUSY');
    expect(readScript(project.id)?.text).toBe('while stale');
  });

  it('404s a project that does not exist', async () => {
    const response = await putScript(
      jsonRequest('http://localhost/api/projects/x/script', 'PUT', { text: 'nowhere' }),
      ctx('no-such-project-here'),
    );
    expect(response.status).toBe(404);
    expect((await payload(response)).code).toBe('NO_PROJECT');
  });
});

describe('POST /api/projects/[id]/script', () => {
  it('rebuilds the storyboard from the saved script', async () => {
    const project = makeProject(fakeScenes(), { input: 'rebuild' });

    const rebuilt = fakeScenes().map((scene) => ({ ...scene, title: `Rebuilt ${scene.title}` }));
    const result = await regenerateStoryboard(project.id, new FakeLlm({ scenes: rebuilt }));

    expect(result.ok).toBe(true);
    const stored = readScenes(project.id);
    expect(stored.ok && stored.scenes[0].title).toBe('Rebuilt How a Cache Works');
  });

  it('409s under a live lock, before the model is ever called', async () => {
    const project = makeProject(fakeScenes(), { input: 'busy rebuild' });
    writeLock(project.id, process.pid);

    // No API key is set, so a call that got through would fail differently:
    // 409 here proves the guard ran first.
    const response = await withoutApiKey(() =>
      rebuildStoryboard(jsonRequest('http://localhost/api/projects/x/script', 'POST'), ctx(project.id)),
    );
    expect(response.status).toBe(409);
    expect((await payload(response)).code).toBe('BUSY');
  });

  it('a failed rebuild leaves the previous storyboard exactly as it was', async () => {
    const project = makeProject(fakeScenes(), { input: 'failed rebuild' });
    const before = fs.readFileSync(projectFiles(project.id).scenes, 'utf8');

    const failed = await regenerateStoryboard(
      project.id,
      new FakeLlm({ scenesError: new Error('the model hung up') }),
    );
    expect(failed).toMatchObject({ ok: false, status: 502, body: { code: 'LLM_REQUEST_FAILED' } });
    expect(fs.readFileSync(projectFiles(project.id).scenes, 'utf8')).toBe(before);

    // Through the handler too: no key, so the request fails inside the model
    // call and the storyboard on disk must be untouched.
    const response = await withoutApiKey(() =>
      rebuildStoryboard(jsonRequest('http://localhost/api/projects/x/script', 'POST'), ctx(project.id)),
    );
    expect(response.status).toBe(500);
    expect((await payload(response)).code).toBe('MISSING_KEY');
    expect(fs.readFileSync(projectFiles(project.id).scenes, 'utf8')).toBe(before);
  });

  it('404s a project that does not exist', async () => {
    const response = await rebuildStoryboard(
      jsonRequest('http://localhost/api/projects/x/script', 'POST'),
      ctx('no-such-project-here'),
    );
    expect(response.status).toBe(404);
    expect((await payload(response)).code).toBe('NO_PROJECT');
  });
});

/* ─────────────────── GET /status and POST /cancel ───────────────── */

describe('GET /api/projects/[id]/status', () => {
  it('reports no job, no video and the budget verdict for a fresh project', async () => {
    const project = makeProject(fakeScenes(), { input: 'status' });

    const data = await payload(
      await getStatus(jsonRequest('http://localhost/api/projects/x/status', 'GET'), ctx(project.id)),
    );
    expect(data.status).toBeNull();
    expect(data.renderActive).toBe(false);
    expect(data.hasVideo).toBe(false);
    expect(data.budget).toMatchObject({ ok: false });
  });

  it('takes renderActive from the lock, not from status.json', async () => {
    const project = makeProject(fakeScenes(), { input: 'status busy' });
    // A killed worker's story: the lock is live, status.json was never written.
    writeLock(project.id, process.pid);

    const data = await payload(
      await getStatus(jsonRequest('http://localhost/api/projects/x/status', 'GET'), ctx(project.id)),
    );
    expect(data.renderActive).toBe(true);
    expect(data.status).toBeNull();
  });
});

describe('POST /api/projects/[id]/cancel', () => {
  it('answers false when nothing is running, and does not error', async () => {
    const project = makeProject(fakeScenes(), { input: 'cancel nothing' });

    const idle = await payload(
      await cancelRender(jsonRequest('http://localhost/api/projects/x/cancel', 'POST'), ctx(project.id)),
    );
    expect(idle.cancelled).toBe(false);

    // A stale lock is not a job either: reclaiming it is what the next render
    // does, and cancelling must not claim otherwise.
    writeLock(project.id, IMPOSSIBLE_PID);
    const stale = await payload(
      await cancelRender(jsonRequest('http://localhost/api/projects/x/cancel', 'POST'), ctx(project.id)),
    );
    expect(stale.cancelled).toBe(false);
  });

  it('does not cancel a job belonging to another project', async () => {
    const busy = makeProject(fakeScenes(), { input: 'busy' });
    const other = makeProject(fakeScenes(), { input: 'other' });
    writeLock(busy.id, process.pid);

    const data = await payload(
      await cancelRender(jsonRequest('http://localhost/api/projects/x/cancel', 'POST'), ctx(other.id)),
    );
    expect(data.cancelled).toBe(false);
    // The lock is still there: no signal was sent, and nothing was released.
    expect(readLockFile()?.projectId).toBe(busy.id);
  });
});

/* ─────────────────── project folders stay self-contained ────────── */

describe('a project folder', () => {
  it('holds everything about the project and nothing about the render lock', () => {
    const project = makeProject(fakeScenes(), { input: 'paths' });
    const entries = fs.readdirSync(project.dir).sort();
    expect(entries).toEqual(['clips', 'input.txt', 'scenes.json', 'script.json']);

    // The lock lives beside the folders, not inside one: a project folder can
    // be copied, archived or deleted on its own, and `removeProject` deleting
    // it can never take the lock (or another project) with it.
    expect(fs.existsSync(path.join(project.dir, LOCK_FILENAME))).toBe(false);
    expect(path.dirname(project.dir)).toBe(projectsRoot());
  });
});
