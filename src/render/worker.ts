#!/usr/bin/env node
/**
 * The render worker.
 *
 * A separate process on purpose. Bundling and encoding inside a route handler
 * would block the whole server and leave nothing to cancel, so the API route
 * spawns this and the UI polls the status file it writes. Running it by hand
 * from the command line goes through exactly the same code.
 *
 * It is also the last line of defence for the three things a render must always
 * honour, whichever way it was started:
 *
 *   - the storyboard is re-validated against the DSL, and a render whose total
 *     falls outside the accepted window is refused, using the same schema and
 *     the same constants as the app;
 *   - the render lock is claimed before any work starts, so a CLI render cannot
 *     run alongside an app render (two Chromium renders on a 7.6 GiB laptop, and
 *     no way to cancel the one the UI cannot see);
 *   - every finished file is rendered to a temp name and renamed into place, so
 *     a cancelled or failed render never leaves a half-written MP4 where the
 *     player (or the next run) would find it.
 *
 * Exit codes: 0 success, 1 refusal/failure, 130 cancelled.
 *
 * Run directly with: node src/render/worker.ts --project <dir>
 * (Node runs TypeScript here via type stripping, which is why the shared schema,
 * lock and constants are imported as real .ts modules rather than duplicated.)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from '@remotion/renderer';
import { readJsonFile, writeJsonAtomic } from '../lib/atomic.ts';
import { webpackAliasOverride } from './bundle-config.ts';
import {
  AUDIO_BITRATE,
  AUDIO_CODEC,
  AUDIO_SILENCE_MAX_VOLUME_DB,
  CLIPS_DIRNAME,
  CRF,
  fittedSceneSeconds,
  FPS,
  IMAGE_FORMAT,
  JPEG_QUALITY,
  LOCK_FILENAME,
  MAX_FRAME_CONCURRENCY,
  NARRATION_DIRNAME,
  NARRATION_OVERRUN_TOLERANCE_SECONDS,
  OUTPUT_FILENAME,
  PIXEL_FORMAT,
  SCENES_FILENAME,
  STATUS_FILENAME,
  VIDEO_CODEC,
  X264_PRESET,
  narrationFileName,
  sceneClipName,
  secondsToFrames,
} from './render-config.ts';
import { claimLock, releaseLockIfOwnedBy, type RenderLock } from './render-lock.ts';
import type { RenderStatus } from './render-status.ts';
import {
  ScenesShapeSchema,
  checkBudget,
  issueDetails,
  validateScenes,
  type Scene,
} from '../scenes/schema.ts';
import { synthesize } from './tts.ts';

const WORKER_DIR = import.meta.dirname;
const PROJECT_ROOT = path.resolve(WORKER_DIR, '..', '..');
const ENTRY_POINT = path.join(PROJECT_ROOT, 'src', 'remotion', 'index.ts');

const COMPOSITION_ID = 'Scene';
const STATUS_THROTTLE_MS = 200;
const EXIT_FAILED = 1;
const EXIT_CANCELLED = 130;

/* ───────────────────────────── arguments ────────────────────────── */

class UsageError extends Error {}
class CancelledError extends Error {}

type WorkerArgs = {
  projectDir: string;
  statusPath: string;
};

