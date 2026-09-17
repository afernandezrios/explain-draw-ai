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
 *   - the storyboard is re-validated against the DSL, and a full render whose
 *     total falls outside the accepted window is refused, using the same schema
 *     and the same constants as the app;
 *   - the render lock is claimed before any work starts, so a CLI render cannot
 *     run alongside an app render (two Chromium renders on a 7.6 GiB laptop, and
 *     no way to cancel the one the UI cannot see);
 *   - every finished file is rendered to a temp name and renamed into place, so
 *     a cancelled or failed render never leaves a half-written MP4 where the
 *     player (or the next run) would find it.
 *
 * Exit codes: 0 success, 1 refusal/failure, 130 cancelled.
 *
 * Run directly with: node scripts/render-worker.ts --project <dir> [--scene n]
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
import { readJsonFile, writeJsonAtomic } from '../src/lib/atomic.ts';
import {
  AUDIO_BITRATE,
  AUDIO_CODEC,
  AUDIO_SILENCE_MAX_VOLUME_DB,
  CLIPS_DIRNAME,
  CRF,
  DEFAULT_PIPER_MODELS_DIR,
  DEFAULT_PIPER_VOICE,
  fittedSceneSeconds,
  FPS,
  IMAGE_FORMAT,
  LOCK_FILENAME,
  MAX_FRAME_CONCURRENCY,
  NARRATION_DIRNAME,
  NARRATION_OVERRUN_TOLERANCE_SECONDS,
  OUTPUT_FILENAME,
  PIPER_MODELS_DIR_ENV,
  PIPER_VOICE_ENV,
  PIXEL_FORMAT,
  PREVIEW_CLIP_FILENAME,
  PREVIEW_FILENAME,
  SCENES_FILENAME,
  STATUS_FILENAME,
  VIDEO_CODEC,
  X264_PRESET,
  narrationFileName,
  sceneClipName,
  secondsToFrames,
} from '../src/lib/render-config.ts';
import { layOutScenes } from '../src/lib/layout.ts';
import { claimLock, releaseLockIfOwnedBy, type RenderLock } from '../src/lib/render-lock.ts';
import type { RenderMode, RenderStatus } from '../src/lib/render-status.ts';
import {
  ScenesShapeSchema,
  checkBudget,
  issueDetails,
  validateScenes,
  type Scene,
} from '../src/lib/schema.ts';

const WORKER_DIR = import.meta.dirname;
const PROJECT_ROOT = path.resolve(WORKER_DIR, '..');
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
  /** Scene to render for a preview; absent means render the whole video. */
  scene?: number;
};

const USAGE = `Usage: node scripts/render-worker.ts --project <dir> [options]

  --project <dir>   project folder holding scenes.json (required)
  --status <file>   where to write render status (default <dir>/${STATUS_FILENAME})
  --scene <n>       render only scene n (0-based) as a preview
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

/** Rejects anything that is not a plain non-negative integer. */
function parseSceneArg(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--scene must be a non-negative integer, got "${value}"`);
  }
  return Number.parseInt(value, 10);
}

function parseArgs(argv: string[]): WorkerArgs {
  let projectDir: string | undefined;
  let statusPath: string | undefined;
  let scene: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') {
      projectDir = requireValue(argv, ++i, '--project');
    } else if (arg === '--status') {
      statusPath = requireValue(argv, ++i, '--status');
    } else if (arg === '--scene') {
      scene = parseSceneArg(requireValue(argv, ++i, '--scene'));
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
    scene,
  };
}

/* ────────────────────────────── status ──────────────────────────── */

let status: RenderStatus;
let statusPath = '';
let lastStatusWrite = 0;

