/**
 * The pipeline seams and the project folder.
 *
 * A project is a folder and nothing else -- no database, no index:
 *
 *   <PROJECTS_DIR>/<id>/input.txt     what was pasted
 *                      script.json    the editable script
 *                      scenes.json    the validated storyboard
 *                      clips/         one MP4 per scene
 *                      preview.mp4    one scene, fully drawn
 *                      out.mp4        the concatenated video
 *                      status.json    the live render state
 *
 * `textToScript` and `scriptToScenes` are where the LLM boundary is called;
 * `scenesToVideo` is where the render worker is spawned. Tests drive these
 * directly, with only the LLM faked.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathExists, readJsonFile, writeJsonAtomic, writeTextAtomic } from './atomic.ts';
import type { Llm, Script } from './llm.ts';
import {
  CLIPS_DIRNAME,
  INPUT_FILENAME,
  MAX_INPUT_CHARS,
  OUTPUT_FILENAME,
  PREVIEW_FILENAME,
  SCENES_FILENAME,
  SCRIPT_FILENAME,
  STATUS_FILENAME,
  sceneClipName,
} from './render-config.ts';
import { isRenderStatus, type RenderStatus } from './render-status.ts';
import { validateScenes, type Scenes } from './schema.ts';

export type PipelineErrorKind = 'empty-input' | 'input-too-long' | 'bad-project-id';

export class PipelineError extends Error {
  readonly kind: PipelineErrorKind;

  constructor(kind: PipelineErrorKind, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.kind = kind;
  }
}

/* ─────────────────────────── project paths ──────────────────────── */

/** Project ids become directory names, so they are matched tightly. */
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;

export function isValidProjectId(id: string): boolean {
  return PROJECT_ID_PATTERN.test(id);
}

export function projectsRoot(): string {
  const configured = process.env.PROJECTS_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'projects');
}

/** Throws rather than letting a crafted id escape the projects directory. */
export function projectDir(id: string): string {
  if (!isValidProjectId(id)) {
    throw new PipelineError('bad-project-id', `Not a valid project id: ${id}`);
  }
  return path.join(projectsRoot(), id);
}

export type ProjectFiles = {
  dir: string;
  input: string;
  script: string;
  scenes: string;
  status: string;
  out: string;
  preview: string;
  clipsDir: string;
};

export function projectFiles(id: string): ProjectFiles {
  const dir = projectDir(id);
  return {
    dir,
    input: path.join(dir, INPUT_FILENAME),
    script: path.join(dir, SCRIPT_FILENAME),
    scenes: path.join(dir, SCENES_FILENAME),
    status: path.join(dir, STATUS_FILENAME),
    out: path.join(dir, OUTPUT_FILENAME),
    preview: path.join(dir, PREVIEW_FILENAME),
    clipsDir: path.join(dir, CLIPS_DIRNAME),
  };
}

export function sceneClipPath(id: string, index: number): string {
  return path.join(projectFiles(id).clipsDir, sceneClipName(index));
}

/* ────────────────────────── project folder ──────────────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Creates the folder and writes input.txt. Returns the new project id. */
export function createProject(input: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
  const slug = slugify(input.trim().split(/\s+/).slice(0, 5).join(' ')) || 'project';
  // The stamp only resolves to the second and the slug comes from the input, so
  // two generates of the same text in the same second would otherwise share a
  // folder and overwrite each other's files.
  const suffix = randomBytes(2).toString('hex');
  const root = projectsRoot();

  let id = `${stamp}-${slug}-${suffix}`;
  let attempt = 2;
  while (fs.existsSync(path.join(root, id))) {
    id = `${stamp}-${slug}-${suffix}-${attempt}`;
    attempt += 1;
  }

  const files = projectFiles(id);
  fs.mkdirSync(files.clipsDir, { recursive: true });
  writeTextAtomic(files.input, input);
  return id;
}

/**
 * Removes a project folder. Used when generate fails after creating one.
 *
 * Exactly the project's own directory: never its parent, which is the projects
 * root holding every other project, their finished videos and the render lock.
 */
export function removeProject(id: string): void {
  fs.rmSync(projectFiles(id).dir, { recursive: true, force: true });
}

export function readInput(id: string): string | null {
  try {
    return fs.readFileSync(projectFiles(id).input, 'utf8');
  } catch {
    return null;
  }
}

export function readScript(id: string): Script | null {
  return readJsonFile<Script>(projectFiles(id).script);
}

export function writeScript(id: string, script: Script): void {
  writeJsonAtomic(projectFiles(id).script, script);
}

export function writeScenes(id: string, scenes: Scenes): void {
  writeJsonAtomic(projectFiles(id).scenes, scenes);
}

/** Re-validates the stored storyboard, so a hand-edited file cannot slip past. */
export function readScenes(
  id: string,
): { ok: true; scenes: Scenes } | { ok: false; errors: string[] } {
  const raw = readJsonFile<unknown>(projectFiles(id).scenes);
  if (raw === null) {
    return { ok: false, errors: ['scenes.json is missing or not valid JSON'] };
  }
  return validateScenes(raw);
}

export function readStatus(id: string): RenderStatus | null {
  const raw = readJsonFile<unknown>(projectFiles(id).status);
  return isRenderStatus(raw) ? raw : null;
}

export function hasVideo(id: string): boolean {
  return pathExists(projectFiles(id).out);
}

export function hasPreview(id: string): boolean {
  return pathExists(projectFiles(id).preview);
}

/* ────────────────────────────── seams ───────────────────────────── */

export async function textToScript(input: string, llm: Llm): Promise<Script> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new PipelineError('empty-input', 'Paste some text or a topic to explain first.');
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new PipelineError(
      'input-too-long',
      `That input is ${trimmed.length.toLocaleString()} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString()}. Trim it down and try again.`,
    );
  }
  return llm.generateScript(trimmed);
}

export async function scriptToScenes(script: Script, llm: Llm): Promise<Scenes> {
  return llm.generateScenes(script);
}

/** Lines of recent worker output, for reporting a failure. */
export type RenderHandles = {
  child: ChildProcess;
  logTail: () => string[];
};

export type RenderSpawnOptions = {
  projectId: string;
  /** Set to render a single scene for the preview; omit for the full video. */
  sceneIndex?: number;
  statusPath: string;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError: (error: Error) => void;
};

const WORKER_SCRIPT = path.join('scripts', 'render-worker.ts');

/**
 * Spawns the render worker.
 *
 * The worker is a separate process on purpose: bundling and rendering inside a
 * route handler would block the server and leave no way to cancel. Its pipes
 * are drained here -- an unread pipe eventually blocks the child.
 */
export function scenesToVideo(options: RenderSpawnOptions): RenderHandles {
  const args = [
    path.join(process.cwd(), WORKER_SCRIPT),
    '--project',
    projectDir(options.projectId),
    '--status',
    options.statusPath,
  ];
  if (options.sceneIndex !== undefined) {
    args.push('--scene', String(options.sceneIndex));
  }

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const log: string[] = [];
  const collect = (chunk: Buffer): void => {
    for (const line of chunk.toString().split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        log.push(trimmed);
      }
    }
    if (log.length > 40) {
      log.splice(0, log.length - 40);
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  // A failed spawn emits 'error' and never 'exit'; without this listener that
  // error event would be unhandled and take the server down with it.
  child.on('error', options.onError);
  // 'close', not 'exit': 'exit' can fire while the pipes still hold the worker's
  // last lines, and those are exactly the lines a failure report is built from.
  // 'close' waits for the streams, so `logTail()` has the whole story.
  child.on('close', options.onExit);

  return { child, logTail: () => [...log] };
}