const USAGE = `Usage: node src/render/worker.ts --project <dir> [options]

  --project <dir>   project folder holding scenes.json (required)
  --status <file>   where to write render status (default <dir>/${STATUS_FILENAME})
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

function parseArgs(argv: string[]): WorkerArgs {
  let projectDir: string | undefined;
  let statusPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') {
      projectDir = requireValue(argv, ++i, '--project');
    } else if (arg === '--status') {
      statusPath = requireValue(argv, ++i, '--status');
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new UsageError(`unexpected argument "${arg}"`);
    }
  }

  if (!projectDir) {
    throw new UsageError('--project <dir> is required');
  }
  return {
    projectDir: path.resolve(projectDir),
    statusPath: path.resolve(statusPath ?? path.join(projectDir, STATUS_FILENAME)),
  };
}

/* ────────────────────────────── status ──────────────────────────── */

let status: RenderStatus;
let statusPath = '';
let lastStatusWrite = 0;

function initStatus(pathToStatus: string, totalScenes: number): void {
  statusPath = pathToStatus;
  status = {
    state: 'running',
    pid: process.pid,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    sceneIndex: 0,
    totalScenes,
    renderedScenes: 0,
    progress: 0,
    message: 'Preparing the render...',
  };
  writeStatus({}, true);
}

function writeStatus(patch: Partial<RenderStatus>, force = false): void {
  const now = Date.now();
  if (!force && now - lastStatusWrite < STATUS_THROTTLE_MS) {
    return;
  }
  lastStatusWrite = now;
  Object.assign(status, patch, { updatedAt: now });
  // Unique temp name + rename, so a throttled progress write can never
  // interleave with a forced one and leave a torn file behind.
  writeJsonAtomic(statusPath, status);
}

function finish(state: RenderStatus['state'], message: string): number {
  writeStatus({ state, message, finishedAt: Date.now(), progress: state === 'done' ? 1 : status.progress }, true);
  process.stdout.write(`[render] ${state}: ${message}\n`);
  return state === 'cancelled' ? EXIT_CANCELLED : state === 'done' ? 0 : EXIT_FAILED;
}

/* ───────────────────────────── cancel ───────────────────────────── */

const { cancelSignal, cancel } = makeCancelSignal();
let cancelled = false;
/** ffmpeg during the join, so a cancel does not have to wait for the whole concat. */
let ffmpegChild: ChildProcess | null = null;

function requestCancel(): void {
  cancelled = true;
  cancel();
  // The child is killed and then awaited by its caller, so a cancel never
  // leaves a half-written join behind. Narration has no child to kill: kokoro
  // speaks in-process, so a synthesis already under way is abandoned and dies
  // with this process.
  if (ffmpegChild) {
    try {
      ffmpegChild.kill('SIGTERM');
    } catch {
      // Already gone; the exit handler still runs.
    }
  }
}

process.on('SIGTERM', requestCancel);
process.on('SIGINT', requestCancel);

/**
 * Cancel has to be honoured during the slow, browser-free start-up too, not
 * just once the first renderMedia is listening -- otherwise a first-run browser
 * download looks like a hung cancel button.
 */
function abortIfCancelled(stage: string): void {
  if (cancelled) {
    throw new CancelledError(`cancelled during ${stage}`);
  }
}

/**
 * Did renderMedia stop because we cancelled it?
 *
 * `make-cancel-signal` keeps its `isUserCancelledRender` helper but the package
 * entry point does not re-export it, so this checks the two things that helper
 * checks: our own cancel flag, and the message renderMedia rejects with.
 */
function looksCancelled(error: unknown): boolean {
  return cancelled || (error instanceof Error && /got cancelled/i.test(error.message));
}

/* ───────────────────────────── helpers ──────────────────────────── */

function overallProgress(sceneIndex: number, sceneProgress: number, totalScenes: number): number {
  if (totalScenes <= 0) {
    return 0;
  }
  return Math.min(1, (sceneIndex + sceneProgress) / totalScenes);
}

let tempCounter = 0;

/**
 * The temp name a render target is written to before it is renamed into place.
 *
 * The final `.mp4` extension is kept: the encoder picks its container from it.
 * The pid and counter keep two renders in one process from colliding.
 */
function tempTarget(finalPath: string): string {
  tempCounter += 1;
  return `${finalPath}.${process.pid}.${tempCounter}.tmp.mp4`;
}

/**
 * Runs ffmpeg, keeping stderr for diagnostics, never leaving a pipe unread, and
 * letting cancel reach the child.
 *
 * Resolves with the stderr it collected: ffmpeg reports to stderr, so the
 * filters whose whole output is a measurement (`volumedetect`, below) are read
 * from here rather than from a second spawn.
 */
function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpegChild = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on('error', (error) => {
      ffmpegChild = null;
      reject(new Error(`ffmpeg could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      ffmpegChild = null;
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-600).trim()}`));
      }
    });
  });
}

/**
 * Joins the scene clips. `-c copy` is only lossless because every clip was
 * rendered with identical codec, pixel format, frame rate and canvas settings.
 *
 * The join goes to a temp file and is renamed into place, so the concat list is
 * cleaned up either way, a cancelled join leaves no out.mp4, and a player that
 * is already reading the previous out.mp4 keeps a whole file.
 *
 * `verify` is the caller's last look at the joined file while it is still the
 * temp one: running it here rather than after the rename is the difference
 * between refusing a bad join and publishing it. A rejected verify takes the
 * temp down with the rest of the `finally`, so out.mp4 keeps whatever the
 * previous render left there.
 */
async function concatClips(
  clipFiles: string[],
  outPath: string,
  verify: (tempPath: string) => Promise<void>,
): Promise<void> {
  const listPath = path.join(path.dirname(outPath), 'concat.txt');
  const tempOut = tempTarget(outPath);
  const body = clipFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, `${body}\n`);

  try {
    writeStatus({ message: 'Joining the scenes...' }, true);
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tempOut,
    ]);
    // A cancel can land while ffmpeg is finishing. Reporting that as a
    // successful render would be a lie the UI acts on, so the finished temp is
    // thrown away rather than renamed.
    if (cancelled) {
      throw new CancelledError('cancelled during the join');
    }
    await verify(tempOut);
    fs.renameSync(tempOut, outPath);
  } finally {
    fs.rmSync(listPath, { force: true });
    fs.rmSync(tempOut, { force: true });
  }
}

/* ──────────────────────────── narration ─────────────────────────── */

/** Runs ffprobe and returns its stdout, or throws with the reason it could not. */
function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`ffprobe could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-600).trim()}`));
      }
    });
  });
}

type FfprobeJson = {
  streams?: { index?: number; duration?: string }[];
  format?: { duration?: string };
};

function parseFfprobeJson(stdout: string, file: string): FfprobeJson {
  try {
    return JSON.parse(stdout) as FfprobeJson;
  } catch {
    throw new Error(`ffprobe returned output this worker could not read for ${file}`);
  }
}

/** A duration ffprobe printed, or null when it printed nothing usable. */
function parsedSeconds(value: string | undefined): number | null {
  const seconds = Number.parseFloat(value ?? '');
  return Number.isFinite(seconds) ? seconds : null;
}

/** A media file's duration in seconds, as ffprobe measures it. */
async function probeSeconds(file: string): Promise<number> {
  const stdout = await runFfprobe([
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=duration:format=duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = parseFfprobeJson(stdout, file);
  // ffprobe prints "N/A" for a duration it cannot measure -- an AAC stream in a
  // container that only carries the total, for instance -- and parseFloat turns
  // that into NaN rather than into an error. A stream duration that is missing
  // or unmeasurable is not a duration, so the container's own total stands in
  // for it; only when neither can be read does the file have none to give.
  const seconds =
    parsedSeconds(parsed.streams?.[0]?.duration) ?? parsedSeconds(parsed.format?.duration);
  if (seconds === null) {
    throw new Error(`ffprobe found no duration in ${file}`);
  }
  return seconds;
}

/** How many audio streams the file carries. */
async function countAudioStreams(file: string): Promise<number> {
  const stdout = await runFfprobe([
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'json',
    file,
  ]);
  return parseFfprobeJson(stdout, file).streams?.length ?? 0;
}

/**
 * The loudest sample in the file's audio, in dB, as ffmpeg's `volumedetect`
 * measures it. Digital silence has no loudest sample at all, which ffmpeg
 * reports as `-inf`; that is parsed to `-Infinity` so it compares as the
 * quietest possible reading rather than as a failure to measure.
 *
 * `-f null -` writes the decoded audio nowhere -- the filter's real output is
 * the report on stderr, which is why `runFfmpeg` hands its stderr back. `-vn`
 * keeps the measurement to the audio: without it ffmpeg would decode every
 * frame of a five minute video to throw it away.
 */
async function measureMaxVolumeDb(file: string): Promise<number> {
  const stderr = await runFfmpeg([
    '-hide_banner',
    '-i',
    file,
    '-vn',
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const reported = /max_volume:\s*(-?(?:inf|[\d.]+))\s*dB/.exec(stderr)?.[1];
  if (reported === undefined) {
    throw new Error(
      `refusing to render: ffmpeg could not measure the volume of ${file} -- the file has audio the ` +
        `worker cannot read: ${stderr.slice(-600).trim()}`,
    );
  }
  return reported === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(reported);
}

/**
 * Refuses a file whose audio track is missing or silent.
 *
 * The `-c copy` join passes each clip's audio through untouched, so a clip with
 * no audio stream would join into a silently mute video and a clip with two
 * would join into something no player expects.
 *
 * The stream count alone is not enough to rule out silence: the render asks for
 * an audio track unconditionally, so a clip whose narration never played still
 * comes back with a stream -- of silence, as long as the scene. That is the
 * failure this checks for, and it is why the count is followed by a
 * measurement rather than trusted. Both are refusals, checked before the join
 * (and, for the join itself, before it is renamed into place) rather than
 * discovered by whoever watches the result.
 */
async function requireAudibleTrack(file: string, what: string): Promise<void> {
  const count = await countAudioStreams(file);
  if (count !== 1) {
    throw new Error(`refusing to render: ${what} carries ${count} audio streams, not one (${file})`);
  }
  const maxDb = await measureMaxVolumeDb(file);
  if (maxDb <= AUDIO_SILENCE_MAX_VOLUME_DB) {
    throw new Error(
      `refusing to render: ${what} is silent -- its loudest sample is ` +
        `${Number.isFinite(maxDb) ? `${maxDb.toFixed(1)} dB` : '-inf dB'}, at or below the ` +
        `${AUDIO_SILENCE_MAX_VOLUME_DB} dB floor (${file}). The narration did not reach the clip.`,
    );
  }
}

/**
 * Synthesizes one scene's narration, and refuses one that does not fit.
 *
 * The WAV is written to a temp name and only renamed into place once it has
 * passed the gate, so a refused or cancelled synthesis leaves whatever the
 * previous render put there -- never a torn WAV -- and every temp is removed on
 * the way out. An existing WAV is never reused: the storyboard may have been
 * rebuilt since it was written, and stale audio under a new script is worse than
 * none at all.
 *
 * The gate: the WAV's own duration against the scene's frame-rounded length plus
 * `NARRATION_OVERRUN_TOLERANCE_SECONDS`. The voice is never sped up or slowed
 * down to fit, so a narration longer than its scene is refused here and the
 * render stops -- before that scene's first frame is drawn -- naming the scene
 * and both durations, rather than being truncated or rushed to fit.
 *
 * The measurement the gate took is also the function's result, because the scene
 * is rendered for it: a narration that ends early is a scene that ends early,
 * not seconds of silence (see `fittedSceneSeconds`).
 */
async function synthesizeNarration(options: {
  scene: Scene;
  index: number;
  narrationDir: string;
}): Promise<number> {
  const { scene, index, narrationDir } = options;
  const finalPath = path.join(narrationDir, narrationFileName(index));
  const tempPath = `${finalPath}.tmp`;
  const budgetSeconds = secondsToFrames(scene.durationSeconds) / FPS;

  try {
    // One argument, one breath: whitespace collapses to single spaces, so a
    // narration with a break in it is spoken as one unbroken line. The status
    // callback speaks up only while the model is downloading itself on the
    // first run.
    await synthesize(scene.narration.replace(/\s+/g, ' ').trim(), tempPath, (message) =>
      writeStatus({ message }),
    );
    if (cancelled) {
      throw new CancelledError(`cancelled while narrating scene ${index + 1}`);
    }

    const seconds = await probeSeconds(tempPath);
    if (seconds > budgetSeconds + NARRATION_OVERRUN_TOLERANCE_SECONDS) {
      // The tolerance is one frame exactly, so it is printed to two places
      // rather than as 0.041666666666666664.
      throw new Error(
        `refusing to render: scene ${index + 1} narration runs ${seconds.toFixed(2)}s, over the scene's ` +
          `${scene.durationSeconds}s (${budgetSeconds.toFixed(2)}s of frames plus ` +
          `${NARRATION_OVERRUN_TOLERANCE_SECONDS.toFixed(2)}s of rounding slack). The voice is never sped ` +
          "up to fit: shorten that scene's narration and rebuild the storyboard.",
      );
    }

    fs.renameSync(tempPath, finalPath);
    return seconds;
  } finally {
    // No-op after a successful rename; the cleanup for a refused, failed or
    // cancelled WAV, so no `.wav.tmp` outlives the run.
    fs.rmSync(tempPath, { force: true });
  }
}

