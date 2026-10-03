# Architecture

Explain-Draw AI is a single-user, local-first application. It has no database,
no queue and no external services beyond the model endpoint it is configured to
call. Its architecture is the shape you get when you take that seriously: state
lives in files, long work happens in a separate process, and one contract is
shared by everything that reads or writes it.

## Three consumers, one contract

The system has three parts, and understanding the product means understanding
why they are separate:

1. **The web application** — a browser page and the API it talks to. It accepts
   the input, shows the script and storyboard, starts renders, and serves the
   finished video. It never draws a frame itself.
2. **The render worker** — a separate operating-system process that turns a
   validated storyboard into a video file. It owns the expensive work: speaking
   the narration, running a headless browser, drawing every frame, and joining
   the result with ffmpeg.
3. **The composition** — the drawing program the worker renders. It is built
   from one choreographed component per scene kind, and turns a scene plus a
   point in time into the picture that belongs on screen at that moment.

The three never share memory and never call each other's code directly. What
they share is the **storyboard contract**: the web application writes a
storyboard to disk, the worker reads it back and refuses to draw one that does
not satisfy the contract, and the composition draws exactly the vocabulary the
contract defines. Because the contract is the interface, a storyboard is a
plain file that can be inspected, edited by hand and re-rendered.

Two constraints follow from this and are worth preserving:

- **The worker is a separate process on purpose.** Rendering takes minutes.
  Doing it inside a request handler would block the server, leave no way to
  cancel, and make a browser refresh lethal to a running render. As a process,
  it can be spawned, watched, killed and diagnosed independently — and it can
  also be run by hand from a terminal, which the product supports.
- **Long work reports through files, not through connections.** The worker
  writes its live state and its human-readable output into the project folder,
  so progress survives a page reload, a server restart, and even the worker
  being killed outright. Nothing important is only in a socket.

## Project state is a folder

A project is a folder under the configured projects directory. Nothing indexes
projects; the folder *is* the record. Inside it:

| Artifact | What it is |
|---|---|
| The pasted input | What the user asked to explain |
| The script | The editable narrative, stored as data |
| The storyboard | The validated scene list — the render input |
| Narration audio | One spoken track per scene |
| Scene clips | One finished video clip per scene, each with its audio already baked in |
| The preview | One scene rendered fully, for the user to check before committing to a full render |
| The finished video | All scene clips joined into the deliverable |
| The render log | The worker's own output for the most recent job |
| The status | The live state of the current job |

Derived files (narration, clips, and the outputs) can always be regenerated
from the two documents; the documents are the creative record.

Three file-handling principles run through the whole system:

- **Writes are atomic.** Every write goes to a temporary name and is renamed
  into place, so a reader never sees a half-written document and an interrupted
  write never corrupts a previous one. This is what lets the worker publish
  progress continuously without the page ever catching it mid-write.
- **Outputs are rendered under a temporary name and renamed into place.** A
  cancelled or crashed render therefore never leaves behind a truncated video
  that looks finished.
- **A failed step leaves the last good state intact.** A failed storyboard
  rebuild leaves the previous storyboard untouched; a failed preview leaves the
  previous preview untouched. There is no window in which an artifact is
  missing because a newer version failed.

## One render at a time

The machine is assumed to be a laptop with a fixed memory budget, so the system
enforces a single global rule: **at most one render may exist at a time, across
every entry point.** A render started from the browser and a render started
from a terminal mutually exclude.

The mechanism is a single small lock file kept in the projects directory — the
application's only piece of cross-project state. Its behaviour defines much of
the product's operational feel:

- Starting a render claims the lock on behalf of the worker process that was
  spawned for it.
- A render started elsewhere is detected, and the browser can cancel it: cancel
  is addressed to the lock, not to a particular page or process.
- A lock whose owning process no longer exists is recognized as stale and
  reclaimed, so a crashed or killed render never wedges the product.
- A finished job's late exit signal must not be mistaken for a newer job's
  outcome — jobs are identified by the process they belong to, and only ever
  speak for themselves.

## How the pieces talk

**The web application's API is thin.** The routes accept requests, hand them to
the pipeline, and translate the result into HTTP. Orchestration and validation
live outside the routes so that everything interesting can be exercised
directly. Failures travel as data — a code, a human-readable message, and
optionally per-field details — and there is exactly one mapping from a pipeline
failure onto an HTTP status. Two mappings would be two places for a status
code to drift.

