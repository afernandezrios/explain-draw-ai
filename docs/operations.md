# Operations: running, configuring and testing

This document covers what it takes to run Explain-Draw AI, where its state
lives, how it is tested, and what is currently known to be outstanding.

## What the machine needs

- **Node 24 and npm.** The render worker is TypeScript executed directly by
  Node, so the runtime is a hard requirement rather than a preference.
- **ffmpeg and ffprobe on the path.** The worker measures every narration and
  every clip with them before joining. A missing tool is reported at startup.
- **A model endpoint.** Any OpenAI-compatible chat endpoint; the defaults point
  at DeepSeek.
- **A headless browser** for rendering. It is downloaded into a cache on the
  first render, so the first render needs network and takes noticeably longer.
- **Network on first use** for three things: the headless browser, the local
  voice model (~90 MB), and the two font families (Inter and JetBrains Mono)
  that a still or a render fetches from Google's font CDN the first time either
  runs in a process. Afterwards, narration and rendering are offline.
- **On WSL2**, Chrome's shared libraries usually need installing by hand; the
  README lists the packages, and a render that dies with a missing-library
  error should be checked against that list first.

The resource budget assumes a **single-user laptop** (the project targets a
7.6 GiB machine): one render at a time, one voice synthesis at a time, and a
fixed, deliberately low frame-level concurrency that is not a supported
setting to raise.

## Configuration

Configuration is read from a local environment file by the **web server only**:

| Setting | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | Model access; its absence is a clear user-facing error | — (required) |
| `OPENAI_BASE_URL` | The model endpoint | DeepSeek's endpoint |
| `OPENAI_MODEL` | The model name | `deepseek-v4-flash` |
| `LLM_THINKING_MODE` | Thinking mode for storyboard calls; off is faster and cheaper but measurably less compliant | on |
| `PROJECTS_DIR` | Where project folders are written | `./projects` |
| `KOKORO_VOICE` | The narration voice; an unknown name fails fast with the valid list | `af_heart` |
| `KOKORO_MODELS_DIR` | Where the voice model is downloaded; a relative path resolves against the repository root | `./models` |
| `LOG_FILE` | The application log file | `./logs/app.log` |

**The most common operational surprise:** the two narration settings are read
by the **render worker**, not by the web server. When the application starts a
render it passes its environment on, so app-started renders see them — but a
render started by hand from a terminal does **not** read the environment file.
Export the narration settings in that shell first:

```bash
export KOKORO_MODELS_DIR=$HOME/kokoro-models
npm run render -- --project projects/<id>
```

The environment file is gitignored; a template ships with the repository.

## Running it

```bash
npm install
cp .env.local.example .env.local     # then put your key in it
npm run dev                          # http://localhost:3000
```

Paste a topic, press Generate, review the script and board, then Render. The
page is keyed by `/?project=<id>`, so a reload or a bookmark comes back to the
same project.

A render can also be started from a terminal, which is useful for long runs:

```bash
npm run render -- --project projects/<id>            # whole video
npm run render -- --project projects/<id> --scene 3  # one scene as a preview
```

Both entry points obey the same single-render lock, so a command-line render
and an application render exclude each other, and Cancel in the browser can
stop a render started in a terminal.

## What is on disk

A project is a folder. After working with a project it contains:

| Artifact | What it is |
|---|---|
| The input file | The paste, kept as the record of what was asked |
| The script file | Title plus body text |
| The storyboard file | The validated scene list — the render input |
| `narration/` | One WAV per scene; never pruned |
| `clips/` | One numbered clip per scene, narration baked in; kept after the join |
| `preview.mp4` | The most recent single-scene preview |
| `out.mp4` | The finished video |
| `render.log` | The worker's output for the most recent job, truncated at job start |
| `status.json` | The live render state |

The render lock — `.active-render.json` — lives **beside** the project folders,
never inside one, so projects can be copied, archived or deleted independently.
It is the application's only cross-project state.

