# Explain-Draw AI

Paste a topic or an explanation. It becomes a script, a drawn storyboard, and a
~5 minute hand-drawn whiteboard video with spoken narration, all on your own
machine.

Text → LLM (script + scene list) → zod validation → Piper speaks each scene's
narration on this machine → Remotion + rough.js draw each scene with its audio
baked into the clip → ffmpeg joins the scene clips into `out.mp4`.

## What you need

- **Node 24** (the render worker is TypeScript run directly by Node) and npm.
- **ffmpeg** on `PATH` (6.x is fine; `ffmpeg -version` should work), which
  includes **ffprobe** — the worker measures every narration and every clip with
  it before joining them.
- **Python 3 and Piper** for the narration: `pip install piper-tts` puts a
  `piper` command on `PATH`, which the worker runs as a subprocess (nothing of
  it is imported or bundled). Plus one voice model, downloaded once:

  ```bash
  python3 -m venv .venv && . .venv/bin/activate  # keeps pip out of the system Python
  pip install piper-tts
  mkdir -p models
  python3 -m piper.download_voices --data-dir models en_US-lessac-medium
  ```

  That lands `en_US-lessac-medium.onnx` and its `.onnx.json` in `models/`, which
  is the default voice and the default directory (`PIPER_VOICE` and
  `PIPER_MODELS_DIR` override both, see the env table). Synthesis is local and
  offline: the narration never leaves the machine, and a missing Piper or voice
  fails the render with a clear message rather than shipping a silent video.
- **A model endpoint.** The pipeline asks for strict structured outputs first
  (`response_format: json_schema` with `strict: true`), which OpenAI supports.
  Some servers that advertise an "OpenAI-compatible" API reject or ignore that
  field — DeepSeek answers it with HTTP 400. Those endpoints are retried
  automatically in plain JSON mode: the schema goes into the prompt instead, and
  the reply is validated locally against the same schema before anything is
  written. So schema mode is preferred, not required.