**The model is a replaceable boundary.** Generation happens through a single
interface which the real client implements and the test suite fakes; everything
behind that line — validation, file writing, rendering, ffmpeg — is real in
tests as in production. This is why the test suite can verify the product's
real behaviour without calling an external model.

**The pipeline is three named steps** — text to script, script to storyboard,
storyboard to video. The first two are model calls; the third is the worker.
Everything else in the codebase exists to serve, validate, draw or report on
those three steps.

## Read paths are identical

A storyboard that came from the model, one that was hand-edited on disk, and one
that was generated last month are all read the same way: check structure, then
apply the whole-scene rules. Every read path runs those two steps in that
order, including the renderer immediately before drawing.

That is a deliberate consistency guarantee rather than a convenience:

- a complaint about counts or budgets is only ever raised against a scene that
  already has the right shape;
- a hand-edited storyboard is judged exactly like a generated one;
- the worker never draws something the application would have refused.

A storyboard written before the typed scene model — under the old shape
vocabulary — simply fails this check, which is why such projects must have
their storyboard rebuilt in the application before they can render again.

## One place where scenes become pictures

The Board's preview and the worker's frames are produced by the **same
composition**. The preview is not a drawing of its own: the server renders the
composition's own last frame to a still image through the same player the
worker uses, and the worker renders every frame of the same composition with
the same components and fonts. There is no second implementation to drift: the
picture the user approves is a frame of the video, not an approximation of it.

## Configuration and environment

Configuration is split by which process needs it:

- The **web server** reads its environment from a local configuration file:
  the model endpoint (key, base address, model name), where projects are
  stored, and the text-to-speech settings.
- The **worker** does not read that file itself. When the application spawns it,
  the application passes its environment on; when a render is started by hand
  from a terminal, the operator must export the narration settings in that
  shell.

This asymmetry is the most common operational surprise in the project and is
called out again in [operations.md](operations.md).

## Where things live

At the top level, the repository separates the three consumers and the things
they share:

| Location | Role |
|---|---|
| The application directory | The browser page and the API handlers — the user-facing surface |
| The library directory | Everything shared: the storyboard contract, generation, validation, server-side stills, project files, the render lock and status, the narration wrapper |
| The composition directory | The scene-kind components the renderer mounts: the block source for each kind, the shared primitives and helpers they use, and the adapter that translates storyboard scenes into their props |
| The worker script | The render worker's entry point — the only place that imports the narration engine |
| The component-install config | Records the component library, its root and its aliases, so its blocks can be added or refreshed in place |
| The tests directory | End-to-end tests only; there is no unit-test layer |
| The projects directory | Where project folders live (configurable) |

Two rules about this layout are worth knowing because they explain apparent
oddities. First, shared modules are imported with explicit file extensions:
Node runs the worker and the tests directly by stripping types, while the web
bundler accepts the same specifiers. Second, the copied component sources
address each other through a short alias that only exists inside the
composition directory, and webpack does not read the TypeScript compiler's
path mappings — so the alias is registered explicitly for every bundler: the
Studio configuration, and a shared override the worker and the stills route
pass into their own builds. And the narration engine is still imported *only*
by the worker's entry point, so the web server and the drawing program never
drag its native runtime into their bundles.

## The end-to-end flow

```
pasted text
   │
   ▼
[ model ] ──▶ script ──────▶ [ model ] ──▶ storyboard
   │                                          │
   │                                  (structure → rules)
   │                                          ▼
   │                                   validated storyboard
   │                                          │
   │                              ┌───────────┴────────────┐
   │                              ▼                        ▼
   │                        web preview              render worker
   │                      (a frame of the                  │
   │                      composition                      ▼
   │                      itself, as a                scene clips
   │                      still image)           (narration baked in)
   │                                                       │
   │                                                       ▼
   │                                                 joined video
   ▼
project folder: input, script, storyboard, narration, clips, preview, video,
render log, status
```

The next documents go a level deeper into each area: the documents themselves
in [domain-model.md](domain-model.md), how they are produced in
[generation.md](generation.md), how video is produced in
[rendering.md](rendering.md), how scenes become pictures in
[visual-language.md](visual-language.md), and the user-facing application in
[web-application.md](web-application.md).