type NarrationJob = {
  /** Resolves with the measured seconds once the WAV passed its gate. */
  promise: Promise<number>;
  /** True once the gate passed and the WAV was renamed into place. */
  isDone: () => boolean;
};

/**
 * Speaks one scene's narration as a background job, awaited by the stage that
 * needs it: the bundle for the first scene, the previous scene's render for the
 * rest.
 *
 * Unconditional by design -- a render narrates every scene, and never reuses a
 * WAV already on disk -- and never more than one voice at a time. Each WAV only
 * has to exist before its own scene draws, so each scene's voice is spoken while
 * the previous one renders.
 *
 * The promise gets a no-op catch the moment it is created: the caller awaits it
 * only after a bundle or a render, and a rejection left unhandled for that long
 * would crash the process under Node's default unhandled-rejection policy. The
 * await still rethrows the original error, so an overrun refusal or a failed
 * synthesis surfaces exactly where the serial pre-flight stage surfaced it.
 */
function startNarration(scene: Scene, index: number, narrationDir: string): NarrationJob {
  let done = false;
  const promise = synthesizeNarration({ scene, index, narrationDir }).then((seconds) => {
    done = true;
    return seconds;
  });
  promise.catch(() => {});
  return { promise, isDone: () => done };
}

/* ─────────────────────────────── main ───────────────────────────── */

