# Rendering: from storyboard to video

Rendering is the expensive half of the product. It runs in a separate process —
the render worker — which can be started by the application or by hand from a
terminal, and which behaves identically either way. This document describes what
a render actually does, what it promises, and what it leaves behind when
something goes wrong.

## Two kinds of job

- **A full render** draws every scene in the storyboard and joins the results
  into the finished video.
- **A preview render** draws exactly one scene, completely, so the user can
  check the look of the video before committing to a full render.

A preview deliberately skips the total-length check that a full render
enforces, so a storyboard that is still being brought into the five-minute
window can still be inspected. Either job writes the same progress record in
the same format, tagged with its mode.

## A full render, stage by stage

### 1. Pre-flight: nothing starts on a storyboard that cannot be drawn

Before the worker claims anything or writes anything, it re-reads the storyboard
from the project folder and puts it through the same two steps every reader
uses: check its structure, then apply the whole-scene rules. A missing,
unreadable, empty or invalid storyboard is refused with the problems listed (up
to eight of them), and nothing is written — not even a status file, so a
previous job's outcome stays visible for diagnosis.

A full render additionally refuses a storyboard whose total duration falls
outside the accepted four-and-a-half to five-and-a-half-minute window, telling
the operator the total and the bound and to regenerate the storyboard. This is
the same window the application reports at review time; the worker is the last
line of defence.

### 2. Claim the single-render lock

Rendering is exclusive across the whole machine: the browser and the worker
agree on one lock, so an app-started render and a terminal-started render can
never run at once. Claiming happens before any file is written. If a live
render already holds the lock, the new worker stands down and deliberately
writes nothing — the lock holder may be rendering this very project, and
stamping a failure over live progress would be worse than silence.

The lock, its staleness rules and how Cancel reaches renders started elsewhere
are described in [architecture.md](architecture.md).

### 3. Write the running status

A status record is created in the project folder describing a running job: its
mode, the worker's process identity, timestamps, the scene counters, progress,
and an opening human-readable message. From this point on, the status record is
the single source of truth for what is happening — which matters precisely
because the worker is a separate process that can be killed outright.

### 4. Prepare the browser

The rendering engine draws frames in a headless browser. On a first-ever run
this downloads the browser and takes a while; cancellation is honoured during
this stage like every other, so a first run never looks like a hung Cancel
button.

### 5. Narrate and draw, overlapped

This is the heart of the worker, and its shape is a deliberate pipeline:

```
scene 1 narration ─────────────────┐
        (while the composition     │
         is being bundled)         ▼
                              scene 1 draws ────────────────┐
scene 2 narration ────────────┘  (while scene 2's          │
                                  voice is spoken)          ▼
                                                    scene 2 draws ──▶ …
```

- The **first scene's narration** is spoken while the drawing program is being
  bundled.
- **Every later scene's narration** is spoken while the *previous* scene draws.
- Each scene's audio therefore only has to exist before that scene's own
  drawing starts.
- **Never more than one voice is in flight**, and one is almost always in
  flight — speech production overlaps the slow stages without competing with
  itself.

Each scene is then drawn:

- The scene's rendered length is the **fitted** length derived from its actual
  measured narration — not the storyboard's own estimate (see *Narration*, below).
- Frames are drawn with a deliberately capped frame-level concurrency, suited to
  a single-user machine rather than a server.
- The finished clip is written under a temporary name and renamed into the
  clips folder as a numbered clip — so a partial scene never appears as a
  finished one.
- The clip is **verified audible** before it is accepted.
- It is added to the join list, and progress advances to the next scene
  boundary.

While a scene draws, the status carries the drawing engine's own fraction
through that scene, mapped onto the whole job's progress. Ordinary
frame-by-frame progress writes are throttled (at most a few per second);
stage changes and job outcomes are written immediately, so the throttling can
never delay the news that matters.

### 6. Join

The narration folder is *not* joined directly — the scenes are. The worker
writes a temporary list of the finished clips and asks ffmpeg to concatenate
them **without re-encoding** into a temporary file beside the final output,
marked for web playback.

Two checks guard the publish:

- If a cancel arrived while the join was finishing, the completed temporary
  file is discarded rather than published — reporting success would be a lie
  the interface would act on.
- The joined file is verified audible while it is still temporary. Only then is
  it renamed into place as the finished video.

The join can be a plain stream copy — lossless and fast — only because every
clip is rendered with identical settings: same codec and quality settings, same
pixel format, same frame rate, same canvas size, and the same audio codec and
bitrate. That agreement is why those settings live together as one contract
rather than at each call site. Audio is additionally trimmed to whole audio
frames per clip so narration cannot drift behind the drawing across the join.

A full render ends with state `done`, the message *"Render complete."* and exit
code 0.

### Preview renders

A preview is the same machinery for one scene: wait for that scene's narration,
draw it alone, verify it audible, and publish it. Its progress is reported as
that single scene's own 0-to-1 progress rather than as a fraction of one scene
total (which would show 100% immediately). It ends with state `done` and the
message *"Preview ready."*

The preview is drawn to a temporary name and renamed only after the audible
check, so a refused preview cannot destroy a previous good preview — and it can
never overwrite a finished scene clip from a real render either.

## The status contract

The status record is the interface between the worker and everything that
watches it: the API, the page, and a human reading the folder. It carries:

