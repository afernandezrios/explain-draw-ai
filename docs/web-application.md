# The web application

The application is a single page with one visible artifact at a time, wrapped
around the pipeline: paste a topic, review and edit the script, render the
video, download it. It never draws a frame itself and never talks to the model
directly — it is the surface over the pipeline and the watcher of the render
worker.

## The shell

- A **toolbar** names the product and the current project's video title, and
  carries a status pill: *Rendering* (with a pulse) or *Idle*.
- A **sidebar** lists exactly three panes, in pipeline order, always reachable:
  **Input**, **Script**, **Video**. Each shows a small measure of its artifact
  when one exists — characters pasted, paragraphs in the script, and a presence
  mark for the video.
- One **artifact pane** is visible at a time. An empty pane is never a dead end:
  it shows a ghosted hint explaining where its artifact comes from and a way
  back to the Input pane.
- A **message zone** above the pane carries failures and notices, each labelled
  with the pane it came from and how long ago it arrived, individually
  dismissible. A failure outranks an informational notice for the same pane.
- A **job card** at the foot of the sidebar shows the live render: the worker's
  current message, a progress bar, the scene being drawn, elapsed time and a
  Cancel control; when idle it rests with the last outcome and how long ago it
  happened.

The dependency order is the product's grammar: the input gates the script, and
the script gates the video. Nothing downstream can be created without its
upstream document.

## The journey

### 1. Paste and generate

The Input pane invites a topic (placeholder: *"How a bill becomes law in the
UK…"*) and counts characters against the 20,000 limit live. **Generate
storyboard** runs the two model calls — script first, then storyboard — and only
when the script comes back is a project folder created; any later failure
removes exactly that folder, so a failed generate never leaves an empty project
behind. A missing key, empty input or over-long input is refused before
anything is called.

While a generation runs, the page says so; generation is deliberately *not*
blocked by a running render, because it starts an entirely new project and
never touches the open one. On success the page reports the result — scene
count, how long each model call took, the model name, total tokens — clears any
state belonging to a previous project, and advances to the Script pane, which
is the cheapest thing to fix and the thing that gates everything downstream.
There is one inline recovery: if the model returned a storyboard that failed
validation, the failure offers a retry.

### 2. Review and edit the script

The Script pane edits the video title (capped at 160 characters) and the script
text, shows a paragraph-and-word readout and an *Unsaved changes* marker, and
offers two actions:

- **Save** — writes the script back to the project.
- **Rebuild storyboard** — silently saves any unsaved edit first, then runs the
  storyboard model call from the text on screen and replaces the storyboard.
  A rebuild is safe by design: the new storyboard is published only if it
  validates, so a failed rebuild cannot destroy a working one.

Both are refused while *this project* is rendering — the worker holds its own
copy of the storyboard, and letting an edit land mid-render would produce a
video that does not match what is on disk. The refusal applies server-side too,
not just as a disabled button.

### 3. Render

**Render** starts the full job. It is available whenever the pane has something
to render, and refused (server-side as well as by a disabled button) when the
storyboard's total duration is outside the accepted 4:30–5:30 window, or when
no scenes exist. A full render cannot start while any render — this project's
or another's — is in flight; the refusal names the current holder.

The job card then reports the worker's own messages as they happen (*"Preparing
narration…"*, *"Narrating scene 3 of 12…"*, *"Drawing scene 3 of 12…"*,
*"Joining the scenes…"*), progress, and the current scene; **Cancel render**
stops it, and the button stays held only once the server has confirmed a worker
was actually signalled — a refused or empty answer re-enables it, so the user
can never be stuck.

### 4. Watch and download

When a render finishes, the Video pane offers a player, a **Download out.mp4**
button, and the artifact's location on disk. The video is served with byte-range
support so scrubbing works and Safari can start playback; a file that is empty
is treated as *no video*, because an empty file is how a render that died
mid-write would look.

If a render failed with captured worker output, the pane offers a collapsed
**Show worker log** control — the last hundred lines, captured into the project
folder so the failure is diagnosable after the fact and after a server restart.

### Working with an existing project

The page is keyed by URL: `/?project=<id>` restores that project completely —
input, script, storyboard, status, and which artifacts exist. The URL is
replaced rather than pushed, so it never fills browser history.