- **A headless browser.** The first render downloads Remotion's Chrome Headless
  Shell (a few hundred MB) into its own cache, so the first render needs
  network and takes noticeably longer. On WSL2 you will usually also need Chrome's
  shared libraries:

  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2t64 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
    libgbm1 libcups2 libcairo2 libpango-1.0-0
  ```

  Run as a non-root user. If a render dies with a missing-library error, this
  list is the first thing to check.

## Setup

```bash
npm install
cp .env.local.example .env.local     # then put your key in it
npm run dev                          # http://localhost:3000
```

`.env.local`:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Generate fails with a "set the key" message without it. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Point it at your own endpoint if you have one. Endpoints without strict structured outputs fall back to plain JSON mode automatically. |
| `OPENAI_MODEL` | `gpt-5.6-terra` | Any model your endpoint serves. |
| `PROJECTS_DIR` | `./projects` | Where project folders are written. |
| `PIPER_VOICE` | `en_US-lessac-medium` | The Piper voice. Its `.onnx` file and its `.onnx.json` must both sit in `PIPER_MODELS_DIR`. |
| `PIPER_MODELS_DIR` | `./models` | Where the voice models live. The worker reads `<dir>/<voice>.onnx` from it and hands piper that absolute path; a relative value is resolved against the repo root, not the working directory. |

`OPENAI_API_KEY` and anything in it are read by the Next server only, and
`.env.local` is gitignored.

The `PIPER_*` rows are read by the render *worker*, not by the Next server, so
they reach a render the app starts (the server passes its environment on to the
worker it spawns) but **not** a render you start from your terminal: the worker
does not read `.env.local` itself, so export them in that shell.

```bash
export PIPER_MODELS_DIR=$HOME/piper-voices
npm run render -- --project projects/<id>
```

### Using DeepSeek

DeepSeek works with the fallback: it rejects `json_schema` and supports
`json_object` only.

```
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash     # or deepseek-v4-pro
OPENAI_API_KEY=sk-...
```

Two things that follow from the fallback: each model call is sent twice (the
rejected schema attempt, then the plain-JSON one), so a Generate makes four
requests instead of two — six if the storyboard needs its repair, since that
one is sent twice as well. Each of the rejected attempts fails fast. And those
calls run with DeepSeek's thinking mode on (`LLM_THINKING_MODE=true`), because
v4-flash without it under-produces: storyboards a third of the required length,
shape counts one over the cap. Reasoning tokens come out of the same budget as
the answer, so the fallback's token cap is sized for both; setting
`LLM_THINKING_MODE=false` trades compliance for speed and tokens.

### Where your text goes, and what the network is used for

Two things reach the network, and only two.

- **Your text.** Every Generate sends your pasted text, and every rebuild sends
  your script, to the endpoint in `OPENAI_BASE_URL`. With the default that is
  OpenAI's API; with the DeepSeek settings above, it is DeepSeek's. On an
  endpoint without strict structured outputs, each model call goes out twice —
  the rejected schema attempt and the plain-JSON retry — so the same text is
  sent again with the schema appended.
- **The handwriting font, on every render.** The renderer loads Caveat through
  `@remotion/google-fonts`, which fetches it from Google Fonts while the render
  runs. That request carries no project data, but it does mean rendering is not
  offline: with no network the render fails (loudly, rather than substituting a
  different typeface). The in-app preview is unaffected — it embeds a bundled
  copy of the face.

Nothing else leaves the machine, and your project files are never uploaded.
That includes the narration, which is the question worth answering directly:
Piper runs on this machine, spawning it is the only thing the worker does with
it, and the text it is given stays in that process. The drawing, the encoding
and the join are local too. One exception worth naming: the *first* render
downloads Remotion's Chrome Headless Shell (see above), which is a
several-hundred-megabyte download from Remotion's own CDN.

## Using it

The page keeps the project it is showing in the URL, as `/?project=<id>`. A
reload or a bookmark comes back to the same script, storyboard and videos, and
that is also how you open a project the command line made -- `/api/projects/<id>`
answers for any id under `PROJECTS_DIR`.

1. **Paste** a topic or a block of text, and press Generate. You get a script
   and a storyboard. If the first storyboard breaks one of the scene rules, it
   goes back to the model once with the specific problems named scene by scene
   — you only see an error if the repair fails too.
2. **Read the script.** If the model missed the point, edit it and press
   *Rebuild storyboard*. Note that rebuilding replaces `scenes.json`; a script
   edit on its own does not change the drawing or the video (see the limits
   below).
3. **Look at the storyboard.** Every scene is drawn as it will be rendered.
   Click a scene to enlarge it, and press *Animate this scene* to render it and
   watch it move. That is not a cheap thumbnail: it goes through the same worker
   as the full video, so it pays the same start-up (launching the browser,
   bundling the composition) and then draws the scene at full 1920x1080. On this
   laptop that is roughly half a minute to a minute for a 10-second scene, and it
   is refused with `409 BUSY` while another render is running.
4. **Render the video.** Progress is per scene, and Cancel stops it. Before the
   first frame, the worker speaks every scene's narration with Piper — a minute
   or so for a full video, and the stage is where a render refuses a scene whose
   narration cannot be said in the time that scene is on screen. It is also where
   each scene's length is decided: a clip runs for the narration just spoken plus
   half a second of tail — never under three seconds, never past the storyboard's
   own seconds — so a scene ends with its voice instead of holding silence until
   its storyboard time is up.

## Rendering from the command line

```bash
npm run render -- --project projects/<id>          # whole video
npm run render -- --project projects/<id> --scene 3 # one scene, as a preview
```

The worker validates `scenes.json` against the same schema the app uses and
refuses a full render whose total falls outside 4:30–5:30, so a hand-edited
storyboard cannot produce a video the app would have refused. It exits `0` on
success, `1` on a refusal or failure, and `130` when cancelled.

It also takes the same render lock the app takes (see below), so a command-line
render and an app render can never overlap, and pressing Cancel in the app works
on a render started from your terminal too -- provided the page is already
watching that job. The page takes up a job it did not start only when it loads
the project (open `/?project=<id>` and the status poll picks the running render
up), so a command-line render is cancellable from the browser after a reload.
A command-line render refuses to start, with exit code 1, while another render
is live.

## The API

Everything the page does goes through these routes; they are the same ones a
script can call.

| Route | What it does |
|---|---|
| `POST /api/projects` | `{"input": "..."}` → runs both model calls and creates the project. Returns `{projectId, script, scenes, budget}`. |
| `GET /api/projects/<id>` | Everything the page needs at once: `input`, `script`, `scenes`, `sceneErrors`, `budget`, `status`, `hasVideo`, `hasPreview`, `renderActive`. |
| `PUT /api/projects/<id>/script` | `{"title"?, "text"}` → saves the edited script. |
| `POST /api/projects/<id>/script` | Rebuilds `scenes.json` from the saved script. |
| `POST /api/projects/<id>/render` | No body, or `{}`: render the video. `{"sceneIndex": n}`: render that one scene as `preview.mp4`. Acceptance is `{ok: true, pid, mode}` — `mode` is `"full"` or `"preview"` — and the render itself is then followed through `/status`. |
| `POST /api/projects/<id>/cancel` | Signals that project's worker. Returns `{cancelled}`; `false` means nothing was running. |
| `GET /api/projects/<id>/status` | Polled while rendering: `{status, renderActive, hasVideo, hasPreview, budget}`. |
| `GET /api/projects/<id>/preview-svg?scene=n` | One scene as an SVG, with the font embedded. |
| `GET /api/projects/<id>/video[?kind=preview]` | `out.mp4`, or `preview.mp4` with `kind=preview`. Supports byte ranges. |

Failures are always `{error, code, details?}`. The codes worth handling:

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_JSON` | The body is not JSON, or not a JSON object. |
| 400 | `BAD_INPUT` / `EMPTY_INPUT` / `INPUT_TOO_LONG` | The paste is missing, blank, or over 20,000 characters. |
| 400 | `BAD_PROJECT_ID` | The id is not one the app would create. |
| 400 | `BAD_SCENE_INDEX` / `BAD_SCENE` / `SCENE_OUT_OF_RANGE` | A scene index that is not a non-negative integer, or not in this storyboard. |
| 400 | `BAD_SCRIPT` / `EMPTY_SCRIPT` / `SCRIPT_TOO_LONG` | The edited script is missing, blank, or too long. The title is capped at 160 characters the same way, and reported with the same code. |
| 404 | `NO_PROJECT` / `NO_SCENE` / `NO_VIDEO` / `NO_PREVIEW` | Not there yet — an unknown project (including one asked to render), a scene index inside a storyboard that does not have it, or a video file that exists but is zero bytes. |
| 409 | `BUSY` | Another render is live. One at a time. |
| 409 | `BUDGET` | The storyboard total is outside 4:30–5:30, so a full render is refused. The message carries the computed total. |
| 422 | `INVALID_SCENES` / `INVALID_LLM_JSON` | `scenes.json`, or the model's storyboard, does not match the Scene DSL. `details` lists the offending fields. |
| 422 | `NO_SCENES` | `scenes.json` holds an empty storyboard, so there is nothing to render. |
| 500 | `MISSING_KEY` / `LOCK_FAILED` / `VIDEO_READ_FAILED` / `INTERNAL` | No `OPENAI_API_KEY`; the render lock could not be written (the spawned worker is stopped, not left running); the video file could not be read or streamed; or an unexpected error. |
| 502 | `LLM_REQUEST_FAILED` | The endpoint refused or could not be reached. |
| 416 | — | A byte range that starts at or past the end of the video (RFC 9110). An *invalid* spec, such as `bytes=5-1`, is ignored instead and the whole file is sent with 200. |