async function renderScene(options: {
  serveUrl: string;
  scene: Scene;
  index: number;
  totalScenes: number;
  /** Scenes already finished when this one starts. */
  completedScenes: number;
  /** This scene's WAV as measured; the clip is rendered for it, not the storyboard. */
  narrationSeconds: number;
  outputPath: string;
  /** Maps this scene's own 0..1 progress onto the job's. */
  jobProgress: (sceneProgress: number) => number;
}): Promise<void> {
  const {
    serveUrl,
    scene,
    index,
    totalScenes,
    completedScenes,
    narrationSeconds,
    outputPath,
    jobProgress,
  } = options;
  // This scene's narration has already been spoken -- the first's while the
  // composition bundled, every later scene's while the previous scene drew --
  // and the bundle serves the narration directory as its public directory, so
  // the composition names the file the way `staticFile` resolves it. One
  // inputProps object reaches both
  // `selectComposition` and `renderMedia`: the duration the composition is
  // selected with and the one it is rendered with can never disagree.
  //
  // The scene in it is a fitted copy, not the storyboard's: its `durationSeconds`
  // is what this scene's narration actually measured plus a tail, so the clip
  // ends with the voice. Render-only on purpose -- the gate checked the
  // storyboard's length, the status lines and the filenames name the scene's own
  // index, and `scenes.json` keeps the number the model wrote.
  const inputProps = {
    scene: {
      ...scene,
      durationSeconds: fittedSceneSeconds(scene.durationSeconds, narrationSeconds),
    },
    sceneIndex: index,
    totalScenes,
    narrationPath: narrationFileName(index),
  };
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    logLevel: 'error',
  });

  // The scene number is the storyboard's position; a one-scene storyboard reads
  // "scene 1" rather than "scene 1 of 1".
  writeStatus(
    {
      sceneIndex: index,
      message:
        totalScenes > 1
          ? `Drawing scene ${index + 1} of ${totalScenes}...`
          : `Drawing scene ${index + 1}...`,
    },
    true,
  );

  // Rendered to a temp name: a scene cut short by a cancel must not leave a
  // truncated clip where the finished ones live.
  const tempOutput = tempTarget(outputPath);
  try {
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      outputLocation: tempOutput,
      codec: VIDEO_CODEC,
      pixelFormat: PIXEL_FORMAT,
      crf: CRF,
      x264Preset: X264_PRESET,
      imageFormat: IMAGE_FORMAT,
      jpegQuality: JPEG_QUALITY,
      concurrency: MAX_FRAME_CONCURRENCY,
      // The scene's narration is this clip's audio track, so the render is
      // unmuted; `enforceAudioTrack` guarantees the stream is there even if the
      // composition played nothing, which is what the `-c copy` join needs. The
      // audio settings are pinned with the video ones in render-config.ts.
      muted: false,
      enforceAudioTrack: true,
      audioCodec: AUDIO_CODEC,
      audioBitrate: AUDIO_BITRATE,
      // Trims each clip's audio to the nearest AAC frame. Remotion documents why
      // in the option's own description: it "is required for seamless
      // concatenation of AAC files". An AAC frame is a fixed 1024 samples, so a
      // track that ends mid-frame leaves a partial frame at the join; every scene
      // then starts a frame or so late, and over a ~40-scene video the narration
      // drifts visibly behind the drawing. This is what makes the join honest.
      forSeamlessAacConcatenation: true,
      overwrite: true,
      logLevel: 'error',
      cancelSignal,
      onProgress: ({ progress: sceneProgress }) => {
        writeStatus({
          sceneIndex: index,
          // Counted in the job's own terms: the scenes committed to disk so far,
          // not a fraction derived from this scene's progress.
          renderedScenes: completedScenes,
          progress: jobProgress(sceneProgress),
        });
      },
    });
    fs.renameSync(tempOutput, outputPath);
  } catch (error) {
    if (looksCancelled(error)) {
      throw new CancelledError(`cancelled while rendering scene ${index + 1}`);
    }
    throw error;
  } finally {
    // No-op after a successful rename; the cleanup for a cancelled or failed one.
    fs.rmSync(tempOutput, { force: true });
  }
}