A project that already exists shows its input as a read-only **Recorded input**
record, with an explicit note that it is a record of what was asked for rather
than a field — so reopening a project shows the original request instead of an
empty box inviting a second project. **New project** starts the pane fresh and
clears the URL but deletes nothing on disk.

## Project identity

A project is a folder, and its id is built from a UTC timestamp, a slug of the
first few words of the input, and a random suffix, with collision handling — so
two generations of the same text in the same second cannot overwrite each
other. Because the id becomes a directory name, it is strictly validated
wherever it appears in a URL: only lowercase letters, digits and hyphens, of a
bounded length, beginning with a letter or digit. Anything else is refused as a
bad request before any filesystem access.

## The API surface

Every endpoint reports failures in one uniform envelope — a human-readable
message, a machine-readable code, and optional per-field details — so the page
can branch on the code and show a list of specific problems when the model
returned something that does not validate.

| Endpoint | Role |
|---|---|
| Create a project | The generate action: input in, script + storyboard + budget verdict + generation metadata out |
| Project snapshot | Everything the page needs to render a project from scratch: input, script, storyboard, validation errors, budget, last status, artifact presence, render ownership |
| Save script | Writes an edited script, with the same length rules the model is held to |
| Rebuild storyboard | Regenerates the storyboard from the saved script (one model call, no new script) |
| Status | The polling endpoint: last status, whether this project owns the current render, artifact presence, budget verdict |
| Start render | Starts the render; takes no body, and all the pre-flight refusals happen here |
| Cancel | Asks to stop this project's render; false simply means it was already over |
| Video | Serves the finished video, with byte ranges; no caching |
| Render log | The tail of the captured worker output |

## Render lifecycle, from the app's side

**Exactly one render at a time, enforced by a shared file.** The lock is not
server memory: each request handler has its own module state and the worker is
a separate process, so only an artifact on disk can be authoritative. The lock
records the worker's process id, the project and its folder, and a start time.

**Spawn, then claim.** If a live job exists the start is refused as busy.
Otherwise the worker is spawned and the lock is immediately claimed with the
worker's own process id — so the lock always carries a real process, and a
worker that finds a lock bearing its own id treats it as its own. If the claim
loses a race, the losing worker is killed rather than left invisible to Cancel.
On success the app writes a running status at once, so a previous job's
finished state cannot flash while the new worker boots.

**Outcome recording is ownership-checked.** When a worker exits, its outcome is
recorded only if the status still belongs to that worker and is not already
terminal. A worker that dies without reporting gets a failure recorded on its
behalf, with the last few lines of its output appended — *"The render worker
exited unexpectedly…"*. A cancelled exit is recognized by its exit code even if
the worker never wrote a status.

**The page distinguishes job generations.** It records when it asked for a job
and accepts a terminal status only if that status began at or after the
request — so a previous job's outcome can never be read as the new job's
result. It also detects a worker that died silently: if polling finds no active
render and the status is missing or older than ten seconds, it concludes the
worker is gone, stops polling, loads the log, and refreshes the project. A
failed poll, by contrast, never ends a job — a network blip or server restart
cannot make a finished render look finished early or a live one look dead.

**Polling stops at a terminal outcome.** While a job runs, the page polls the
status a little more than once a second; on a terminal status it fetches the
full project snapshot (the authoritative truth about artifacts), reloads the
media players, fetches the worker log if the job failed, and stops.

## Business rules to keep in mind

- **Editing is locked during a render of that project.** Save, rebuild and the
  script fields are disabled and server-refused with a conflict. Generating a
  new project is the deliberate exception. Navigating panes, dismissing
  messages, playing and downloading existing media, and cancelling all remain
  available.
- **The budget verdict is phrased entirely on the server.** The browser never
  formats clocks or re-derives the window; it prints the sentence it was given
  and disables rendering when the verdict is negative. A passing budget
  surfaces only by *not* blocking the Render button.
- **A broken storyboard blocks new work, never old artifacts.** If the stored
  storyboard cannot be read as a storyboard, rendering is refused with the
  specific problems listed — but an existing finished video remains playable
  and downloadable.
- **Artifacts are never cached.** The player URLs are re-keyed when a job ends,
  so the page always shows the current artifact rather than a stale one.

Next: how the storyboard documents are produced, in
[generation.md](generation.md); how video is produced, in
[rendering.md](rendering.md); how scenes become pictures, in
[visual-language.md](visual-language.md).
