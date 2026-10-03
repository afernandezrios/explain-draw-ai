/**
 * Shared helpers for the sociable e2e suite.
 *
 * FakeLLM is the only fake in this suite. Projects are built through the app's
 * own pipeline functions, scenes are written as real files, renders go through
 * the real worker, and ffmpeg/ffprobe are real. Everything here runs against a
 * throwaway PROJECTS_DIR so the suite never touches a real projects folder.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE_SCRIPT } from '../../src/lib/fixtures.ts';
import {
  createProject,
  projectFiles,
  projectsRoot,
  readStatus,
  writeScenes,
  writeScript,
} from '../../src/lib/pipeline.ts';
import { LOCK_FILENAME } from '../../src/lib/render-config.ts';
import type { RenderStatus } from '../../src/lib/render-status.ts';
import type { Scene } from '../../src/lib/schema.ts';
import type { Script } from '../../src/lib/types.ts';

/* ───────────────────────────── projects ─────────────────────────── */

/** Points the app at a fresh temp directory. Returns it. */
export function useTempProjectsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-draw-test-'));
  process.env.PROJECTS_DIR = root;
  return root;
}

export type TestProject = {
  id: string;
  dir: string;
  status: string;
  scenes: Scene[];
};

/**
 * The one place a test project is created: a real folder via `createProject`,
 * a real script.json and a real scenes.json.
 */
export function makeProject(
  scenes: Scene[],
  options: { input?: string; script?: Script } = {},
): TestProject {
  const root = projectsRoot();
  if (!root.startsWith(os.tmpdir())) {
    throw new Error(
      `refusing to build test projects outside a temp directory: PROJECTS_DIR is ${root}`,
    );
  }

  const id = createProject(options.input ?? 'test input');
  writeScript(id, options.script ?? FAKE_SCRIPT);
  writeScenes(id, scenes);
  return { id, dir: projectFiles(id).dir, status: projectFiles(id).status, scenes };
}

/* ───────────────────────────── storyboards ──────────────────────── */

/**
 * The shortest legal scene (7s, the 3-shape minimum), so a render of it is the
 * least work the format allows.
 */
export function shortScene(index = 0): Scene {
  return {
    title: `Scene ${index + 1}`,
    durationSeconds: 7,
    shapes: [
      { kind: 'label', x: 10, y: 30, text: `Part ${index + 1}`, size: 10, color: null },
      { kind: 'underline', x: 10, y: 34, w: 38, color: 'accent' },
      { kind: 'circle', x: 72, y: 56, r: 12, color: null },
    ],
  };
}

/**
 * A storyboard that passes the 270-330s window: `count` shortest scenes.
 * 39 x 7s = 273s.
 */
export function fullStoryboard(count = 39): Scene[] {
  return Array.from({ length: count }, (_, index) => shortScene(index));
}

/**
 * 273s at 24fps. The exact frame count of a full render of `fullStoryboard()`,
 * which is the only kind of full render the budget gate allows.
 */
export const FULL_RENDER_FRAMES = 273 * 24;

/* ─────────────────────────────── worker ─────────────────────────── */

export function workerPath(): string {
  return path.join(process.cwd(), 'scripts', 'render-worker.ts');
}

export type WorkerOutput = { stdout: string; stderr: string };

/**
 * Spawns the render worker with the same arguments the app's seam uses.
 *
 * The one difference is the lock: `startJob` claims it with the worker's pid
 * before the spawn returns, whereas here the worker claims it itself. Both are
 * the real protocol -- the worker accepts a lock carrying its own pid. */
export function spawnWorker(project: TestProject, args: string[] = []): {
  child: ChildProcess;
  output: () => WorkerOutput;
} {
  const child = spawn(
    process.execPath,
    [workerPath(), '--project', project.dir, '--status', project.status, ...args],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return { child, output: () => ({ stdout, stderr }) };
}

export type WorkerResult = WorkerOutput & { code: number | null; signal: string | null };

/** Resolves when the child exits, however it exits. */
export function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

/** Runs the worker to completion and reports how it exited. */
export function runWorker(project: TestProject, args: string[] = []): Promise<WorkerResult> {
  const { child, output } = spawnWorker(project, args);
  return waitForExit(child).then(({ code, signal }) => ({ ...output(), code, signal }));
}

/* ──────────────────────────────── state ─────────────────────────── */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for status.json to satisfy a condition, or explains what it saw instead. */
export async function waitForStatus(
  id: string,
  predicate: (status: RenderStatus) => boolean,
  description: string,
  timeoutMs = 240_000,
): Promise<RenderStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: RenderStatus | null = null;
  while (Date.now() < deadline) {
    last = readStatus(id);
    if (last && predicate(last)) {
      return last;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${description}; last status.json was ${JSON.stringify(last)}`,
  );
}

/**
 * Writes the render lock, as if a job owned by `pid` were running.
 *
 * With `process.pid` the lock looks live, which lets route tests reach
 * decisions that sit in front of the worker: without it, an accepted render
 * request would spawn a real browser render. With an impossible pid it is what
 * a killed worker or a reboot leaves behind.
 */
/** Where the one render lock lives: beside the project folders, not inside one. */
export function lockFilePath(): string {
  return path.join(projectsRoot(), LOCK_FILENAME);
}

/** The lock as it is on disk, without the app's liveness reading. */
export function readLockFile(): { pid: number; projectId: string } | null {
  try {
    return JSON.parse(fs.readFileSync(lockFilePath(), 'utf8')) as { pid: number; projectId: string };
  } catch {
    return null;
  }
}

export function writeLock(id: string, pid: number): void {
  const file = lockFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        projectId: id,
        projectDir: projectFiles(id).dir,
        pid,
        startedAt: Date.now(),
      },
      null,
      2,
    )}\n`,
  );
}

/** A pid that cannot belong to a process: above any Linux pid_max. */
export const IMPOSSIBLE_PID = 1_073_741_824;

export function releaseLock(): void {
  fs.rmSync(lockFilePath(), { force: true });
}

/* ─────────────────────────────── ffprobe ────────────────────────── */

export type VideoInfo = {
  codec: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  byteSize: number;
};

/** What is on disk, as a viewer would receive it. */
export async function ffprobe(file: string): Promise<VideoInfo> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,r_frame_rate,duration',
        '-of',
        'json',
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`ffprobe exited ${code}: ${err.trim()}`));
      }
    });
  });

  const parsed = JSON.parse(stdout) as {
    streams: { codec_name: string; width: number; height: number; r_frame_rate: string; duration: string }[];
  };
  const stream = parsed.streams[0];
  if (!stream) {
    throw new Error(`ffprobe found no video stream in ${file}`);
  }
  const [numerator, denominator] = stream.r_frame_rate.split('/').map(Number);
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    fps: denominator ? numerator / denominator : numerator,
    durationSeconds: Number(stream.duration),
    byteSize: fs.statSync(file).size,
  };
}

/**
 * How many frames the file actually holds.
 *
 * Counted as packets, not decoded: a `-c copy` join keeps one packet per frame,
 * so this is the frame count a player would present without paying for a decode
 * of the whole video.
 */
export async function frameCount(file: string): Promise<number> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`ffprobe exited ${code}: ${err.trim()}`));
      }
    });
  });

  const parsed = JSON.parse(stdout) as { streams: { nb_read_packets: string }[] };
  const stream = parsed.streams[0];
  if (!stream) {
    throw new Error(`ffprobe found no video stream in ${file}`);
  }
  return Number(stream.nb_read_packets);
}
