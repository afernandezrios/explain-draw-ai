/**
 * Server-side stills: one frame of the composition, as PNG.
 *
 * The Board pane's thumbnails and artwork used to be stroke-drawn SVG; they
 * are now a real frame of the composition, rendered through the same Remotion
 * player the worker uses. The preview is the render's own output, so the two
 * cannot disagree about what a scene looks like.
 *
 * The orchestration lives here rather than in the route for the same reason
 * `generate.ts` does: a Next route module may export nothing but HTTP methods,
 * so a handler holding this machinery could not be reached by a test. Failures
 * come back as data (`ApiFailure`), so this module knows nothing of HTTP.
 *
 * Three properties are deliberate:
 *
 *   - the bundle is built once per server process and reused: it is a full
 *     webpack build, and a twelve-thumbnail strip must not pay for it twelve
 *     times;
 *   - stills render one at a time, through a module-level promise queue: twelve
 *     parallel thumbnails would open twelve pages in one Chromium, and this box
 *     may already be rendering a video;
 *   - finished PNGs are cached in a small in-memory LRU, keyed by the exact URL
 *     the page asked for -- project, scene, width, and the page's version
 *     token. Nothing is written to disk: "state is files" is about projects,
 *     and a thumbnail is transient.
 *
 * Stills do not take the render lock. The lock serializes renders; the queue
 * above is what bounds a still's memory, so a preview stays available while a
 * render runs.
 */

import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { webpackAliasOverride } from './bundle-config.ts';
import { failure, failureFrom, type ApiFailure } from './http.ts';
import { logEvent } from './logger.ts';
import { readScenes } from './pipeline.ts';
import { CANVAS_WIDTH } from './render-config.ts';
import type { Scene } from './schema.ts';

/** The composition and its entry point, pinned exactly as the worker pins them. */
const COMPOSITION_ID = 'Scene';

/**
 * How many finished PNGs the LRU keeps. A strip of twelve thumbnails plus the
 * full-size artwork fits with room for the previous storyboard's entries to
 * age out.
 */
const CACHE_LIMIT = 24;

/* ──────────────────────────── the queue ─────────────────────────── */

let renderQueue: Promise<void> = Promise.resolve();

/**
 * Runs one still job after every still job already queued.
 *
 * The tail never rejects: a failed job must not break the chain for the next
 * one. The caller still receives the job's own result, rejection included.
 */
function enqueueStill<T>(job: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(job);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/* ───────────────────────────── the LRU ──────────────────────────── */

const cache = new Map<string, Buffer>();

/** A hit moves the entry to the tail, so the head is always the coldest. */
function cacheGet(key: string): Buffer | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, png: Buffer): void {
  cache.set(key, png);
  while (cache.size > CACHE_LIMIT) {
    const coldest = cache.keys().next().value;
    if (coldest === undefined) {
      break;
    }
    cache.delete(coldest);
  }
}

/* ──────────────────────────── the bundle ────────────────────────── */

let serveUrlPromise: Promise<string> | null = null;

/**
 * The bundle, built at most once per server process.
 *
 * Both slow firsts live here: the webpack build and the browser download
 * (`ensureBrowser`). They are the price of the first preview after a server
 * start -- the same class of first-use cost as the worker's own bundle.
 *
 * The memo is cleared on failure, so the next request retries a build that
 * died for a transient reason (no network for the font fetch, a killed
 * download) instead of failing every thumbnail for the process's life.
 *
 * No `publicDir`: a still never names a static file -- the composition's
 * `narrationPath` is null -- so the bundle's default empty `public/` is
 * copied and nothing more.
 */
function loadServeUrl(): Promise<string> {
  if (serveUrlPromise === null) {
    serveUrlPromise = (async () => {
      await ensureBrowser({ logLevel: 'error' });
      return bundle({
        entryPoint: path.join(process.cwd(), 'src', 'remotion', 'index.ts'),
        webpackOverride: webpackAliasOverride(process.cwd()),
      });
    })();
    serveUrlPromise.catch(() => {
      serveUrlPromise = null;
    });
  }
  return serveUrlPromise;
}

/* ──────────────────────────── the render ────────────────────────── */

async function renderOne(options: {
  scene: Scene;
  sceneIndex: number;
  totalScenes: number;
  width: number;
}): Promise<Buffer> {
  const { scene, sceneIndex, totalScenes, width } = options;
  const serveUrl = await loadServeUrl();

  // One inputProps object reaches both calls, exactly as in the worker: the
  // duration the composition is selected with and the one it is rendered at
  // can never disagree. No narration: a still is silent by construction.
  const inputProps = { scene, sceneIndex, totalScenes, narrationPath: null };

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    logLevel: 'error',
  });

  const still = await renderStill({
    serveUrl,
    composition,
    inputProps,
    // The last frame: every block holds to the end of its clip, so the final
    // frame is the fully-revealed drawing the thumbnail should show.
    frame: composition.durationInFrames - 1,
    imageFormat: 'png',
    // The canvas is `CANVAS_WIDTH` wide; the caller asks in pixels and this is
    // the one conversion. renderStill's scale, not a width option, is how the
    // output is resized.
    scale: width / CANVAS_WIDTH,
    logLevel: 'error',
  });

  if (still.buffer === null) {
    throw new Error('renderStill returned no image buffer');
  }
  return still.buffer;
}

/* ────────────────────────── the entry point ─────────────────────── */

export type StillResult = { ok: true; png: Buffer } | ApiFailure;

/**
 * Renders one scene of a project's storyboard as a PNG.
 *
 * The read is validated on every call, through the same `readScenes` the page
 * and the worker use, so a hand-edited `scenes.json` cannot slip a still past
 * the schema. `version` is the page's own cache-busting token: it takes part
 * in the cache key, because an image rendered for one storyboard must never
 * answer for the next one.
 */
export async function renderSceneStill(options: {
  projectId: string;
  sceneIndex: number;
  width: number;
  /** The page's version token (`?v=`), or null when the URL carried none. */
  version: string | null;
}): Promise<StillResult> {
  const { projectId, sceneIndex, width, version } = options;

  const read = readScenes(projectId);
  if (!read.ok) {
    return failure(
      422,
      'INVALID_SCENES',
      'scenes.json does not match the scene format.',
      read.errors,
    );
  }

  const scene = read.scenes[sceneIndex];
  if (scene === undefined) {
    return failure(
      404,
      'NO_SCENE',
      `Scene ${sceneIndex} does not exist; this storyboard has ${read.scenes.length}.`,
    );
  }

  const key = `${projectId}:${sceneIndex}:${width}:${version ?? ''}`;
  const cached = cacheGet(key);
  if (cached !== undefined) {
    return { ok: true, png: cached };
  }

  const started = Date.now();
  logEvent('info', { event: 'still.start', projectId, sceneIndex, width, version });

  try {
    const png = await enqueueStill(() =>
      renderOne({ scene, sceneIndex, totalScenes: read.scenes.length, width }),
    );
    cacheSet(key, png);
    logEvent('info', {
      event: 'still.done',
      projectId,
      sceneIndex,
      width,
      stillMs: Date.now() - started,
      bytes: png.length,
    });
    return { ok: true, png };
  } catch (error) {
    const result = failureFrom(error);
    logEvent('error', {
      event: 'still.failed',
      projectId,
      sceneIndex,
      width,
      code: result.body.code,
      error: result.body.error,
    });
    return result;
  }
}