/**
 * Reads and checks the storyboard: parse, then validate, then the duration
 * window -- the same gates the app applies on the way in.
 */
function loadScenes(args: WorkerArgs): Scene[] {
  const scenesPath = path.join(args.projectDir, SCENES_FILENAME);
  const raw = readJsonFile<unknown>(scenesPath);
  if (raw === null) {
    throw new Error(`refusing to render: ${scenesPath} is missing or is not valid JSON`);
  }

  // Parse, then validate: the same two steps the app runs on the way in, so a
  // storyboard rendered from here is the storyboard the app accepted. There is
  // nothing to lay out -- each scene kind is drawn by its own block, which
  // places its own contents.
  const structural = ScenesShapeSchema.safeParse(raw);
  if (!structural.success) {
    const details = issueDetails(structural.error).slice(0, 8).join('\n  ');
    throw new Error(`refusing to render: scenes.json does not match the scene format\n  ${details}`);
  }

  const validation = validateScenes(structural.data);
  if (!validation.ok) {
    const details = validation.errors.slice(0, 8).join('\n  ');
    throw new Error(`refusing to render: scenes.json does not match the scene format\n  ${details}`);
  }
  const scenes = validation.scenes;

  if (scenes.length === 0) {
    throw new Error('refusing to render: scenes.json holds no scenes');
  }

  const budget = checkBudget(scenes);
  if (!budget.ok) {
    throw new Error(`refusing to render: ${budget.message}`);
  }

  return scenes;
}

