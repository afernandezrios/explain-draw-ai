# Explain-Draw AI

Paste a topic or an explanation. It becomes a script, a storyboard of clean,
flat diagram scenes, and a ~5 minute explainer video with spoken narration, all
on your own machine.

Text → LLM (script + scene list) → zod validation → Piper speaks each scene's
narration on this machine while Remotion draws the previous scene, the audio
baked into the clip → ffmpeg joins the scene clips into `out.mp4`.

## Demo

`demo.mp4` is a real output of this pipeline, generated from the prompt:

> I want to learn about software system design. Starting from a single
> client/server architecture with a few users to reliable distributed systems
> with millions of users.

[▶ Watch demo.mp4](demo.mp4)

It was recorded before the current visual overhaul, so its scenes are drawn in
the older, rougher style. What you get today is crisper: rounded flat shapes
with pastel fills on a dot grid, an eight-colour palette (`ink`, `accent`,
`emphasis`, `success`, `warn`, `violet`, `teal`, `gray`) and a shape
vocabulary that includes cards, badges, containers and bullet lists alongside
boxes, circles, arrows and stick figures.

## Setup

### What you need

- **Node 24** (the render worker is TypeScript run directly by Node) and npm.
- **ffmpeg** on `PATH`, which includes **ffprobe** — the worker measures every
  narration and every clip with it before joining them.
- **Python 3 and Piper** for the narration:

  ```bash
  python3 -m venv .venv && . .venv/bin/activate  # keeps pip out of the system Python
  pip install piper-tts
  mkdir -p models
  python3 -m piper.download_voices --data-dir models en_US-lessac-medium
  ```

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
| `PIPER_VOICE` | `en_US-lessac-medium` | The Piper voice. Its `.onnx` file and its `.onnx.json` must both sit in `PIPER_MODELS_DIR`. |
| `PIPER_MODELS_DIR` | `./models` | Where the voice models live. A relative value is resolved against the repo root, not the working directory. |

`.env.local` is gitignored.

The `PIPER_*` rows are read by the render *worker*, not by the Next server: a
render the app starts sees them (the server passes its environment on to the
worker it spawns), but a render you start from your terminal does not — export
them in that shell first:

```bash
export PIPER_MODELS_DIR=$HOME/piper-voices
npm run render -- --project projects/<id>
```

### DeepSeek notes

The defaults above are DeepSeek (or use `deepseek-v4-pro`), which rejects
`json_schema` and supports `json_object` only, so every model call is sent
twice — the rejected schema attempt, then the plain-JSON one. Its storyboard
calls run with thinking mode on (`LLM_THINKING_MODE=true`), because v4-flash
without it under-produces short storyboards; set it to `false` for faster,
cheaper calls that are less compliant with the scene rules.