## Where things are stored

Everything is a file under `PROJECTS_DIR`. There is no database.

```
projects/<id>/input.txt          what you pasted
              script.json        the editable script
              scenes.json        the validated, laid-out storyboard: narration
                                 plus anchor-resolved geometry (see the layout
                                 note under Limits)
              narration/         one WAV per scene, spoken by Piper: scene-000.wav, ...
              clips/             one MP4 per scene: scene-000.mp4, scene-001.mp4, ...
                                 each carrying its scene's narration as its audio
              preview.mp4        the last single-scene preview
              status.json        live render state, written while rendering
              out.mp4            the joined video
              concat.txt         written for the join, deleted straight after it
              preview-clip.mp4   the preview being drawn, moved to preview.mp4
                                 when it is done; only present mid-preview

projects/.active-render.json  the render lock: which project is rendering, and
                              the worker's pid. This is the app's only
                              cross-project state. A lock whose process is gone
                              is reclaimed automatically, so deleting it by hand
                              is only needed if you delete a project mid-render.
```

Every video file is written to a temporary name and renamed into place once it
is complete, so a cancelled or failed render never leaves a half-written MP4
where a player would find it.

Projects accumulate: nothing prunes them, and `clips/` is never pruned either —
it grows by one file per scene per full render, which is the point (the finished
clips survive a cancel, and you can join them yourself). `narration/` is the same
posture: one WAV per scene, overwritten by the next render that speaks that scene
and never deleted on its own. Delete a folder with `rm -rf` when you are done
with it. If Generate fails after a project folder has been created, the folder is
removed; a failed *storyboard* rebuild leaves both the script and the previous
`scenes.json` exactly as they were.