function initStatus(pathToStatus: string, mode: RenderMode, totalScenes: number): void {
  statusPath = pathToStatus;
  status = {
    state: 'running',
    mode,
    pid: process.pid,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    sceneIndex: 0,
    totalScenes,
    renderedScenes: 0,
    progress: 0,
    message: mode === 'preview' ? 'Drawing the scene preview...' : 'Preparing the render...',
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
/** piper during narration synthesis, so cancel does not have to wait for the voice. */
let piperChild: ChildProcess | null = null;

function requestCancel(): void {
  cancelled = true;
  cancel();
  // Both children are killed and then awaited by their own callers, so a cancel
  // never leaves a half-written WAV or join behind.
  for (const child of [ffmpegChild, piperChild]) {
    if (!child) {
      continue;
    }
    try {
      child.kill('SIGTERM');
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

const PIPER_INSTALL_HINT =
  'Piper speaks the narration. Install it with `python3 -m pip install piper-tts`, put its command on PATH, and download a voice (see the README prerequisites).';

/**
 * Where piper finds its voice: the model file, and the directory it is resolved
 * from.
 *
 * `PIPER_MODELS_DIR` names the directory the voice lives in; unset, voices live
 * in the repo's `models/`. Both the configured value and the default are
 * resolved against the worker's own root rather than the working directory, so
 * the same setting and the same render find the same voice from anywhere --
 * `PIPER_MODELS_DIR=models` means the repo's `models/`, not a `models/` beside
 * whatever folder the render was started from.
 *
 * The model path is always passed to piper absolute, so piper needs no
 * data-dir flag to look the voice up -- naming the file means the voice is
 * exactly the configured one and never a stray `.onnx` that happens to sit in
 * the working directory.
 */
function piperConfig(): { voice: string; modelPath: string } {
  const voice = process.env[PIPER_VOICE_ENV]?.trim() || DEFAULT_PIPER_VOICE;
  const configured = process.env[PIPER_MODELS_DIR_ENV]?.trim();
  const modelsDir = configured
    ? path.resolve(PROJECT_ROOT, configured)
    : path.join(PROJECT_ROOT, DEFAULT_PIPER_MODELS_DIR);
  return { voice, modelPath: path.join(modelsDir, `${voice}.onnx`) };
}

/**
 * Speaks one narration into `outputPath` with piper, text as the positional
 * argument after `--` -- the invocation piper's own docs show (`piper -m
 * voice.onnx -f out.wav -- 'text'`), so the voice, the output and the words can
 * never be confused with a flag, and the text needs no shell.
 *
 * Synthesis is local and offline: piper is spawned, never imported or bundled,
 * and the child is tracked so a cancel reaches it the way it reaches ffmpeg.
 * Missing piper (ENOENT) and a missing or unusable voice both come back as
 * errors that name what to install; there is no silent fallback.
 */
function runPiper(options: { text: string; outputPath: string }): Promise<void> {
  const { voice, modelPath } = piperConfig();
  return new Promise((resolve, reject) => {
    const child = spawn(
      'piper',
      ['-m', modelPath, '-f', options.outputPath, '--', options.text],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    piperChild = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on('error', (error) => {
      piperChild = null;
      reject(new Error(`piper could not start: ${error.message}. ${PIPER_INSTALL_HINT}`));
    });
    child.on('close', (code) => {
      piperChild = null;
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `piper exited with code ${code} speaking the voice "${voice}" from ${modelPath}: ${stderr.slice(-600).trim()} ${PIPER_INSTALL_HINT}`,
          ),
        );
      }
    });
  });
}

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
 * render stops -- before anything is bundled or drawn -- naming the scene and
 * both durations, rather than being truncated or rushed to fit.
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
    // narration with a break in it is spoken as one unbroken line.
    await runPiper({ text: scene.narration.replace(/\s+/g, ' ').trim(), outputPath: tempPath });
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

/**
 * The pre-flight synthesis stage: every narration this job needs, before
 * anything is bundled or drawn.
 *
 * Unconditional by design -- a full render synthesizes all scenes, a preview
 * only the scene it draws, and neither reuses a WAV already on disk. Running
 * before `bundle()` means an overrun stops the render before a single frame is
 * encoded, and the bundle then serves the very files the composition plays.
 *
 * Returns the directory the bundle takes as its public directory, and every WAV
 * it wrote measured in seconds, keyed by storyboard index -- the fit each scene
 * is rendered for, gathered here so the render stage only has to look it up.
 */
async function synthesizeNarrations(options: {
  projectDir: string;
  scenes: Scene[];
  /** Storyboard indices this job renders: every scene, or just the preview's. */
  indices: number[];
}): Promise<{ narrationDir: string; narrationSeconds: Map<number, number> }> {
  const narrationDir = path.join(options.projectDir, NARRATION_DIRNAME);
  const narrationSeconds = new Map<number, number>();
  fs.mkdirSync(narrationDir, { recursive: true });
  writeStatus({ message: 'Preparing narration...' }, true);
  process.stdout.write(
    `[render] synthesizing narration for ${options.indices.length} scene${
      options.indices.length === 1 ? '' : 's'
    }\n`,
  );

  for (const index of options.indices) {
    abortIfCancelled('narration synthesis');
    // Written per scene, before the voice starts: one static message for the
    // whole stage would leave the UI showing the first scene at 0% for the
    // minutes a full storyboard takes to speak. The terms match the render
    // stage's -- the storyboard index for `sceneIndex`, and progress over the
    // whole job -- so the two stages read as one run.
    writeStatus(
      {
        sceneIndex: index,
        message:
          options.indices.length > 1
            ? `Narrating scene ${index + 1} of ${options.scenes.length}...`
            : `Narrating scene ${index + 1}...`,
        progress: overallProgress(index, 0, options.scenes.length),
      },
      true,
    );
    narrationSeconds.set(
      index,
      await synthesizeNarration({ scene: options.scenes[index], index, narrationDir }),
    );
  }

  return { narrationDir, narrationSeconds };
}

/* ─────────────────────────────── main ───────────────────────────── */

async function renderScene(options: {
  serveUrl: string;
  scene: Scene;
  index: number;
  totalScenes: number;
  /** Scenes already finished when this one starts. A preview job has none. */
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
  // The narration was synthesized before the bundle, and the bundle serves the
  // narration directory as its public directory, so the composition names the
  // file the way `staticFile` resolves it. One inputProps object reaches both
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

  // The scene number is the storyboard's, the total is the job's: a preview of
  // scene 4 of a 39-scene storyboard is "scene 4", not "scene 4 of 1".
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
          // Counted in the job's own terms: a preview of scene 4 is still the
          // first (and only) scene of its job, not "three already done".
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
 * Reads and checks the storyboard. Validation always applies; the duration
 * window applies to a full render, while a single-scene preview is allowed for
 * a storyboard that is still being brought inside the window.
 */
function loadScenes(args: WorkerArgs): Scene[] {
  const scenesPath = path.join(args.projectDir, SCENES_FILENAME);
  const raw = readJsonFile<unknown>(scenesPath);
  if (raw === null) {
    throw new Error(`refusing to render: ${scenesPath} is missing or is not valid JSON`);
  }

  // Parse, lay out, validate: the same three steps the app runs on the way in,
  // so a storyboard rendered from here is the storyboard the preview showed --
  // anchors resolved, labels centred, arrow ends on the shapes they name. A
  // storyboard that was laid out already is unchanged by the pass.
  const structural = ScenesShapeSchema.safeParse(raw);
  if (!structural.success) {
    const details = issueDetails(structural.error).slice(0, 8).join('\n  ');
    throw new Error(`refusing to render: scenes.json does not match the scene format\n  ${details}`);
  }

  const validation = validateScenes(layOutScenes(structural.data).scenes);
  if (!validation.ok) {
    const details = validation.errors.slice(0, 8).join('\n  ');
    throw new Error(`refusing to render: scenes.json does not match the scene format\n  ${details}`);
  }
  const scenes = validation.scenes;

  if (scenes.length === 0) {
    throw new Error('refusing to render: scenes.json holds no scenes');
  }

  if (args.scene !== undefined && (args.scene < 0 || args.scene >= scenes.length)) {
    throw new Error(
      `refusing to render: --scene ${args.scene} is outside scenes.json (0-${scenes.length - 1})`,
    );
  }

  if (args.scene === undefined) {
    const budget = checkBudget(scenes);
    if (!budget.ok) {
      throw new Error(`refusing to render: ${budget.message}`);
    }
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
    mode: args.scene === undefined ? 'full' : 'preview',
    sceneIndex: args.scene ?? null,
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

  const previewing = args.scene !== undefined;
  const totalScenes = previewing ? 1 : scenes.length;
  initStatus(args.statusPath, previewing ? 'preview' : 'full', totalScenes);

  try {
    process.stdout.write(
      `[render] ${previewing ? `scene ${args.scene} preview` : `${scenes.length} scenes`} from ${args.projectDir}\n`,
    );

    await ensureBrowser({ logLevel: 'error' });
    abortIfCancelled('browser start-up');

    // Pre-flight narration, before anything is bundled or drawn: every scene
    // for a full render, the previewed scene for a preview, none of it reused --
    // a stale WAV under a rebuilt storyboard is worse than none. The narration
    // directory becomes the bundle's public directory, so the composition's
    // `staticFile` names resolve to the WAVs just written.
    const { narrationDir, narrationSeconds } = await synthesizeNarrations({
      projectDir: args.projectDir,
      scenes,
      indices: previewing ? [args.scene as number] : scenes.map((_, index) => index),
    });
    abortIfCancelled('narration synthesis');

    process.stdout.write('[render] bundling the composition\n');
    // The narration directory -- not the project folder -- is the bundle's
    // public directory: it is the smallest directory `staticFile` needs, and the
    // project folder beside it holds hundreds of megabytes of clips. The bundler
    // copies it in, so what the composition plays is what was just synthesized.
    const serveUrl = await bundle({ entryPoint: ENTRY_POINT, publicDir: narrationDir });
    abortIfCancelled('bundling');

    if (previewing) {
      const sceneIndex = args.scene as number;
      // Render to a file of its own, then move it into place. Rendering straight
      // over preview.mp4 would be the file the player is already serving, and
      // rendering over the scene's own clip would destroy a finished full-render
      // clip.
      const clipPath = path.join(args.projectDir, PREVIEW_CLIP_FILENAME);
      const previewPath = path.join(args.projectDir, PREVIEW_FILENAME);
      try {
        await renderScene({
          serveUrl,
          scene: scenes[sceneIndex],
          index: sceneIndex,
          totalScenes: 1,
          completedScenes: 0,
          narrationSeconds: narrationSeconds.get(sceneIndex) as number,
          outputPath: clipPath,
          // A preview is its own job of one scene, so its progress is the
          // scene's own: an index over one total would read 100% immediately.
          jobProgress: (sceneProgress) => sceneProgress,
        });
        // Checked while it is still preview-clip.mp4: a preview clip is a clip
        // like any other and must carry its narration, and refusing after the
        // rename would have destroyed the previous, good preview.mp4 on the way
        // to reporting the problem.
        await requireAudibleTrack(clipPath, 'the preview clip');
        fs.renameSync(clipPath, previewPath);
        writeStatus({ renderedScenes: 1 }, true);
      } finally {
        // Whether it was cancelled, failed or already moved into place.
        fs.rmSync(clipPath, { force: true });
      }
      return finish('done', 'Preview ready.');
    }

    const clipsDir = path.join(args.projectDir, CLIPS_DIRNAME);
    fs.mkdirSync(clipsDir, { recursive: true });

    const clipFiles: string[] = [];
    for (let index = 0; index < scenes.length; index++) {
      const clip = path.join(clipsDir, sceneClipName(index));
      await renderScene({
        serveUrl,
        scene: scenes[index],
        index,
        totalScenes: scenes.length,
        completedScenes: index,
        narrationSeconds: narrationSeconds.get(index) as number,
        outputPath: clip,
        jobProgress: (sceneProgress) => overallProgress(index, sceneProgress, scenes.length),
      });
      // Checked before the clip joins the list: the join is `-c copy`, so a clip
      // that lost its narration -- a missing stream, or a track of pure silence
      // -- would ship a video that is mute for that scene's whole length.
      await requireAudibleTrack(clip, `the clip for scene ${index + 1}`);
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