/**
 * Takes the render lock, or explains why not.
 *
 * The lock sits beside the project folders, which is where the app keeps it:
 * `<PROJECTS_ROOT>/<id>` is the project, so its parent is the root.
 *
 * The app spawns this process and claims the lock with its pid immediately, so
 * a lock carrying our own pid is ours -- either writer may arrive first. A lock
 * held by a *different* live process is a refusal: rendering anyway would put
 * two renders on one machine and make this job invisible to Cancel.
 */
function takeRenderLock(args: WorkerArgs): 'held' | null {
  const lockPath = path.join(path.dirname(args.projectDir), LOCK_FILENAME);
  const lock: RenderLock = {
    projectId: path.basename(args.projectDir),
    projectDir: args.projectDir,
    pid: process.pid,
    startedAt: Date.now(),
  };

  const outcome = claimLock(lockPath, lock);
  if (outcome === 'held') {
    return 'held';
  }

  // Released on the way out, and only while the lock is still ours: a newer job
  // may have taken it over in the meantime.
  process.on('exit', () => releaseLockIfOwnedBy(lockPath, process.pid));
  return null;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  let scenes: Scene[];
  try {
    scenes = loadScenes(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }

  // Claimed after the pre-flight refusals (a refused render must not touch the
  // lock) and before the browser/bundle work.
  if (takeRenderLock(args) === 'held') {
    // Deliberately no status write: the lock holder may be rendering this very
    // project, and stamping "failed" over its live progress would be worse than
    // saying nothing.
    process.stderr.write(
      `[render] refusing to start: another render is already running (lock ${path.join(
        path.dirname(args.projectDir),
        LOCK_FILENAME,
      )}). Cancel it or wait for it to finish.\n`,
    );
    return EXIT_FAILED;
  }

  initStatus(args.statusPath, scenes.length);

  try {
    process.stdout.write(`[render] ${scenes.length} scenes from ${args.projectDir}\n`);

    await ensureBrowser({ logLevel: 'error' });
    abortIfCancelled('browser start-up');

    // Narration is spoken one scene at a time, overlapped with the slow stages:
    // the first scene's voice runs while the composition bundles, and every
    // later scene's voice runs while the previous scene draws. Each WAV only has to
    // exist before its own scene's renderMedia -- the same per-WAV gate and the
    // same "never reused" rule as ever, just not all up front (a stale WAV under
    // a rebuilt storyboard is worse than none).
    const narrationDir = path.join(args.projectDir, NARRATION_DIRNAME);
    fs.mkdirSync(narrationDir, { recursive: true });
    const indices = scenes.map((_, index) => index);
    writeStatus({ message: 'Preparing narration...' }, true);
    process.stdout.write(
      `[render] narrating ${indices.length} scene${indices.length === 1 ? '' : 's'}, overlapped with rendering\n`,
    );
    const firstIndex = indices[0];
    const firstJob = startNarration(scenes[firstIndex], firstIndex, narrationDir);
    let narrationJob: NarrationJob | null = firstJob;

    process.stdout.write('[render] bundling the composition\n');
    // The narration directory -- not the project folder -- is the bundle's
    // public directory: it is the smallest directory `staticFile` needs, and the
    // project folder beside it holds hundreds of megabytes of clips. It is
    // symlinked rather than copied, so a WAV renamed into place after the bundle
    // exists is servable the moment its scene renders. On Windows the bundler
    // copies instead, so each post-bundle WAV is copied into the served
    // directory before its scene draws (`publishNarration`).
    // The RemotionUI sources import through `@/*`; webpack does not read
    // tsconfig `paths`, so the alias is handed over explicitly.
    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: narrationDir,
      symlinkPublicDir: process.platform !== 'win32',
      webpackOverride: webpackAliasOverride(PROJECT_ROOT),
    });
    abortIfCancelled('bundling');

    /** Windows only: the bundle copied the narration directory, so hand it the WAV. */
    const publishNarration = (index: number): void => {
      if (process.platform === 'win32') {
        fs.copyFileSync(
          path.join(narrationDir, narrationFileName(index)),
          path.join(serveUrl, 'public', narrationFileName(index)),
        );
      }
    };

    const clipsDir = path.join(args.projectDir, CLIPS_DIRNAME);
    fs.mkdirSync(clipsDir, { recursive: true });

    const clipFiles: string[] = [];
    for (let index = 0; index < scenes.length; index++) {
      abortIfCancelled('narration synthesis');
      // This scene's voice was started during the previous scene's render (or,
      // for the first scene, before the bundle). Waiting here is what makes the
      // WAV exist before its scene draws -- and an overrun still lands before
      // this scene's first frame, like it always did.
      const job = narrationJob ?? startNarration(scenes[index], index, narrationDir);
      narrationJob = null;
      // Written only while the voice is genuinely still being spoken: a WAV
      // already in place would leave this message up until the render replaces
      // it. The terms match the render stage's -- the storyboard index for
      // `sceneIndex`, and progress over the whole job -- so the two read as one
      // run.
      if (!job.isDone()) {
        writeStatus(
          {
            sceneIndex: index,
            message: `Narrating scene ${index + 1} of ${scenes.length}...`,
            progress: overallProgress(index, 0, scenes.length),
          },
          true,
        );
      }
      const narrationSeconds = await job.promise;
      abortIfCancelled('narration synthesis');
      publishNarration(index);

      // The next scene's voice starts now, so kokoro speaks while this scene
      // draws -- and never more than one synthesis at a time.
      if (index + 1 < scenes.length) {
        narrationJob = startNarration(scenes[index + 1], index + 1, narrationDir);
      }

      const clip = path.join(clipsDir, sceneClipName(index));
      try {
        await renderScene({
          serveUrl,
          scene: scenes[index],
          index,
          totalScenes: scenes.length,
          completedScenes: index,
          narrationSeconds,
          outputPath: clip,
          jobProgress: (sceneProgress) => overallProgress(index, sceneProgress, scenes.length),
        });
        // Checked before the clip joins the list: the join is `-c copy`, so a clip
        // that lost its narration -- a missing stream, or a track of pure silence
        // -- would ship a video that is mute for that scene's whole length.
        await requireAudibleTrack(clip, `the clip for scene ${index + 1}`);
      } catch (error) {
        // A failed render abandons the next scene's voice: it belongs to this
        // job and dies with this process.
        throw error;
      }
      clipFiles.push(clip);
      writeStatus(
        {
          renderedScenes: index + 1,
          progress: overallProgress(index + 1, 0, scenes.length),
        },
        true,
      );
    }

    abortIfCancelled('joining');
    const outPath = path.join(args.projectDir, OUTPUT_FILENAME);
    // The file that leaves the machine, measured rather than assumed -- in the
    // verify callback, so a bad join is refused while it is still a temp and
    // out.mp4 keeps the previous render's file rather than becoming a bad one.
    await concatClips(clipFiles, outPath, (tempOut) =>
      requireAudibleTrack(tempOut, 'the joined video'),
    );
    return finish('done', 'Render complete.');
  } catch (error) {
    // A bundle or verify failure can leave the next scene's synthesis in
    // flight; it belongs to this job and dies with this process.
    if (error instanceof CancelledError || cancelled) {
      // Finished clips stay on disk: a retry re-renders every scene, so they
      // are a starting point for a person, not for the next run.
      return finish('cancelled', 'Render cancelled.');
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[render] failed: ${message}\n`);
    return finish('failed', message.slice(0, 400));
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      process.stderr.write(`${message}\n\n${USAGE}`);
    } else {
      process.stderr.write(`[render] crashed: ${message}\n`);
    }
    process.exit(EXIT_FAILED);
  });