Anything derived can be regenerated from the two documents; the documents are
the creative record.

## Logging

Two logs, with different jobs:

- The **application log** (JSON, one event per line, to standard output and a
  file) records pipeline events and every model request and response — timings,
  outcomes, token usage and a clipped reply excerpt. API keys never pass
  through it. It is best-effort: if the file cannot be opened, it says so once
  and stays silent for the life of the process rather than failing work.
- The **render log** is the worker's own output, captured per job into the
  project folder, so the most recent render is diagnosable after the fact and
  after a server restart.

## Testing posture

The suite is **end-to-end only** — there is no unit-test layer. It runs the
real thing: real ffmpeg, real headless Chrome, real Remotion rendering, real
local speech synthesis. The **only** component replaced with a fake is the
language model, because it is the one unreliable, external dependency. The live
model is never called by tests.

The suite runs **one file at a time** with long timeouts, because two
concurrent renders is exactly what the render lock exists to prevent on a
7.6 GiB machine. It is slow in the way the product is slow.

What it verifies, in functional terms:

- **Generation** — input validation and limits, the "no key" failure leaving
  nothing behind, a model reply that violates the format being rejected with
  per-field errors, a failed second call removing exactly the half-created
  project, the duration window's arithmetic, and the provider contract's
  structure (including that the prompt quotes exactly the caps the validator
  enforces).
- **The API surface** — creating, reading, editing and rebuilding projects;
  the error mapping; the busy-render refusals; and that a failed rebuild leaves
  the previous storyboard untouched.
- **The render lifecycle** — the budget gate on full renders (and the
  single-scene exemption), lock races, cancellation semantics (finished clips
  kept, no video published, a distinct exit code), a killed worker being marked
  failed, and the video route's range-serving behaviour.
- **Real rendering** — codec, canvas, frame rate and duration of the produced
  file; all scene clips present and join temporaries cleaned up; a repeated
  render being byte-identical; and previews never touching the full-render
  clips.

What it deliberately does not cover: provider compliance and the plain-JSON
fallback path against a real endpoint, token/cost accounting, audio quality
(the worker's silence floor and overrun gate are runtime checks), any browser
or UI behaviour (handlers are exercised as functions; there is no page test),
real concurrency races (simulated deterministically), environment
prerequisites (missing ffmpeg/browser/network), and no publishable-length video
is ever rendered — the tests use the shortest legal storyboard.

**The suite and the fixtures are the maintainer's step.** In this project's
workflow, specs routinely freeze the tests and fixtures and hand the test run
to a human pass. Check before writing or modifying tests as part of a change.

## Known gaps and current state

- **Old projects' storyboards no longer validate.** The typed scene model
  replaced the flat shape vocabulary, so a `scenes.json` written before the
  change fails validation: its Board is refused and it cannot render. The
  remedy is in the app — rebuild the storyboard from the saved script.
- **The test suite and its fixtures predate the current formats.** The canned
  storyboards under the test suite were written for the old shape vocabulary
  and before narration, and its route tests still exercise the retired preview
  route. The maintainer's test pass — updating fixtures and route assertions —
  is outstanding; until it lands, the type check and `npm test` are red. This
  is fixture drift, not a missing capability.
- **The demo video predates the scene-kind visual system.** The `demo.mp4` in
  the repository was recorded with the older whiteboard drawing; the current
  renderer draws the eight typed kinds described in
  [visual-language.md](visual-language.md).
- **Package-manager drift.** The README says npm while the tracked lockfile is
  pnpm's, and the lockfile still lists a dependency that has since been removed
  (the retired hand-drawn renderer's `roughjs`). Refreshing it is deferred work;
  confirm with the maintainer before switching package managers.
- **Narration rate is a measured planning constant.** The words-per-second
  figure behind the storyboard's narration caps was calibrated against the
  bundled voice; if the voice setting changes, the figure should be
  re-measured, because a voice that speaks slower than the plan would push
  otherwise-accepted storyboards into the render-time overrun refusal.