## Limits and honest notes

- **One render at a time**, across the whole app, enforced by the lock file. A
  second request gets `409 BUSY`. Scene rendering is sequential and frame
  concurrency is fixed at 2, which is what keeps a 7.6 GiB laptop usable during a
  render. There is no setting to raise it, and raising it above 2 is not
  recommended on that machine — the limit exists because of the RAM budget.
- **Cancel keeps the finished clips** in `clips/`, so a rewrite or a hand-made
  join can start from them. It does **not** let a retry resume: pressing Render
  again re-renders every scene from scratch (`overwrite: true`). The clips are a
  starting point for you, not a resume point for the app.
- **The font is fetched at render time.** The renderer loads Caveat through
  `@remotion/google-fonts`, which needs network access on every render, and a
  failed fetch fails that render rather than falling back to a different face.
  The in-app preview does not depend on this: it embeds a bundled copy
  (`public/fonts/caveat-latin-400.woff2`) so it shows the same handwriting
  offline. That file is Caveat under the SIL Open Font License 1.1; the licence
  text ships with it at `public/fonts/OFL.txt`.
- **Editing the script does not invalidate the storyboard.** `scenes.json` and
  any `out.mp4` stay as they were until you rebuild and re-render, so an old
  video can sit next to a newer script. Revision tracking is deferred work.
- **Your input is capped at 20,000 characters.** Generate makes *two* sequential
  model calls (script, then storyboard) — three when the storyboard needs its
  repair. Each HTTP request gets 240 seconds with one retry, and on an endpoint
  without strict structured outputs every model call is two requests, so a
  single Generate can make up to six. A slow endpoint is felt more than once,
  and a bad day for the API is minutes of waiting rather than seconds.
- **The scene caps are the prompt's job, not the grammar's.** A scene must draw
  3–12 shapes, and that limit cannot be enforced by the JSON Schema — the strict
  subset has no array-length keywords. So the caps are stated in the prompt and
  re-stated at its end, and the one repair above is what catches a model that
  overruns them anyway. A storyboard must total 270–330 seconds with
  scenes of 7–20 seconds each; those caps are the model's instructions and are
  re-checked in code, and a total outside the window is sent back for the one
  repair round like any other complaint — the model is told the total it landed
  on, with the script's own word count as the anchor for how long the narration
  should run.