| Field | Meaning |
|---|---|
| State | `running`, `done`, `failed` or `cancelled` — only `running` is non-terminal |
| Mode | Full render or preview |
| Process identity | The worker that wrote it; zero means "written on a worker's behalf" |
| Timestamps | Start, last update, and finish (empty while running) |
| Scene counters | Which scene is being drawn, how many the job has, how many are finished |
| Progress | 0 to 1 across the whole job (within the scene for a preview) |
| Message | The human-readable line, e.g. *"Preparing narration…"*, *"Narrating scene 3 of 12…"*, *"Drawing scene 3 of 12…"*, *"Joining the scenes…"* |

Every write to it is atomic, so a reader polling the file never sees a torn
write even when a throttled progress update and a forced stage update overlap.

Two subtleties make the contract trustworthy:

- **Staleness is decided by the lock, not the status.** A status record goes
  stale the moment the worker is killed; the lock is reclaimed as soon as its
  process is gone. So "is a render active?" is answered from the lock, while
  "what did the last render say?" is answered from the status.
- **A late exit may not speak for a newer job.** When a worker exits, its
  outcome is recorded only if the status still belongs to that worker (matching
  process identity) and is not already terminal. A crashed old worker's exit
  signal can never stamp `failed` over a newer, running render.

A status record that is only partially valid is treated as no record at all,
deliberately: a missing state once read as "still running" and made the
interface poll a dead job forever.

## Cancellation

Cancelling is a first-class outcome, not an error. A cancellation signal sets a
flag, wakes the drawing engine's own cancellation mechanism, and is forwarded
to a running ffmpeg child. It is checked at every slow stage — browser
start-up, bundling, each narration wait, before each scene, during drawing, and
during and after the join — not only once the drawing engine is listening.

A cancelled render reports `cancelled` with *"Render cancelled."* and a distinct
exit code (130). The application treats that exit code, or a termination signal
on the worker, as a cancellation even if the worker never got to write it.

Note one asymmetry: the narration engine runs in-process and cannot be
interrupted. A synthesis already under way when Cancel arrives is abandoned and
dies with the worker.

## Failure, and what survives it

Refusals and failures — an invalid storyboard, a narration overrun, a silent
clip, a broken ffmpeg invocation, a bundling error, a crash — all report
`failed` with exit code 1 and a truncated explanation in the status message,
with the full error on standard error. Exit codes are part of the contract:
0 success, 1 anything else, 130 cancelled.

The system's posture toward partial work is consistent:

| Situation | What is preserved | What is discarded |
|---|---|---|
| Cancelled or failed mid-run | Scene clips already finished stay in the folder | The half-drawn scene (written under a temporary name) |
| Any failure during the join | The previous finished video is untouched | The temporary join and its list |
| A refused preview | The previous preview is untouched | The temporary preview clip |
| A rejected narration | Whatever the previous render wrote | The temporary audio file |
| Always | — | Nothing ever appears under a name a reader could mistake for finished |

Finished clips are kept even though a retry re-renders everything: they are a
starting point for a person debugging, not for the next run. Nothing prunes
them, nor the narration files, automatically.

## Narration

Narration is synthesized **locally, in-process**, by a small neural
text-to-speech model that ships as a dependency and downloads its ~90 MB voice
model on first use. The voice is configurable; an unknown voice name fails fast,
listing the valid ones, rather than failing scene by scene halfway through a
render. There is no silent fallback to another voice — a failure to load is
reported with an installation hint.

The first-run model download is surfaced as progress messages (for example,
*"Downloading the voice model (42%)…"*).

Three rules govern how narration relates to its scene:

1. **It is measured, not estimated.** Each scene's audio is written under a
   temporary name, then measured with ffprobe.
2. **An overrun is refused, never fudged.** If the audio runs longer than the
   scene's frame-rounded length — allowing exactly one frame of rounding slack
   — the render stops *before that scene's first frame*, naming the scene and
   both durations, and tells the operator to shorten the narration and rebuild
   the storyboard. The voice is never sped up, never truncated. This is why
   storyboards are planned at a conservative words-per-second rate: a plan
   written to the full budget still has slack.
3. **The clip is fitted to the voice, not the reverse.** A scene is rendered for
   its measured narration plus a half-second beat, floored at three seconds so
   a very short narration (typically the title scene) is not a flash cut, and
   clamped so the fit can only ever shorten a scene — never stretch it past
   what the storyboard asked for. The storyboard file itself keeps the model's
   original durations; the fit is a render-time decision.

Audio is **baked into each scene clip** as it is drawn, rather than muxed on
afterwards. Every clip is guaranteed to carry an audio track, so a stream count
proves nothing — which is why the loudness check exists: a clip whose loudest
sample is at or below a −50 dB floor (± digital silence) is refused, because a
scene that rendered with no narration would otherwise join into a video that is
silently broken for that scene's whole length.

## Operational requirements

- **ffmpeg and ffprobe** must be on the path; startup failures say so.
- **Network on first use** for the headless browser download and the voice
  model download; after that, renders are offline.
- **A headless browser**, downloaded automatically on first render.
- **One voice at a time, one render at a time, and a capped frame-level
  concurrency** — the resource budget assumes a single-user machine, and the
  frame cap is not a supported setting.
- The worker's **combined output is captured into the project folder**,
  truncated at the start of each job, so the most recent job is diagnosable
  after the fact and after a server restart. Failure reports fold in the last
  few captured lines when a worker dies without writing its own outcome.

Artifacts an operator can expect to find, by name, after working with a
project: the storyboard (`scenes.json`), the status record (`status.json`), the
per-job output capture (`render.log`), numbered clips under `clips/`, per-scene
recordings under `narration/`, the single-scene `preview.mp4` (with a transient
`preview-clip.mp4`), the finished `out.mp4`, and the cross-project lock
`.active-render.json`. Every one of them is written atomically; a reader never
observes a partial state.
