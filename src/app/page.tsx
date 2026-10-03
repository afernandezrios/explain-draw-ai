'use client';

/**
 * The whole app, on one page.
 *
 * The control room: a toolbar, one banner zone, and three sections that are all
 * visible at once -- Brief and Script stacked in the left column, Take (with
 * its viewfinder HUD) on the right. The sections run in the order the pipeline
 * does: paste, edit the script, render. While a job runs, the controls that
 * would edit what the worker holds are disabled, because there is exactly one
 * render at a time and the worker has its own copy of the scenes. Brief's
 * Generate is not one of them: it creates a new project folder and never
 * touches the open project, so a running render never refuses it.
 *
 * The page never imports the schema module. It only takes types from it, so zod
 * stays out of the browser bundle, and every budget string it prints was
 * formatted by the server.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GenerateMeta } from '../lib/generate.ts';
import { MAX_INPUT_CHARS, MAX_TITLE_CHARS } from '../render/render-config.ts';
import { isTerminal, type RenderStatus } from '../render/render-status.ts';
import type { BudgetCheck, Scene } from '../scenes/schema.ts';

/* ───────────────────────────── wire types ───────────────────────── */

type ApiError = { error: string; code: string; details?: string[] };

type ScriptData = { title: string; text: string };

type ProjectData = {
  projectId: string;
  input: string | null;
  script: ScriptData;
  scenes: Scene[];
  sceneErrors: string[];
  budget: BudgetCheck | null;
  status: RenderStatus | null;
  hasVideo: boolean;
  renderActive: boolean;
};

type StatusData = {
  status: RenderStatus | null;
  renderActive: boolean;
  hasVideo: boolean;
  budget: BudgetCheck | null;
};

/** One row of `GET /api/projects`: a folder's own files, read as a summary. */
type ProjectSummaryRow = {
  id: string;
  title: string;
  createdAt: number | null;
  hasVideo: boolean;
  status: RenderStatus | null;
  renderActive: boolean;
};

/** The three sections of the control room. All of them are always on screen. */
type SectionId = 'brief' | 'script' | 'take';

const SECTION_LABELS: Record<SectionId, string> = {
  brief: 'Brief',
  script: 'Script',
  take: 'Take',
};

/** A message in the banner zone: what it says, where it came from, and how to hide it. */
type Message = {
  key: string;
  severity: 'failure' | 'info';
  body: ReactNode;
  details?: string[];
  origin: SectionId;
  actions?: ReactNode;
  /** When it happened, for the source row's age. Omitted when nothing knows. */
  at?: number;
};

/* ──────────────────────────── small helpers ─────────────────────── */

const POLL_MS = 1200;
/**
 * How stale a "running" status may be before a gone worker means the job is
 * over. The worker rewrites status.json as it draws, and a status write is
 * throttled to 200ms, so this is comfortably longer than any quiet gap.
 */
const STALE_MS = 10_000;
/**
 * Tolerance when deciding whether a status describes the job we just started.
 * The server's clock reading can predate ours by a few milliseconds, but this
 * stays under a second: a wider window would let the *previous* job's outcome
 * (written moments before this one started) be read as this one's.
 */
const START_SKEW_MS = 1000;

function readError(data: unknown): ApiError {
  const candidate = data as Partial<ApiError> | null;
  const details = Array.isArray(candidate?.details)
    ? candidate.details.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  return {
    error: typeof candidate?.error === 'string' ? candidate.error : 'Something went wrong.',
    code: typeof candidate?.code === 'string' ? candidate.code : 'UNKNOWN',
    details,
  };
}

async function sendJson(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data: unknown = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

/* ─────────────────────── feedback formatting ────────────────────── */

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The parenthetical the success notices carry: " (script 4.2s, storyboard 61.8s, model, 12,345 tokens)". */
function metaSuffix(meta: GenerateMeta | undefined): string {
  if (!meta) {
    return '';
  }
  const parts: string[] = [];
  if (meta.scriptMs !== null) {
    parts.push(`script ${formatSeconds(meta.scriptMs)}`);
  }
  parts.push(`storyboard ${formatSeconds(meta.storyboardMs)}`);
  if (meta.model) {
    parts.push(meta.model);
  }
  if (meta.usage.totalTokens > 0) {
    parts.push(`${meta.usage.totalTokens.toLocaleString()} tokens`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** The viewfinder clock: m:ss, or h:mm:ss past an hour. Monospace tabular. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "just now" under a minute, then the elapsed shape. */
function formatAge(ms: number): string {
  return ms < 60_000 ? 'just now' : `${formatElapsed(ms)} ago`;
}

/** A project row's date. The id's stamp is UTC; this shows it in the reader's zone. */
function formatProjectDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The Script section's `8 ¶`: one paragraph per blank-line-separated block. */
function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => block.trim() !== '').length;
}

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
}

/** The footer's resting line: the last outcome, never a stale count. */
function lastOutcomeLine(status: RenderStatus, now: number): string {
  const at = status.finishedAt ?? status.updatedAt;
  const age = formatAge(Math.max(0, now - at));
  if (status.state === 'done') {
    return `Last render finished ${age}`;
  }
  if (status.state === 'cancelled') {
    return `Last render cancelled ${age}`;
  }
  if (status.state === 'failed') {
    const scene =
      status.totalScenes > 0
        ? ` · scene ${Math.min(status.sceneIndex + 1, status.totalScenes)}`
        : '';
    return `Last render failed ${age}${scene}`;
  }
  return '';
}

/**
 * A clock for the strings that print an age -- the elapsed time in the footer,
 * the resting outcome, a message's source row. It ticks only while one of them
 * is on screen: a second while a job runs, half a minute at rest, and never
 * while nothing is being aged. Nothing here animates; the page's only animation
 * is the progress bar.
 */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ─────────────────────────────── icons ──────────────────────────── */

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' | 'down' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'left' ? (
        <path d="M10 3.5L5.5 8l4.5 4.5" />
      ) : direction === 'down' ? (
        <path d="M3.5 6L8 10.5L12.5 6" />
      ) : (
        <path d="M6 3.5L10.5 8L6 12.5" />
      )}
    </svg>
  );
}

function CloseIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/* ────────────────────────────── pieces ──────────────────────────── */

/**
 * The worker's output for a failed render, collapsed behind its own button. It
 * lives in the Take section's foot, and it owns its `open` state, so a new
 * render or project resets it by unmounting.
 */
function RenderLogTail({ lines }: { lines: string[] | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="log-tail">
      <button className="button sm" onClick={() => setOpen((current) => !current)}>
        {open ? 'Hide worker log' : 'Show worker log'}
      </button>
      {open && (
        <pre className="log">
          {lines === null
            ? 'No worker output was captured.'
            : lines.length === 0
              ? 'The worker produced no output.'
              : lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

/** A readout line: values in ink at 600, separated by the mid-dot. */
function Readout({ parts }: { parts: ReactNode[] }) {
  return (
    <p className="section-foot-meta">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="sep"> · </span>}
          <span className="v">{part}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * The Take column's viewfinder line -- the one place the render's own state is
 * read out. While a job runs the dot pulses, REC sits beside it, and the clock
 * ticks; at rest the same line carries the last outcome, dismissible, or just
 * "Idle". It is never announced on a timer: the progress bar's value and the
 * visible text are the state a screen reader reads.
 */
function Hud({
  running,
  text,
  clock,
  cancelling,
  onCancel,
  onDismiss,
}: {
  running: boolean;
  text: string;
  clock: string;
  cancelling: boolean;
  onCancel: () => void;
  onDismiss: (() => void) | null;
}) {
  return (
    <div className={`hud${running ? ' is-live' : ''}`}>
      <i className={`rec-dot${running ? ' is-live' : ''}`} aria-hidden="true" />
      {running && <span className="hud-label">REC</span>}
      <span className="hud-text" title={text}>
        {text}
      </span>
      {running ? (
        <>
          <span className="hud-clock">{clock}</span>
          <button
            className="button-cancel"
            aria-label="Cancel render"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </>
      ) : (
        onDismiss !== null && (
          <button
            className="button-dismiss"
            aria-label="Dismiss render status"
            onClick={onDismiss}
          >
            <CloseIcon size={10} />
          </button>
        )
      )}
    </div>
  );
}

/**
 * The toolbar's projects menu: every folder in the projects root, newest first.
 *
 * It owns its open state and its list fetch; the page supplies the project on
 * screen and the action that opens another. The fetch happens when the panel
 * opens and on Refresh, never on a timer -- the folder only changes when
 * someone makes a project, and the reader is the one who wants to know.
 */
function ProjectsMenu({
  currentId,
  onOpenProject,
}: {
  currentId: string | null;
  onOpenProject: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummaryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { ok, data } = await sendJson('/api/projects', 'GET');
      const list = (data as { projects?: unknown } | null)?.projects;
      if (!ok || !Array.isArray(list)) {
        setFailed(true);
        return;
      }
      setProjects(list as ProjectSummaryRow[]);
      setLoaded(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Outside click and Escape close the panel. The toggle lives inside
  // `rootRef`, so the click that opens the panel cannot also close it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="projects-menu" ref={rootRef}>
      <button
        className="button sm"
        aria-expanded={open}
        aria-controls="projects-panel"
        onClick={() => {
          if (!open) {
            void load();
          }
          setOpen(!open);
        }}
      >
        Projects
        <ChevronIcon direction={open ? 'down' : 'right'} />
      </button>
      {open && (
        <div className="projects-panel" id="projects-panel">
          <div className="projects-head">
            <span className="projects-count">
              {loaded
                ? `${projects.length.toLocaleString()} ${projects.length === 1 ? 'project' : 'projects'}`
                : ''}
            </span>
            <button className="button sm" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {!loaded && loading && <p className="projects-empty">Loading projects…</p>}
          {!loading && failed && (
            <p className="projects-empty">
              Could not read the projects folder.{' '}
              <button className="link" onClick={() => void load()}>
                Try again
              </button>
            </p>
          )}
          {!loading && !failed && loaded && projects.length === 0 && (
            <p className="projects-empty">
              <b>No projects yet.</b> Generate a storyboard and its folder appears here.
            </p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-row${project.id === currentId ? ' is-current' : ''}`}
              aria-current={project.id === currentId ? 'true' : undefined}
              title={project.id}
              onClick={() => {
                setOpen(false);
                onOpenProject(project.id);
              }}
            >
              <span className="project-row-title">{project.title}</span>
              <span className="project-row-meta">
                <span>
                  {project.createdAt !== null ? formatProjectDate(project.createdAt) : project.id}
                </span>
                {project.renderActive && <span className="project-badge-live">rendering</span>}
                {!project.renderActive && project.status?.state === 'failed' && (
                  <span className="project-badge-failed">failed</span>
                )}
                {project.hasVideo && (
                  <span className="project-badge-video">
                    <CheckIcon />
                    video
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── page ───────────────────────────── */

export default function HomePage() {
  const [input, setInput] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [scriptDirty, setScriptDirty] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneErrors, setSceneErrors] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetCheck | null>(null);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [renderActive, setRenderActive] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

  /** The section an action just asked to bring forward, and a nonce so asking
   *  twice in a row re-triggers the flash. Cleared by the effect below. */
  const [flash, setFlash] = useState<{ id: SectionId; n: number } | null>(null);

  const [error, setError] = useState<ApiError | null>(null);
  const [errorOrigin, setErrorOrigin] = useState<SectionId>('brief');
  const [errorAt, setErrorAt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOrigin, setNoticeOrigin] = useState<SectionId>('brief');
  const [noticeAt, setNoticeAt] = useState(0);
  /** Messages the reader has dismissed, by key. Cleared when the project changes. */
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** The footer's resting line, dismissed. */
  const [jobDismissed, setJobDismissed] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** When a worker died unreported, or null. The stamp is the message's identity,
   *  so dismissing one death cannot silence the next. */
  const [workerGone, setWorkerGone] = useState<number | null>(null);
  /** The worker's tail for a failed render: `null` means "could not get it". */
  const [renderLog, setRenderLog] = useState<string[] | null>(null);

  /** Bumped after a job ends so the players reload the new file. */
  const [mediaNonce, setMediaNonce] = useState(0);

  const jobStartedAtRef = useRef<number | null>(null);
  /** Which project the page is showing, so a reload of it keeps dismissals. */
  const openProjectRef = useRef<string | null>(null);
  /**
   * Bumped by "New project". Anything already in flight captured the older
   * value, so it can tell that the page was cleared under it and drop its
   * answer rather than restore the project the reader just left.
   */
  const epochRef = useRef(0);

  /** Every failure names the section it came from and when it arrived. */
  const showError = useCallback((next: ApiError, origin: SectionId) => {
    setError(next);
    setErrorOrigin(origin);
    setErrorAt(Date.now());
  }, []);

  const showNotice = useCallback((text: string, origin: SectionId) => {
    setNotice(text);
    setNoticeOrigin(origin);
    setNoticeAt(Date.now());
  }, []);

  /**
   * Bring a section into view and flash its frame. The scroll happens in the
   * effect so it runs after the DOM has taken whatever change prompted it (a
   * generate swaps Brief into record mode and fills Script, both of which move
   * the target); smoothness comes from the stylesheet's scroll-behavior.
   */
  const scrollToSection = useCallback((id: SectionId) => {
    setFlash({ id, n: Date.now() });
  }, []);

  useEffect(() => {
    if (flash === null) {
      return;
    }
    document.getElementById(`section-${flash.id}`)?.scrollIntoView({ block: 'start' });
    const timer = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(timer);
  }, [flash]);

  const applyProject = useCallback((data: ProjectData) => {
    if (openProjectRef.current !== data.projectId) {
      openProjectRef.current = data.projectId;
      setDismissed([]);
      setJobDismissed(false);
    }
    setProjectId(data.projectId);
    // Reopening a project must restore the text it was made from, or a reload
    // after "Generate" would show an empty box and an unusable Generate button.
    if (typeof data.input === 'string') {
      setInput(data.input);
    }
    setScript(data.script);
    setScriptDirty(false);
    setScenes(data.scenes);
    setSceneErrors(data.sceneErrors);
    setBudget(data.budget);
    setStatus(data.status);
    setRenderActive(data.renderActive);
    setHasVideo(data.hasVideo);
    window.history.replaceState(null, '', `/?project=${data.projectId}`);
  }, []);

  const loadRenderLog = useCallback(async (id: string): Promise<void> => {
    const epoch = epochRef.current;
    try {
      const { ok, data } = await sendJson(`/api/projects/${id}/render-log`, 'GET');
      if (epoch !== epochRef.current) {
        return;
      }
      const lines = (data as { lines?: unknown } | null)?.lines;
      setRenderLog(
        ok && Array.isArray(lines)
          ? lines.filter((line): line is string => typeof line === 'string')
          : null,
      );
    } catch {
      setRenderLog(null);
    }
  }, []);

  const refreshProject = useCallback(
    async (id: string) => {
      const epoch = epochRef.current;
      try {
        const { ok, data } = await sendJson(`/api/projects/${id}`, 'GET');
        if (epoch !== epochRef.current) {
          return;
        }
        if (!ok) {
          showError(readError(data), 'brief');
          return;
        }
        applyProject(data as ProjectData);
        // A reload onto an already-failed render still gets the worker log.
        if ((data as ProjectData).status?.state === 'failed') {
          void loadRenderLog(id);
        }
      } catch (thrown) {
        // Called from the poll and from the mount effect, neither of which can
        // do anything with a rejected promise except lose it.
        if (epoch !== epochRef.current) {
          return;
        }
        showError(
          { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
          'brief',
        );
      }
    },
    [applyProject, loadRenderLog, showError],
  );

  // Reopen the project named in the URL. Done after mount rather than during
  // render so the server-rendered HTML and the first client render agree.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('project');
    if (id) {
      void refreshProject(id);
    }
  }, [refreshProject]);

  /* ───────────────────────────── generate ────────────────────────── */

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, data } = await sendJson('/api/projects', 'POST', { input });
      if (!ok) {
        showError(readError(data), 'brief');
        return;
      }
      const created = data as {
        projectId: string;
        script: ScriptData;
        scenes: Scene[];
        budget: BudgetCheck;
        meta: GenerateMeta;
      };
      // A brand new project: clear anything left over from the previous one.
      setStatus(null);
      setRenderActive(false);
      setHasVideo(false);
      setWorkerGone(null);
      setMediaNonce((n) => n + 1);
      setJobDismissed(false);
      applyProject({
        ...created,
        input,
        sceneErrors: [],
        status: null,
        hasVideo: false,
        renderActive: false,
      });
      showNotice(
        `Storyboard ready: ${created.scenes.length} scenes${metaSuffix(created.meta)}. Check the script, then render.`,
        'script',
      );
      // The generate's own advance: bring Script forward -- it is the cheapest
      // thing to fix, and it gates everything downstream.
      scrollToSection('script');
    } catch (thrown) {
      showError(
        { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
        'brief',
      );
    } finally {
      setGenerating(false);
    }
  }, [applyProject, input, showError, showNotice]);

  /* ────────────────────── input, script, storyboard ───────────────── */

  /** The Brief section's own action once a project exists: a new project, nothing deleted. */
  const startNewProject = useCallback(() => {
    openProjectRef.current = null;
    // Anything in flight from the old project is now stale; this state is the
    // one the reader asked for and must survive whatever lands next.
    epochRef.current += 1;
    setProjectId(null);
    setInput('');
    setScript(null);
    setScriptDirty(false);
    setScenes([]);
    setSceneErrors([]);
    setBudget(null);
    setStatus(null);
    setRenderActive(false);
    setHasVideo(false);
    setWorkerGone(null);
    setRenderLog(null);
    setError(null);
    setNotice(null);
    setDismissed([]);
    setJobDismissed(false);
    scrollToSection('brief');
    window.history.replaceState(null, '', '/');
  }, []);

  /**
   * The projects menu's action: open a folder that already exists.
   *
   * The snapshot path is the one a reload takes (`refreshProject`), and so is
   * the race care: the epoch bump happens first, so everything in flight from
   * the project being left -- the poll, a save, a render start -- drops its
   * answer, while this call's own refresh (captured after the bump) is allowed
   * through. Clearing the state is what stops the old poll outright: its effect
   * re-runs on the cleared status, and a tick still in the air checks before it
   * writes. `projectId` and the URL are left to `applyProject`, their single
   * writer, so a switch that fails leaves the page where it was.
   */
  const openPastProject = useCallback(
    (id: string) => {
      if (id === projectId) {
        return; // already looking at it
      }
      epochRef.current += 1;
      openProjectRef.current = null;
      // No job here is ours: any status the opened project carries is its own
      // latest outcome, so the "is this the job we started" floor must not
      // carry over from a render started before the switch.
      jobStartedAtRef.current = null;
      setInput('');
      setScript(null);
      setScriptDirty(false);
      setScenes([]);
      setSceneErrors([]);
      setBudget(null);
      setStatus(null);
      setRenderActive(false);
      setHasVideo(false);
      setWorkerGone(null);
      setRenderLog(null);
      setError(null);
      setNotice(null);
      setDismissed([]);
      setJobDismissed(false);
      setCancelling(false);
      setMediaNonce((n) => n + 1);
      scrollToSection('brief');
      void refreshProject(id);
    },
    [projectId, refreshProject, scrollToSection],
  );

  const saveScript = useCallback(async (): Promise<boolean> => {
    if (!projectId || !script) {
      return false;
    }
    setSavingScript(true);
    setError(null);
    const epoch = epochRef.current;
    try {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/script`, 'PUT', script);
      if (epoch !== epochRef.current) {
        // The project was left while this was in flight: no state to write and
        // no notice to announce for a script nobody is looking at.
        return false;
      }
      if (!ok) {
        showError(readError(data), 'script');
        return false;
      }
      setScriptDirty(false);
      return true;
    } catch (thrown) {
      // A rejected fetch is a failure like any other, and the caller decides
      // what to do with `false`. Letting it reject instead would leave the
      // "Save" button with an unhandled promise and no message.
      showError(
        { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
        'script',
      );
      return false;
    } finally {
      setSavingScript(false);
    }
  }, [projectId, script, showError]);

  const rebuildStoryboard = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setRebuilding(true);
    setError(null);
    setNotice(null);
    const epoch = epochRef.current;
    try {
      // Save first: rebuilding from the text on screen is what people expect,
      // and an unsaved edit would silently be ignored otherwise.
      if (scriptDirty && !(await saveScript())) {
        return;
      }
      const { ok, data } = await sendJson(`/api/projects/${projectId}/script`, 'POST');
      if (epoch !== epochRef.current) {
        // Left behind while the rebuild ran: its storyboard belongs to the
        // project the reader closed, not to the empty page in front of them.
        return;
      }
      if (!ok) {
        showError(readError(data), 'script');
        return;
      }
      const rebuilt = data as { scenes: Scene[]; budget: BudgetCheck; meta: GenerateMeta };
      setScenes(rebuilt.scenes);
      setSceneErrors([]);
      setBudget(rebuilt.budget);
      showNotice(
        `Rebuilt the storyboard: ${rebuilt.scenes.length} scenes${metaSuffix(rebuilt.meta)}.`,
        'script',
      );
    } catch (thrown) {
      if (epoch !== epochRef.current) {
        return;
      }
      showError(
        { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
        'script',
      );
    } finally {
      setRebuilding(false);
    }
  }, [projectId, saveScript, scriptDirty, showError, showNotice]);

  /* ─────────────────────────────── render ─────────────────────────── */

  const startRender = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setStarting(true);
    setError(null);
    setNotice(null);
    setWorkerGone(null);
    setCancelling(false);
    setRenderLog(null);
    setJobDismissed(false);
    // The job we are about to start; anything older is a previous job's
    // outcome and must not be mistaken for this one's.
    jobStartedAtRef.current = Date.now();
    const epoch = epochRef.current;
    try {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/render`, 'POST');
      if (epoch !== epochRef.current) {
        // The project was left while the worker was being started: its status
        // is not this page's to show.
        return;
      }
      if (!ok) {
        showError(readError(data), 'take');
        return;
      }
      setRenderActive(true);
      setStatus({
        state: 'running',
        pid: 0,
        startedAt: jobStartedAtRef.current,
        updatedAt: jobStartedAtRef.current,
        finishedAt: null,
        sceneIndex: 0,
        totalScenes: scenes.length,
        renderedScenes: 0,
        progress: 0,
        message: 'Starting...',
      });
    } catch (thrown) {
      if (epoch !== epochRef.current) {
        return;
      }
      showError(
        { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
        'take',
      );
    } finally {
      setStarting(false);
    }
  }, [projectId, scenes.length, showError]);

  const cancelRender = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setCancelling(true);
    try {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/cancel`, 'POST');
      if (!ok) {
        showError(readError(data), 'take');
      }
      // Only a cancel that actually signalled a worker keeps the button held: a
      // refused or empty answer means the render is still running (or already
      // over), and the button has to come back rather than sit at
      // "Cancelling..." forever with no way to stop the job.
      if (!ok || (data as { cancelled?: unknown } | null)?.cancelled !== true) {
        setCancelling(false);
      }
    } catch (thrown) {
      // The next poll reports the truth either way -- but the button cannot wait
      // for it, or a cancel that never reached the server is unrecoverable.
      showError(
        { error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' },
        'take',
      );
      setCancelling(false);
    }
  }, [projectId, showError]);

  // Poll while a job is running. Stops on a terminal status, or when the worker
  // is gone and nothing is left that could update the status.
  useEffect(() => {
    const running = renderActive || status?.state === 'running';
    if (!projectId || !running) {
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** One poll. Resolves to whether polling should continue. */
    const pollOnce = async (): Promise<boolean> => {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/status`, 'GET');
      if (stopped) {
        return false;
      }
      if (!ok) {
        return true;
      }

      const snapshot = data as StatusData;
      const next = snapshot.status;
      setRenderActive(snapshot.renderActive);
      setHasVideo(snapshot.hasVideo);
      if (snapshot.budget) {
        setBudget(snapshot.budget);
      }

      if (next) {
        const floor = (jobStartedAtRef.current ?? 0) - START_SKEW_MS;
        // A terminal status from an earlier job is not this job's outcome.
        if (isTerminal(next.state) && next.startedAt >= floor) {
          setStatus(next);
          if (next.state === 'failed') {
            void loadRenderLog(projectId);
          }
          jobStartedAtRef.current = null;
          setMediaNonce((n) => n + 1);
          void refreshProject(projectId);
          return false;
        }
        if (next.startedAt >= floor || next.state === 'running') {
          setStatus(next);
        }
      }

      // No lock and no progress: the worker died without recording anything.
      // Only the API can reclaim the lock, so ask it once more before giving up.
      if (!snapshot.renderActive && (next === null || Date.now() - next.updatedAt > STALE_MS)) {
        setWorkerGone(Date.now());
        setRenderActive(false);
        void loadRenderLog(projectId);
        void refreshProject(projectId);
        return false;
      }

      return true;
    };

    const tick = async (): Promise<void> => {
      let again = true;
      try {
        again = await pollOnce();
      } catch {
        // A poll that failed is not a job that ended -- the network blipped, or
        // the dev server was restarted. Keep polling: stopping here would leave
        // a finished render on screen as "rendering" until the page is reloaded.
        again = !stopped;
      } finally {
        if (again && !stopped) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      }
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [projectId, renderActive, status?.state, refreshProject, loadRenderLog]);

  /* ────────────────────────────── derived ─────────────────────────── */

  const running = workerGone === null && (renderActive || status?.state === 'running');
  const runningScene = status ? scenes[status.sceneIndex] : undefined;
  const inputTooLong = input.length > MAX_INPUT_CHARS;
  const budgetBlocksRender = budget !== null && !budget.ok;
  const progress = Math.max(0, Math.min(1, status?.progress ?? 0));
  const percent = Math.round(progress * 100);
  const hasProject = projectId !== null;
  // A project always shows its input as the record, even with nothing stored in
  // it: `readInput` returns null for a missing file, and a section that fell back
  // to the empty field would offer a Generate that forks a second project folder.
  const recordMode = hasProject;
  const paragraphs = script ? paragraphCount(script.text) : 0;
  const resting = status !== null && isTerminal(status.state);
  /**
   * What the Take section is about: the finished file, or a storyboard a render
   * could make one from. The section's foot reads this, so a project whose
   * scenes.json is unreadable cannot show its finished video above a claim that
   * nothing has been rendered.
   */
  const takeProduced = hasProject && (hasVideo || scenes.length > 0);

  // One clock for every age on screen: a second while a job runs, half a minute
  // while a resting outcome, a failure or a notice is still being shown, and
  // never when nothing is being aged.
  const now = useNow(
    running ? 1000 : resting || error !== null || notice !== null ? 30_000 : null,
  );

  const restingOutcome = resting ? lastOutcomeLine(status, now) : '';

  /**
   * The HUD's line: the running scene while a job runs, else the last outcome,
   * else just Idle. The job bar below 1100px mirrors it, so it never falls off
   * screen mid-render.
   */
  const hudText = running
    ? runningScene
      ? `${Math.min((status?.sceneIndex ?? 0) + 1, status?.totalScenes || 1)}/${
          status?.totalScenes || scenes.length
        } · ${runningScene.title}`
      : (status?.message ?? 'Starting...')
    : restingOutcome !== ''
      ? restingOutcome
      : 'Idle';
  const hudClock = running
    ? formatClock(Math.max(0, now - (status?.startedAt ?? now)))
    : '';

  const messages: Message[] = [];
  if (error) {
    messages.push({
      key: `error:${errorAt}`,
      severity: 'failure',
      body: error.error,
      details: error.details,
      origin: errorOrigin,
      at: errorAt,
      // Retry only makes sense here: with no project yet, the failure was the
      // generate call itself, so trying again is the whole fix.
      actions:
        error.code === 'INVALID_LLM_JSON' && !hasProject ? (
          <button className="button sm" onClick={() => void generate()} disabled={generating || running}>
            Retry
          </button>
        ) : undefined,
    });
  }
  if (notice) {
    messages.push({
      key: `notice:${noticeAt}`,
      severity: 'info',
      body: notice,
      origin: noticeOrigin,
      at: noticeAt,
    });
  }
  if (budget && !budget.ok) {
    messages.push({
      key: `budget:${budget.label}`,
      severity: 'failure',
      body: `${budget.label} A full render is refused until the storyboard is inside the window.`,
      origin: 'take',
    });
  }
  if (sceneErrors.length > 0) {
    messages.push({
      key: `sceneErrors:${sceneErrors.length}:${sceneErrors[0]}`,
      severity: 'failure',
      body: 'The stored storyboard does not match the scene format, so nothing can be rendered.',
      details: sceneErrors,
      origin: 'take',
    });
  }
  if (workerGone !== null) {
    messages.push({
      key: `workerGone:${workerGone}`,
      severity: 'failure',
      body: 'The render worker is no longer running and never reported an outcome. Check the terminal you started the server in. Finished scene clips are kept in the project folder.',
      origin: 'take',
    });
  }
  if (status !== null && status.state === 'failed') {
    messages.push({
      key: `renderFailed:${status.startedAt}`,
      severity: 'failure',
      body: `Render failed: ${status.message ?? 'see the terminal for details'}`,
      origin: 'take',
      at: status.finishedAt ?? status.updatedAt,
    });
  }
  // Dismissals first: a hidden message must not stand in for the section it is
  // no longer speaking for.
  const undismissed = messages.filter((message) => !dismissed.includes(message.key));
  // Then one message per section: the banner names a single origin for each
  // thing it says, so a second message about the same section would point at
  // the same link. A failure outranks a notice -- "Script updated" below a save
  // that failed is worse than saying only the failure.
  const byOrigin = new Map<SectionId, Message>();
  for (const message of undismissed) {
    const shown = byOrigin.get(message.origin);
    if (shown === undefined || (shown.severity === 'info' && message.severity === 'failure')) {
      byOrigin.set(message.origin, message);
    }
  }
  const visibleMessages = [...byOrigin.values()];

  const dismiss = (key: string): void => {
    setDismissed((current) => (current.includes(key) ? current : [...current, key]));
  };

  /* ────────────────────────── the section bodies ─────────────────── */

  const briefBody = (
    <>
      <div className="section-body">
        {recordMode ? (
          <>
            <div className="input-record">
              <div className="input-record-head">
                <b>Recorded input</b>
                {/* The record's own measure, not a field's counter: the same two
                    numbers the counter shows, read as a fact about the record. */}
                <span className="input-record-meta">
                  {input.length.toLocaleString()} characters · {MAX_INPUT_CHARS.toLocaleString()} max
                </span>
              </div>
              <p>{input}</p>
            </div>
            <p className="input-record-foot">
              <b>Read-only.</b> This is the record of what was asked for, not a field. The storyboard
              in front of you was drawn from these words.
            </p>
            <div className="separator-rule">
              <div className="new-project">
                <button
                  className="button"
                  onClick={startNewProject}
                  disabled={running || generating || rebuilding || savingScript}
                >
                  New project
                </button>
                <p className="control-note">
                  <b>Leaves this project behind.</b> Nothing is deleted — the script and video stay
                  in the project folder — but the page starts again from an empty Brief.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="lead">What should this video explain?</p>
            <textarea
              className="textarea"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={7}
              maxLength={MAX_INPUT_CHARS + 1}
              placeholder="How a bill becomes law in the UK..."
              disabled={generating || running}
              aria-label="Topic"
            />
            <div className="field-foot">
              <span className="input-counter">
                {input.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
              </span>
            </div>
            <p className="empty-note">
              <b>First run.</b> Generating creates the project. Script and Take fill in as their
              artifacts are produced.
            </p>
          </>
        )}
      </div>
      {/* Generate is never refused by a running render: it creates a new
          project folder and never touches the open one. */}
      {!recordMode && (
        <div className="section-foot">
          <div className="section-foot-controls">
            <button
              className="button primary lg"
              onClick={() => void generate()}
              disabled={generating || input.trim() === '' || inputTooLong}
            >
              {generating ? 'Generating...' : 'Generate storyboard'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const scriptBody =
    script && hasProject ? (
      <>
        <div className="section-body">
          <label className="field-label" htmlFor="script-title">
            Video title
          </label>
          <input
            id="script-title"
            className="field"
            type="text"
            value={script.title}
            onChange={(event) => {
              setScript({ ...script, title: event.target.value });
              setScriptDirty(true);
            }}
            disabled={running}
            maxLength={MAX_TITLE_CHARS}
          />
          <textarea
            className="textarea script-field"
            value={script.text}
            onChange={(event) => {
              setScript({ ...script, text: event.target.value });
              setScriptDirty(true);
            }}
            disabled={running}
            aria-label="Script text"
          />
        </div>
        <div className="section-foot">
          <Readout
            parts={[
              `${paragraphs} paragraphs`,
              `${wordCount(script.text).toLocaleString()} words`,
              ...(scriptDirty ? ['Unsaved changes'] : []),
            ]}
          />
          <div className="section-foot-controls">
            <button
              className="button primary lg"
              onClick={() =>
                void saveScript().then(
                  (saved) =>
                    saved &&
                    showNotice(
                      `Script updated — ${paragraphs} paragraphs, ${wordCount(script.text).toLocaleString()} words.`,
                      'script',
                    ),
                )
              }
              disabled={running || savingScript || !scriptDirty}
            >
              {savingScript ? 'Saving...' : 'Save'}
            </button>
            <button
              className="button"
              onClick={() => void rebuildStoryboard()}
              disabled={running || rebuilding}
            >
              {rebuilding ? 'Rebuilding...' : 'Rebuild storyboard'}
            </button>
          </div>
          <p className="control-note">
            <b>Save</b> writes the script. <b>Rebuild storyboard</b> saves it first, then regenerates
            the drawing from it — nothing is written until the new storyboard validates.
          </p>
        </div>
      </>
    ) : (
      <>
        <div className="section-body">
          <div className="ghost-paragraphs" aria-hidden="true">
            {[0, 1, 2].map((block) => (
              <div className="ghost-para" key={block}>
                <span className="ghost-line" />
                <span className="ghost-line" />
                <span className={`ghost-line ${block === 2 ? 'is-short' : 'is-med'}`} />
              </div>
            ))}
          </div>
        </div>
        <div className="section-foot">
          <div className="ghost-note">
            <p>
              <b>Nothing written yet.</b> The script comes from the topic you paste in Brief.
            </p>
            <button className="button sm" onClick={() => scrollToSection('brief')}>
              Go to Brief
              <ChevronIcon direction="right" />
            </button>
          </div>
        </div>
      </>
    );

  const takeBody = (
    <>
      {hasVideo && hasProject ? (
        <>
          <div className="video-mat">
            <video
              key={`video-${mediaNonce}`}
              src={`/api/projects/${projectId}/video?v=${mediaNonce}`}
              controls
              playsInline
              aria-label="Finished video"
            />
          </div>
          <div className="video-actions">
            <a className="button sm" href={`/api/projects/${projectId}/video`} download="out.mp4">
              Download out.mp4
            </a>
            <span className="meta">
              Also at <code>projects/{projectId}/out.mp4</code>
            </span>
          </div>
        </>
      ) : (
        <div className="ghost-timeline" aria-hidden="true">
          {[3, 6, 4, 8, 5, 7, 4].map((weight, index) => (
            <span className="ghost-block" key={index} style={{ flexGrow: weight }} />
          ))}
        </div>
      )}
      <div className="section-foot">
        {/* The worker-log tail stays here, collapsed, until Diagnostics takes it over. */}
        {renderLog !== null && <RenderLogTail lines={renderLog} />}
        {takeProduced ? (
          <div className="section-foot-controls">
            <button
              className="button primary lg"
              onClick={() => void startRender()}
              disabled={running || starting || budgetBlocksRender || scenes.length === 0}
            >
              {starting ? 'Starting...' : 'Render video'}
            </button>
          </div>
        ) : (
          <div className="ghost-note">
            <p>
              <b>No take yet.</b> A take needs a storyboard, and a storyboard starts with a topic
              in Brief.
            </p>
            <button className="button sm" onClick={() => scrollToSection('brief')}>
              Go to Brief
              <ChevronIcon direction="right" />
            </button>
          </div>
        )}
      </div>
    </>
  );

  /* ──────────────────────────── the sections ─────────────────────── */

  const briefSection = (
    <section
      id="section-brief"
      className={`section${flash?.id === 'brief' ? ' is-flash' : ''}`}
    >
      <div className="section-head">
        <span className="section-index">1</span>
        <h2 className="section-title">Brief</h2>
        {hasProject && input.length > 0 && (
          <span className="section-count">{input.length.toLocaleString()} ch</span>
        )}
      </div>
      {briefBody}
    </section>
  );

  const scriptSection = (
    <section
      id="section-script"
      className={`section${flash?.id === 'script' ? ' is-flash' : ''}`}
    >
      <div className="section-head">
        <span className="section-index">2</span>
        <h2 className="section-title">Script</h2>
        {hasProject && paragraphs > 0 && <span className="section-count">{paragraphs} ¶</span>}
      </div>
      {scriptBody}
    </section>
  );

  const takeSection = (
    <section
      id="section-take"
      className={`section${flash?.id === 'take' ? ' is-flash' : ''}`}
    >
      <div className="section-head">
        <span className="section-index">3</span>
        <h2 className="section-title">Take</h2>
        {hasProject && hasVideo && (
          <span className="section-count" role="img" aria-label="A take exists">
            <CheckIcon />
          </span>
        )}
      </div>
      <Hud
        running={running}
        text={hudText}
        clock={hudClock}
        cancelling={cancelling}
        onCancel={() => void cancelRender()}
        onDismiss={restingOutcome !== '' && !jobDismissed ? () => setJobDismissed(true) : null}
      />
      {running && (
        <div className="progress-row">
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Render progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <i style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-number">{percent}%</span>
        </div>
      )}
      {takeBody}
    </section>
  );

  /* ─────────────────────────────── view ──────────────────────────── */

  return (
    <div className={`shell${running ? ' is-rendering' : ''}`}>
      <header className="toolbar">
        <i className="app-mark" aria-hidden="true" />
        <h1 className="app-title">Explain-Draw AI</h1>
        {script && hasProject && <span className="project-crumb">{script.title}</span>}
        <ProjectsMenu currentId={projectId} onOpenProject={openPastProject} />
        {projectId !== null && <span className="project-id">{projectId}</span>}
      </header>

      <main className="workspace">
        {visibleMessages.length > 0 && (
          <div className="banner-zone">
            {visibleMessages.map((message) => (
              <div
                key={message.key}
                className={`message${message.severity === 'info' ? ' is-info' : ''}`}
                role={message.severity === 'failure' ? 'alert' : 'status'}
              >
                <svg
                  className="message-icon"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {message.severity === 'failure' ? (
                    <>
                      <path d="M10 2.6L18.4 17.4H1.6z" />
                      <path d="M10 7.6v4.2M10 14.4v.6" />
                    </>
                  ) : (
                    <>
                      <circle cx="10" cy="10" r="7.4" />
                      <path d="M10 9v4.4M10 6.4v.6" />
                    </>
                  )}
                </svg>
                <div className="message-body">
                  <p>{message.body}</p>
                  {/* Any failure that carries per-field detail shows it: the
                      model's bad storyboard (INVALID_LLM_JSON) and the
                      stored one (INVALID_SCENES) are the same list. */}
                  {message.details && message.details.length > 0 && (
                    <ul>
                      {message.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                  <div className="message-source">
                    From{' '}
                    <button className="link" onClick={() => scrollToSection(message.origin)}>
                      {SECTION_LABELS[message.origin]}
                      <ChevronIcon direction="right" />
                    </button>
                    {message.at !== undefined && (
                      <span>
                        · {message.severity === 'failure' ? 'failed' : 'sent'}{' '}
                        {formatAge(Math.max(0, now - message.at))}
                      </span>
                    )}
                  </div>
                </div>
                <div className="message-actions">
                  {message.actions}
                  <button
                    className="button-dismiss"
                    aria-label="Dismiss message"
                    onClick={() => dismiss(message.key)}
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="shell-body">
          <div className="column-left">
            {briefSection}
            {scriptSection}
          </div>
          <div className="column-right">{takeSection}</div>
        </div>
      </main>

      {/* Below 1100px Take can be scrolled off screen mid-render, so the same
          readout sits in a fixed bar at the bottom of the window. Above that
          width the HUD inside the Take section is always in view. */}
      {running && (
        <div className="job-bar">
          <i className="rec-dot is-live" aria-hidden="true" />
          <span className="job-bar-text">{hudText}</span>
          {/* Presentational mirror: the HUD's progressbar is the one the
              accessibility tree reads, even when it is scrolled out of view. */}
          <div className="progress-bar job-bar-progress" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </div>
          <span className="job-bar-clock">{hudClock}</span>
          <button
            className="button-cancel"
            aria-label="Cancel render"
            onClick={() => void cancelRender()}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}