- **There is a layout pass between the model and the board.** The model writes
  the *relationships* — this label names that box, this arrow joins these two
  things — and `src/lib/layout.ts` turns them into pixels: the label is centred
  in its box and shrunk until it fits, the arrow's ends land on the edges of the
  shapes it names, an underline is sized to the words above it, and a stick
  figure's caption is written under its feet. It runs on every path that reads a
  storyboard (generation, the app, the worker), and running it twice changes
  nothing, so a storyboard you edit by hand is laid out the same way a generated
  one is.
  - Anchors are **optional**: a shape that names nothing is drawn exactly where
    the model put it, which is why storyboards written before anchors existed
    still render byte for byte the same.
  - An anchor that **cannot** be resolved — an index pointing at nothing, or at
    a shape it is not allowed to point at — is cleared rather than fatal, and the
    storyboard is drawn as if it had never been written. One repair round asks the
    model to fix it, but a stray index never costs you a storyboard: it is asked
    for once and then accepted as it is. Generating also cannot *fail* on layout.
  - Anchors the layout **can** resolve are kept in `scenes.json`, so the file
    still says what each shape belongs to. One case it resolves but complains
    about: two labels naming the same box, which would be centred on top of each
    other. Both are still centred — a pass that sometimes declined to honour its
    own rule would be harder to predict than one that always does and says when
    the result is a pile-up — and the model is told, once.
  - An X drawn over something broken, cancelled or removed is a `crossOut` shape
    that names its target, rather than two lines the model aims at a shape's
    corners by eye.
  - Figure captions are words on the board like any other and count against the
    same 20-word-per-scene budget as the labels. A caption is not a shape in
    `scenes.json` — it is drawn from the figure — so it never shifts the indices
    the anchors use.
  - Text is measured from a table of Caveat's own glyph widths
    (`src/lib/text-metrics.ts`), generated from the bundled font. Kerning is not
    applied, so a word is measured a little wider than a browser would draw it,
    which errs on the side of fitting rather than overrunning.
- **Not in this build**, by design: music or sound effects, PDF import, concept
  expansion beyond the single script pass, a project list, cloud rendering,
  and auth.
- **Licence:** Remotion is free for individuals and small companies; see
  <https://www.remotion.dev/docs/license>. Remotion is the only dependency with
  a licence worth checking before commercial use.

## Checks

```bash
npm run typecheck   # both tsconfigs: the app and src/remotion
npm test            # e2e suite: FakeLLM, real validation, real renders, real ffmpeg
npm run build       # production build
npx next typegen    # only if typecheck complains about .next/types
```

`npm test` renders real video, so it needs ffmpeg, Chrome and its shared
libraries, plus Piper and a voice model — a render speaks every scene's
narration before it draws anything, so a machine that can render is a machine
with both. It is slow, in the way the product is slow. It uses a temporary
`PROJECTS_DIR` and never touches your projects. Two of the tests are worth
knowing about before you run it:

- One renders the same scene twice and asserts the output is byte-identical,
  which is how the drawing is known to be deterministic rather than merely
  similar.
- One renders a *whole* video — every scene, then the join — and checks
  `out.mp4` with ffprobe (codec, canvas, frame rate, duration, frame count). The
  budget gate means a full render the worker will accept is at least 4:30 long,
  so that test is the slowest thing in the suite by far. It is not skippable by
  accident: the test above it pins the refusal, which is why the 30-second sample
  from the spec can only be rendered one scene at a time.

The suite runs one file at a time on purpose (`fileParallelism: false`): two
renders at once is exactly what the render lock exists to prevent, and the
machine has 7.6 GiB of RAM.
