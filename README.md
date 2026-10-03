# Explain-Draw AI

Paste a topic or an explanation. It becomes a script, a storyboard of clean,
flat diagram scenes, and a ~5 minute explainer video with spoken narration, all
on your own machine.

Text → LLM (script + storyboard of typed scenes) → zod validation → Kokoro
speaks each scene's narration on this machine while Remotion renders the
previous scene on RemotionUI blocks, the audio baked into the clip → ffmpeg
joins the scene clips into `out.mp4`.

## Demo

`demo.mp4` is a real output of this pipeline, generated from the prompt:

> I want to learn about software system design. Starting from a single
> client/server architecture with a few users to reliable distributed systems
> with millions of users.

[▶ Watch demo.mp4](demo.mp4)

It was recorded before the current visual system, so its scenes are drawn in
the older, hand-drawn whiteboard style. What you get today is different in
kind: each scene is one of eight typed kinds — title, points, flow, topology,
diagram, sequence, code, concept — drawn as a flat, modern diagram by its own
choreographed component, on a dark or light page with one of six accent
colours. Every block is a RemotionUI component copied into `src/remotion/` as
source — never imported from a package — with the install tracked in
`remotion-ui.json`. (The concept and diagram blocks are the two exceptions:
assembled in-repo from the copied primitives.)

## Setup

### What you need

- **Node 24** (the render worker is TypeScript run directly by Node) and npm.
- **ffmpeg** on `PATH`, which includes **ffprobe** — the worker measures every
  narration and every clip with it before joining them.
- **Nothing extra for the narration.** Kokoro, the local text-to-speech engine,
  ships with `npm install` (the `kokoro-js` dependency) and runs in-process in
  the render worker. The first narration downloads the quantized Kokoro-82M
  model (~90 MB) into `models/`; after that, narration is offline.
- **The type, on first use.** Every scene is set in Inter and JetBrains Mono,
  loaded at render time through Remotion's Google Fonts integration. A still —
  the Board's preview — or a render fetches them the first time either runs in
  a process, and fails loudly without network.

- **A model endpoint.** The pipeline asks for strict structured outputs first
  (`response_format: json_schema`); endpoints that reject it (DeepSeek answers
  HTTP 400) are retried automatically in plain JSON mode, where the schema goes
  into the prompt and the reply is validated locally.
- **A headless browser.** The first render downloads Remotion's Chrome Headless
  Shell into its own cache, so the first render needs network and takes longer.
  On WSL2 you will usually also need Chrome's shared libraries:

  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2t64 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
    libgbm1 libcups2 libcairo2 libpango-1.0-0
  ```

  Run as a non-root user. If a render dies with a missing-library error, this
  list is the first thing to check.

### Install and run

```bash
npm install
cp .env.local.example .env.local     # then put your key in it
npm run dev                          # http://localhost:3000
```

Open the page, paste a topic, and press Generate — you get a script and a
storyboard; press Render and the worker draws the video scene by scene. The
page shows one project at a time, keyed by `/?project=<id>`, so a reload or a
bookmark comes back to the same project.

### Configuration

`.env.local` (read by the Next server):

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. Generate fails with a "set the key" message without it. |
| `OPENAI_BASE_URL` | `https://api.deepseek.com` | Any OpenAI-compatible endpoint. |
| `OPENAI_MODEL` | `deepseek-v4-flash` | Any model your endpoint serves. |
| `PROJECTS_DIR` | `./projects` | Where project folders are written. |
| `KOKORO_VOICE` | `af_heart` | The Kokoro voice. One of the voices kokoro-js bundles (`af_heart`, `af_bella`, `am_michael`, `bf_emma`, …); an unknown name is refused with the full list. |
| `KOKORO_MODELS_DIR` | `./models` | Where the Kokoro model is downloaded on first use. A relative value is resolved against the repo root, not the working directory. |

`.env.local` is gitignored.

The `KOKORO_*` rows are read by the render *worker*, not by the Next server: a
render the app starts sees them (the server passes its environment on to the
worker it spawns), but a render you start from your terminal does not — export
them in that shell first:

```bash
export KOKORO_MODELS_DIR=$HOME/kokoro-models
npm run render -- --project projects/<id>
```

### DeepSeek notes

The defaults above are DeepSeek (or use `deepseek-v4-pro`), which rejects
`json_schema` and supports `json_object` only, so every model call is sent
twice — the rejected schema attempt, then the plain-JSON one. Its storyboard
calls run with thinking mode on (`LLM_THINKING_MODE=true`), because v4-flash
without it under-produces short storyboards; set it to `false` for faster,
cheaper calls that are less compliant with the scene rules.
