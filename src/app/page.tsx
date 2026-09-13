'use client';

/**
 * The whole app, on one page.
 *
 * Four steps, in the order the pipeline runs: paste, edit the script, look at
 * the storyboard, render. Only the storyboard is interactive during a render;
 * everything else is disabled while a job runs, because there is exactly one
 * render at a time and the worker holds its own copy of the scenes.
 *
 * The page never imports the schema module. It only takes types from it, so zod
 * stays out of the browser bundle, and every budget string it prints was
 * formatted by the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_INPUT_CHARS, MAX_TITLE_CHARS } from '../lib/render-config.ts';
import { isTerminal, type RenderStatus } from '../lib/render-status.ts';
import type { BudgetCheck, Scene } from '../lib/schema.ts';

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
  hasPreview: boolean;
  renderActive: boolean;
};

type StatusData = {
  status: RenderStatus | null;
  renderActive: boolean;
  hasVideo: boolean;
  hasPreview: boolean;
  budget: BudgetCheck | null;
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
  const [hasPreview, setHasPreview] = useState(false);
  const [selected, setSelected] = useState(0);

  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [workerGone, setWorkerGone] = useState(false);

  /** Bumped after a job ends so the players reload the new file. */
  const [mediaNonce, setMediaNonce] = useState(0);
  /** Bumped when the storyboard changes so the thumbnails refetch. */
  const [sceneNonce, setSceneNonce] = useState(0);

  const jobStartedAtRef = useRef<number | null>(null);

  const applyProject = useCallback((data: ProjectData) => {
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
    setHasPreview(data.hasPreview);
    setSelected((current) => Math.min(current, Math.max(0, data.scenes.length - 1)));
    window.history.replaceState(null, '', `/?project=${data.projectId}`);
  }, []);

  const refreshProject = useCallback(
    async (id: string) => {
      try {
        const { ok, data } = await sendJson(`/api/projects/${id}`, 'GET');
        if (!ok) {
          setError(readError(data));
          return;
        }
        applyProject(data as ProjectData);
      } catch (thrown) {
        // Called from the poll and from the mount effect, neither of which can
        // do anything with a rejected promise except lose it.
        setError({
          error: thrown instanceof Error ? thrown.message : String(thrown),
          code: 'NETWORK',
        });
      }
    },
    [applyProject],
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
        setError(readError(data));
        return;
      }
      const created = data as {
        projectId: string;
        script: ScriptData;
        scenes: Scene[];
        budget: BudgetCheck;
      };
      // A brand new project: clear anything left over from the previous one.
      setStatus(null);
      setRenderActive(false);
      setHasVideo(false);
      setHasPreview(false);
      setWorkerGone(false);
      setSelected(0);
      setMediaNonce((n) => n + 1);
      setSceneNonce((n) => n + 1);
      applyProject({
        ...created,
        input,
        sceneErrors: [],
        status: null,
        hasVideo: false,
        hasPreview: false,
        renderActive: false,
      });
      setNotice(
        `Storyboard ready: ${created.scenes.length} scenes. Check the script, then render.`,
      );
    } catch (thrown) {
      setError({ error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' });
    } finally {
      setGenerating(false);
    }
  }, [applyProject, input]);

  /* ───────────────────────── script and storyboard ────────────────── */

  const saveScript = useCallback(async (): Promise<boolean> => {
    if (!projectId || !script) {
      return false;
    }
    setSavingScript(true);
    setError(null);
    try {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/script`, 'PUT', script);
      if (!ok) {
        setError(readError(data));
        return false;
      }
      setScriptDirty(false);
      return true;
    } catch (thrown) {
      // A rejected fetch is a failure like any other, and the caller decides
      // what to do with `false`. Letting it reject instead would leave the
      // "Save script" button with an unhandled promise and no message.
      setError({
        error: thrown instanceof Error ? thrown.message : String(thrown),
        code: 'NETWORK',
      });
      return false;
    } finally {
      setSavingScript(false);
    }
  }, [projectId, script]);

  const rebuildStoryboard = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setRebuilding(true);
    setError(null);
    setNotice(null);
    try {
      // Save first: rebuilding from the text on screen is what people expect,
      // and an unsaved edit would silently be ignored otherwise.
      if (scriptDirty && !(await saveScript())) {
        return;
      }
      const { ok, data } = await sendJson(`/api/projects/${projectId}/script`, 'POST');
      if (!ok) {
        setError(readError(data));
        return;
      }
      const rebuilt = data as { scenes: Scene[]; budget: BudgetCheck };
      setScenes(rebuilt.scenes);
      setSceneErrors([]);
      setBudget(rebuilt.budget);
      setSelected(0);
      setSceneNonce((n) => n + 1);
      setNotice(`Rebuilt the storyboard: ${rebuilt.scenes.length} scenes.`);
    } catch (thrown) {
      setError({ error: thrown instanceof Error ? thrown.message : String(thrown), code: 'NETWORK' });
    } finally {
      setRebuilding(false);
    }
  }, [projectId, saveScript, scriptDirty]);

  /* ─────────────────────────────── render ─────────────────────────── */

  const startRender = useCallback(
    async (sceneIndex?: number) => {
      if (!projectId) {
        return;
      }
      setStarting(true);
      setError(null);
      setNotice(null);
      setWorkerGone(false);
      setCancelling(false);
      // The job we are about to start; anything older is a previous job's
      // outcome and must not be mistaken for this one's.
      jobStartedAtRef.current = Date.now();
      try {
        const body = sceneIndex === undefined ? {} : { sceneIndex };
        const { ok, data } = await sendJson(`/api/projects/${projectId}/render`, 'POST', body);
        if (!ok) {
          setError(readError(data));
          return;
        }
        setRenderActive(true);
        setStatus({
          state: 'running',
          mode: sceneIndex === undefined ? 'full' : 'preview',
          pid: 0,
          startedAt: jobStartedAtRef.current,
          updatedAt: jobStartedAtRef.current,
          finishedAt: null,
          sceneIndex: sceneIndex ?? 0,
          totalScenes: sceneIndex === undefined ? scenes.length : 1,
          renderedScenes: 0,
          progress: 0,
          message: 'Starting...',
        });
      } catch (thrown) {
        setError({
          error: thrown instanceof Error ? thrown.message : String(thrown),
          code: 'NETWORK',
        });
      } finally {
        setStarting(false);
      }
    },
    [projectId, scenes.length],
  );

  const cancelRender = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setCancelling(true);
    try {
      const { ok, data } = await sendJson(`/api/projects/${projectId}/cancel`, 'POST');
      if (!ok) {
        setError(readError(data));
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
      setError({
        error: thrown instanceof Error ? thrown.message : String(thrown),
        code: 'NETWORK',
      });
      setCancelling(false);
    }
  }, [projectId]);

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
      setHasPreview(snapshot.hasPreview);
      if (snapshot.budget) {
        setBudget(snapshot.budget);
      }

      if (next) {
        const floor = (jobStartedAtRef.current ?? 0) - START_SKEW_MS;
        // A terminal status from an earlier job is not this job's outcome.
        if (isTerminal(next.state) && next.startedAt >= floor) {
          setStatus(next);
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
        setWorkerGone(true);
        setRenderActive(false);
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
  }, [projectId, renderActive, status?.state, refreshProject]);

  /* ────────────────────────────── derived ─────────────────────────── */

  const running = !workerGone && (renderActive || status?.state === 'running');
  const renderingMode = status?.mode === 'preview' ? 'preview' : 'full';
  const currentScene = scenes[selected];
  const inputTooLong = input.length > MAX_INPUT_CHARS;
  const budgetBlocksRender = budget !== null && !budget.ok;
  const progress = Math.max(0, Math.min(1, status?.progress ?? 0));

  /* ─────────────────────────────── view ───────────────────────────── */

  return (
    <main className="wrap">
      <header className="app-header">
        <h1>Explain-Draw AI</h1>
        <p>
          Paste a topic or an explanation. It becomes a script, a drawn storyboard, and a
          five-minute whiteboard video.
        </p>
      </header>

      {error && (
        <div className="banner bad">
          {error.error}
          {/* Any failure that carries per-field detail shows it: the model's bad
              storyboard (INVALID_LLM_JSON) and the stored one (INVALID_SCENES)
              are the same list of offending fields. */}
          {error.details && error.details.length > 0 && (
            <ul>
              {error.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && <div className="banner ok">{notice}</div>}
      {workerGone && (
        <div className="banner warn">
          The render worker is no longer running and never reported an outcome. Check the terminal
          you started the server in. Finished scene clips are kept in the project folder.
        </div>
      )}

      <section className="card">
        <h2>1. What should the video explain?</h2>
        <p className="hint">
          Text or a bare topic. Everything you paste here is sent to the language model configured
          in <code>.env.local</code>.
        </p>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={7}
          maxLength={MAX_INPUT_CHARS + 1}
          placeholder="How a bill becomes law in the UK..."
          disabled={generating || running}
        />
        <div className="row">
          <button
            className="primary"
            onClick={() => void generate()}
            disabled={generating || running || input.trim() === '' || inputTooLong}
          >
            {generating ? 'Generating...' : 'Generate storyboard'}
          </button>
          {/* Retry only makes sense here: with no project yet, the failure was
              the generate call itself, so trying again is the whole fix. */}
          {error?.code === 'INVALID_LLM_JSON' && !projectId && (
            <button onClick={() => void generate()} disabled={generating || running}>
              Retry
            </button>
          )}
          <span className={`counter${inputTooLong ? ' over' : ''}`}>
            {input.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
          </span>
        </div>
      </section>

      {script && projectId && (
        <section className="card">
          <h2>2. The script</h2>
          <p className="hint">
            Edit it and rebuild the storyboard when the model missed the point. The drawing follows
            the rebuilt storyboard, not the text.
          </p>
          <input
            type="text"
            value={script.title}
            onChange={(event) => {
              setScript({ ...script, title: event.target.value });
              setScriptDirty(true);
            }}
            disabled={running}
            maxLength={MAX_TITLE_CHARS}
            aria-label="Video title"
          />
          <div style={{ height: 10 }} />
          <textarea
            className="script"
            value={script.text}
            onChange={(event) => {
              setScript({ ...script, text: event.target.value });
              setScriptDirty(true);
            }}
            disabled={running}
            aria-label="Script text"
          />
          <div className="row">
            <button
              onClick={() => void saveScript().then((saved) => saved && setNotice('Script saved.'))}
              disabled={running || savingScript || !scriptDirty}
            >
              {savingScript ? 'Saving...' : 'Save script'}
            </button>
            <button onClick={() => void rebuildStoryboard()} disabled={running || rebuilding}>
              {rebuilding ? 'Rebuilding...' : 'Rebuild storyboard'}
            </button>
            {scriptDirty && <span className="meta">Unsaved changes</span>}
          </div>
        </section>
      )}

      {budget && (
        <div className={`banner ${budget.ok ? 'ok' : 'bad'}`}>
          {budget.label}
          {!budget.ok && ' A full render is refused until the storyboard is inside the window.'}
        </div>
      )}

      {sceneErrors.length > 0 && (
        <div className="banner bad">
          The stored storyboard does not match the scene format, so nothing can be rendered.
          <ul>
            {sceneErrors.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
      )}

      {projectId && scenes.length > 0 && (
        <section className="card">
          <h2>3. The storyboard</h2>
          <p className="hint">
            Every scene as it will be drawn. Click a scene to enlarge it, or render just that scene
            to watch it at full speed before committing to the whole video.
          </p>

          <div className="strip">
            {scenes.map((scene, index) => (
              <button
                key={`${index}-${scene.title}`}
                className={`thumb${index === selected ? ' active' : ''}`}
                onClick={() => setSelected(index)}
              >
                <img
                  src={`/api/projects/${projectId}/preview-svg?scene=${index}&v=${sceneNonce}`}
                  alt={`Scene ${index + 1}: ${scene.title}`}
                  loading="lazy"
                />
                <span className="cap">
                  <span>
                    {index + 1}. {scene.title}
                  </span>
                  <span>{scene.durationSeconds}s</span>
                </span>
              </button>
            ))}
          </div>

          {currentScene && (
            <>
              <img
                className="board"
                src={`/api/projects/${projectId}/preview-svg?scene=${selected}&v=${sceneNonce}`}
                alt={`Scene ${selected + 1}: ${currentScene.title}`}
              />
              <div className="row between">
                <span className="meta">
                  Scene {selected + 1} of {scenes.length} &middot; {currentScene.title} &middot;{' '}
                  {currentScene.durationSeconds}s &middot; {currentScene.shapes.length} shapes
                </span>
                <span className="row" style={{ marginTop: 0 }}>
                  <button
                    className="ghost"
                    onClick={() => setSelected((current) => Math.max(0, current - 1))}
                    disabled={selected === 0}
                  >
                    Previous
                  </button>
                  <button
                    className="ghost"
                    onClick={() =>
                      setSelected((current) => Math.min(scenes.length - 1, current + 1))
                    }
                    disabled={selected === scenes.length - 1}
                  >
                    Next
                  </button>
                  <button
                    onClick={() => void startRender(selected)}
                    disabled={running || starting}
                  >
                    Animate this scene
                  </button>
                </span>
              </div>
            </>
          )}

          {hasPreview && (
            <div style={{ marginTop: 14 }}>
              <video
                key={`preview-${mediaNonce}`}
                src={`/api/projects/${projectId}/video?kind=preview&v=${mediaNonce}`}
                controls
                playsInline
                aria-label={`Scene ${selected + 1} preview`}
              />
            </div>
          )}
        </section>
      )}

      {projectId && scenes.length > 0 && (
        <section className="card">
          <h2>4. Render the video</h2>
          <p className="hint">
            Scenes are drawn one after another and joined with ffmpeg. Cancel stops the current
            scene; the clips already finished stay in the project folder.
          </p>

          <div className="row" style={{ marginTop: 0 }}>
            <button
              className="primary"
              onClick={() => void startRender()}
              disabled={running || starting || budgetBlocksRender}
            >
              {running && renderingMode === 'full' ? 'Rendering...' : 'Render video'}
            </button>
            {running && (
              <button
                className="danger"
                onClick={() => void cancelRender()}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            )}
            {status?.message && <span className="meta">{status.message}</span>}
          </div>

          {(running || (status && status.mode === 'full' && status.totalScenes > 0)) && (
            <>
              <div
                className="progress"
                style={{ marginTop: 14 }}
                role="progressbar"
                aria-label={renderingMode === 'preview' ? 'Scene preview progress' : 'Render progress'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="meta">
                {status
                  ? `${Math.round(progress * 100)}% - scene ${
                      Math.min(status.sceneIndex + 1, status.totalScenes || 1)
                    } of ${status.totalScenes || scenes.length}`
                  : 'Starting...'}
              </span>
              <div className="chips">
                {scenes.map((scene, index) => {
                  const done = status ? index < status.renderedScenes : false;
                  const current =
                    running && status ? index === status.sceneIndex && !done : false;
                  return (
                    <span
                      key={`${index}-${scene.title}`}
                      className={`chip${done ? ' done' : current ? ' current' : ''}`}
                      title={scene.title}
                    >
                      {index + 1}. {scene.title} {scene.durationSeconds}s
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {status && isTerminal(status.state) && (
            <div className={`banner ${status.state === 'done' ? 'ok' : 'muted'}`} style={{ marginTop: 14 }}>
              {status.state === 'done'
                ? `${renderingMode === 'preview' ? 'Scene preview' : 'Render'} finished.`
                : status.state === 'cancelled'
                  ? 'Render cancelled.'
                  : `Render failed: ${status.message ?? 'see the terminal for details'}`}
            </div>
          )}

          {hasVideo && (
            <div style={{ marginTop: 14 }}>
              <video
                key={`video-${mediaNonce}`}
                src={`/api/projects/${projectId}/video?v=${mediaNonce}`}
                controls
                playsInline
                aria-label="Finished video"
              />
              <div className="row">
                <a
                  className="linkbtn"
                  href={`/api/projects/${projectId}/video`}
                  download="out.mp4"
                >
                  Download out.mp4
                </a>
                <span className="meta">
                  Also at <code>projects/{projectId}/out.mp4</code>
                </span>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
