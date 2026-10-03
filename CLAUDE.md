# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next dev server, http://localhost:3000
npm run typecheck    # tsc over both tsconfigs: the app, and src/remotion separately
npm test             # vitest, tests/e2e only
npm run build        # production build
npx next typegen     # only when typecheck complains about .next/types
npm run render -- --project projects/<id>          # whole video, via the worker
```

There is no unit-test layer; every test is an e2e test in `tests/e2e/` and `npm test` renders **real video** with real ffmpeg, Chrome and Kokoro. It is slow in the way the product is slow, and the full-render test is the slowest thing in the repo by far. Suite-wide settings live in `vitest.config.mts` (`fileParallelism: false` and long timeouts are deliberate — two concurrent renders is what the render lock exists to prevent, on a 7.6 GiB machine).

In this project's workflow the test suite and the fixtures are the maintainer's step: the specs under `_bmad-output/` routinely freeze `tests/` and the fixtures and hand `npm test` to a human pass. Check with the maintainer before writing or modifying tests as part of a feature change.

`pnpm-lock.yaml` is the tracked lockfile, while the README says `npm install` (and `node_modules/` currently carries both npm and pnpm markers). Refreshing the lockfile is tracked as deferred work — confirm with the maintainer before switching package managers.

## Architecture

Three consumers share one contract, and that is the shape of the whole repo:

- **The Next app** (`src/app/`) — API routes plus one client page.
- **The render worker** (`src/render/worker.ts`) — a separate process, spawned by the app or run by hand.
- **The Remotion composition** (`src/remotion/`) — bundled and rendered by the worker; nothing else draws a scene.

All three import the same shared `.ts` modules **directly as `.ts`** (e.g. `import { validateScenes } from '../scenes/schema.ts'`). That is load-bearing, not a style choice: Node 24 runs the worker and the tests via type stripping, and Node requires the extension on relative imports, while webpack/esbuild resolve the same specifier. Never change a relative import to an extensionless one.

There is a second, independent constraint on `src/scenes/schema.ts`: its zod definitions are *also* what generates the JSON Schema sent to the model, and the provider's strict structured-output mode accepts only a subset of JSON Schema. So the root must be an object (hence the `{scenes: [...]}` envelope), `.optional()` must be `.nullable()`, and `.default()` and array `.min()/.max()` are forbidden. Bounds on numbers are the way to constrain things, which is where a scene's duration, a flow's packet count and a diagram edge's endpoints live. Anything the strict subset cannot express (per-kind item counts, the written-word budget, the narration word budget, the topology parent rule, the diagram edge-index rule) is enforced by `superRefine` and stated in the prompt — and the prompt text is *derived* from the constants here (`SCENES_SYSTEM_PROMPT` maps over `SCENE_KINDS`/`SCENE_NOTES` and reads `SCENE_CAPS`), so the prompt and the validator cannot drift. A new kind added to `SCENE_KIND_SPECS` reaches the model automatically, and the exhaustive `SCENE_NOTES`/`SCENE_CAPS` records will not compile until you describe it.

One split in that file looks like duplication and is load-bearing: `SceneShapeSchema` is structure only, and it is what a reply is parsed with, while `SceneSchema` adds the refinements that `validateScenes` applies on this side (and that the worker re-runs via `loadScenes`, the app via `readScenes`). If the envelope carried the refined schema, those refinements would fire during request parsing and reject the reply *before* `generateScenes` could hand the validator's complaints back for its one repair pass — leaving that repair dead code for exactly the failures it exists to fix, and turning a one-word overrun into a discarded storyboard. Keep them apart.

The form actually *sent* is a third one, `ProviderSceneShapeSchema`, derived from the same `SCENE_KIND_SPECS` through `anchoredDeep()` — which strips `.optional()` and re-applies `.nullable()` at every depth, object fields inside arrays included — because a leftover `.optional()` keeps a field out of `required` and hides it from the model entirely. A reply is still parsed with the loose form: the model is asked for the strict shape and forgiven the loose one, which is what keeps a storyboard whose only fault is an omitted `null` from being discarded.

### The pipeline and its seams

`textToScript` → `scriptToScenes` → `scenesToVideo`, all in `src/lib/pipeline.ts`, which also owns project paths and folder creation. The LLM boundary (`src/lib/llm.ts`) is the **only** thing the tests fake; everything behind it — validation, file I/O, rendering, ffmpeg — is real in test as in production.

Two consequences worth knowing before refactoring:

- A Next route module may export only HTTP methods and its route config, so orchestration that a test needs to reach lives in `src/lib/generate.ts`, not in the handler. It takes `llm: Llm = new OpenAiLlm()` as a defaulted parameter (built per call, so constructing it touches neither the network nor the environment) and returns failures as data (`ApiFailure`) rather than an HTTP response.
- `failureFrom()` in `src/lib/http.ts` is the single mapping from thrown `PipelineError`/`LlmError` onto `{error, code, details?}`. Two mappings would be two places for a status code to drift.

### Project state is files, not a database

A project is a folder under `PROJECTS_DIR` (`src/render/render-config.ts` names every file). `status.json` is the worker's live state and the only record of what is happening, precisely because the worker is a separate process that can be killed. Every write goes through `writeJsonAtomic`/`writeTextAtomic` (`src/lib/atomic.ts`, temp name then rename, unique temp names so a throttled progress write cannot interleave with a forced one). Every video is rendered to a temp name and renamed into place, so a cancelled render never leaves a half-written MP4.

`src/render/render-status.ts` holds the status contract and deliberately imports no `fs`, so the browser bundle can share the types. The page (`src/app/page.tsx`) likewise only takes **types** from `schema.ts` — never values — to keep zod out of the browser bundle; every budget string it prints was formatted by the server.

### One render at a time, across every entry point

`projects/.active-render.json` is the app's only cross-project state. The app spawns the worker and *then* claims the lock with the worker's pid (`src/render/render-jobs.ts`); the worker also claims the same lock itself (`src/render/render-lock.ts`), and accepts a lock carrying its own pid. That is why a CLI render and an app render mutually exclude, why pressing Cancel in the browser can stop a terminal-started render, and why a lock whose process is gone is reclaimed on sight. When changing job startup, preserve the ordering and the "only ever speak for the worker you were created for" pid checks — a late exit from an old worker must not stamp `failed` over a newer running render.

### The worker's stage order

validate storyboard → take lock → ensure browser → bundle (overlapped by the first scene's narration) → per-scene render, each overlapped by the next scene's narration → ffprobe each clip → ffmpeg concat `-c copy`. Exit codes: `0` success, `1` refusal/failure, `130` cancelled.

- Narration is synthesized unconditionally, one WAV per scene (`narration/scene-NNN.wav`), never reused from a previous run, and never more than one synthesis at a time: each scene's voice is spoken while the previous scene renders, so each WAV only has to exist before its own scene's `renderMedia` (the bundle symlinks the narration directory as its public dir, so a WAV renamed into place after the bundle is servable; on Windows each post-bundle WAV is copied into the served directory first). Each WAV is ffprobed against its scene's frame-rounded length plus one tolerance constant; an overrun refuses the render rather than speeding the voice up or truncating it — one found mid-run leaves the finished clips on disk, like a cancel.
- Kokoro runs in-process inside the worker only — `src/render/tts.ts` wraps kokoro-js (Apache-2.0) on `@huggingface/transformers`/onnxruntime-node, on the CPU. Only `src/render/worker.ts` imports it: it drags native ONNX code, so the Next server and the composition must never reach it. The q8 Kokoro-82M model (~90 MB) downloads into `KOKORO_MODELS_DIR` on the first narration — that first render needs network the way the font download already does — and there is no subprocess to kill: a cancelled or failed render abandons the in-flight synthesis and exits.
- Audio is baked into each scene clip (`<Audio>` in `src/remotion/Scene.tsx`, `enforceAudioTrack`, `AUDIO_*` constants), never muxed afterwards. The join is `-c copy`, which is only lossless while every clip agrees on codec, pixel format, frame rate, canvas **and** audio parameters — that agreement is the whole reason those constants live together in `src/render/render-config.ts` instead of at each call site. `MAX_FRAME_CONCURRENCY` is pinned at 2 by the RAM budget and is not a supported knob. Frames are captured as JPEG at quality 95 (`JPEG_QUALITY`; measurably cheaper than PNG capture for this content) and encoded h264 CRF 18 preset `medium` — capture and encoder settings like those do not affect the `-c copy` agreement, which is about codec, pixel format, frame rate, canvas and audio parameters only.
- A clip whose loudest sample is at or below `AUDIO_SILENCE_MAX_VOLUME_DB` is refused: an audio stream's presence proves nothing, since `enforceAudioTrack` produces one whether or not anything played.

### The composition is the one place scenes become pictures

`SceneByKind` in `src/remotion/Scene.tsx` dispatches a scene to its kind's block — one component per kind, each a RemotionUI source copied into `src/remotion/` and tracked in `remotion-ui.json`, never an npm dependency. The two exceptions are `scenes/concept/` and `scenes/diagram/`, assembled in-repo from the copied primitives (the registry has no equivalent) — the diagram block draws its boxes itself — rounded rectangles, or the cylinder a node's `shape` asks for — and draws each arrow with `ArrowAnnotate`. `scene-adapters.tsx` is the only thing mapping the DSL's fields onto the blocks' props (theme, accent, per-kind fields), and `Root.tsx` exposes the single composition every render is drawn from.

The copied UI sources import each other through the `@/*` alias, and webpack does not read tsconfig `paths`: the mapping is registered in four places — the root tsconfig, `src/remotion/tsconfig.json`, `remotion.config.ts` for Studio, and `webpackAliasOverride` (`src/render/bundle-config.ts`) for the worker. A new bundling entry point without it fails at bundle time, not at typecheck.

### The model picks a kind; the blocks compute the pixels

A scene names its kind and fills that kind's fields, and that is all the structure there is: no coordinates, no anchors, no board. Where a label sits, how wide a column is and when a line finishes drawing are the block component's business, and each kind's choreography is its own.

The relational rules the model states are two, and both are judged, never repaired: a topology node's `parent` — an index into its own node list, which must name a node listed before it (which is also what makes cycles impossible), with exactly one root — and a diagram edge's `from`/`to` — 0-based indexes into the scene's own box list that must name boxes that exist, with no ordering rule and cycles allowed, because a round trip has no root and no first box. `validateScenes` reports an out-of-order parent, a wrong root count or an arrow pointing at a box that does not exist like any other refinement error.

Timing is derived rather than authored. Each block is handed a `speed` factor from `speedFor()` in `scene-adapters.tsx` — `clamp(nominalSeconds / (0.85 × fittedSeconds), 0.4, 3)` — so the drawing fits the narration's *fitted* duration; the 0.85 leaves room for the block to hold its finished state before the clip ends. `nominalSeconds` is the beat plan's own idea of how long that kind wants to take.

The read paths are two steps, in one order: parse against `ScenesShapeSchema` (structure only) → `validateScenes` (the refinements). Generation (`generateScenes`), the app (`readScenes`) and the worker (`loadScenes`) all do exactly this, so a hand-edited `scenes.json` is judged like a generated one — and there is no third pass that could fix what the refinements refuse: a storyboard written for the old shape vocabulary parses as nothing and is refused, which is why old projects must rebuild their storyboard in the app.

One counting rule worth keeping: `countWrittenWords` counts every word a scene writes on screen — titles, list labels and details, a chart's names and roles, a diagram's box names, notes and arrow labels, a concept's prose — because they all share one face and one budget, and leaving any uncounted would be a way past the cap. The code listing is the deliberate exception: it is the scene's subject rather than its writing, and it is bounded by lines and characters instead.

The faces come from `src/remotion/fonts.ts` — Inter at 400/500/600/700 and JetBrains Mono at 400/500/700, latin, through `@remotion/google-fonts` — loaded behind `delayRender`/`continueRender`, with a failed fetch cancelling the render rather than quietly baking every label in a fallback face. `src/remotion/index.ts` imports it for its side effect only; that import is load-bearing (a tree-shaking change there would silently render every label in a fallback face), and it is why rendering is not offline: the first render in a process fetches the faces from Google's CDN.

## Environment

`.env.local` is read by the **Next server only**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `PROJECTS_DIR`, and the `KOKORO_*` pair. The app passes its environment on to the worker it spawns, so app renders see them — but the worker does **not** read `.env.local` itself, so a render started from your terminal needs `KOKORO_MODELS_DIR`/`KOKORO_VOICE` exported in that shell. Relative `KOKORO_MODELS_DIR` resolves against the project root, not the working directory.

The code's defaults are DeepSeek (`DEFAULT_BASE_URL`/`DEFAULT_MODEL` in `src/lib/llm.ts`), while the README's env table still lists OpenAI's endpoint and model. The code wins; the README row is drift.

DeepSeek rejects the strict `json_schema` mode, so every generate normally pays a rejected request then a plain-JSON retry with the schema in the prompt. The fallback path is expected, not an error path — but it means a Generate makes up to six requests, and each model call disables thinking mode.

## Gotchas

- **Rendering is not offline.** The renderer loads Inter and JetBrains Mono through `@remotion/google-fonts` at render time and fails loudly without network, and the first narration downloads Kokoro's model (see the worker's stage order). `src/remotion/index.ts` imports `fonts.ts` for its side effect only; a tree-shaking change there would silently render every label in a fallback face.
- Two tsconfigs: the root one **excludes** `src/remotion`, which has its own. `npm run typecheck` runs both.
- Route handlers set `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Vitest aliases `next/server` to `next/server.js`: Next ships no `exports` map, so the specifier only resolves when the `.js` is spelled out.
- `NARRATION_WPS = 2.0` in `src/scenes/schema.ts` is a planning rate, not a measurement — accepted storyboards can in principle be refused at render time if the voice speaks slower than it. Piper measured ~3.6 words/s, so the old 2.5 had ~30% of slack; Kokoro's af_heart measured 2.28–3.05 words/s across a real storyboard (mean 2.60) and scenes written to a full 2.5 budget were refused, so the rate was lowered to 2.0 on 2026-10-02 — ~12% under the slowest measured text. Re-measure when `KOKORO_VOICE` changes; the overrun gate and the trim-only fit are the safety net.
- Remotion is the one dependency with a licence worth checking before commercial use; the README links the terms.

## Specs and workflow

Feature work here is spec-driven through BMAD. The artifacts are **gitignored**: specs and implementation notes under `_bmad-output/implementation-artifacts/`, with `_bmad-output/implementation-artifacts/deferred-work.md` listing what is outstanding and known-unfixed. `README.md` is unusually thorough and is the public contract — when behaviour changes, it is part of the change.
