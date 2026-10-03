# Explain-Draw AI — documentation

Explain-Draw AI turns a pasted topic or explanation into a roughly five-minute
narrated explainer video, drawn as clean flat diagrams, entirely on the user's
own machine. Paste text; a language model writes a script and then a storyboard
of scenes; the storyboard is validated; a local voice speaks each scene's
narration; the scenes are drawn and rendered into video clips; the clips are
joined into a single MP4. The only external service involved is the model
endpoint — narration, drawing and video assembly are all local.

The product is deliberately a single-user, local-first tool: one page, one
project at a time, one render at a time, no database. Its state is a folder of
files, which is what makes a render survive a server restart, a browser reload
or a killed process — and what makes every artifact inspectable by hand.

These documents cover the **structure and functionality** of the system from a
business and architectural perspective. They describe behaviour, contracts and
rules — not code identifiers, not implementation internals.

## Read in this order

| Document | What it answers |
|---|---|
| [architecture.md](architecture.md) | What the system is made of, why the parts are separate, and the invariants that hold them together |
| [domain-model.md](domain-model.md) | The two documents — script and storyboard — and the seven scene kinds, with every rule and cap |
| [generation.md](generation.md) | How the model is asked for a script and a storyboard, how replies are constrained, validated and repaired, and how failures are reported |
| [rendering.md](rendering.md) | How a storyboard becomes a video: stage order, narration, progress, cancellation, failure and the single-render lock |
| [visual-language.md](visual-language.md) | How scenes become pictures: the seven kinds and their choreography, themes and accents, and the preview/render guarantee |
| [web-application.md](web-application.md) | The user journey, the panes, the API surface and the render lifecycle as the page sees it |
| [operations.md](operations.md) | Setup, configuration, artifacts on disk, the test posture, resource limits and current gaps |

## The shape of the system in one paragraph

Three parts share one contract. The **web application** takes the input and
shows the artifacts. The **generation pipeline** turns text into a validated
storyboard with two model calls. The **render worker** — a separate process,
startable by the app or by hand — re-validates the storyboard, speaks each
scene's narration, draws each scene, and joins the clips into the video. A
project is a folder; the storyboard is the interface between every part; and a
single lock file guarantees one render at a time across every entry point.

## Conventions used in these documents

- No source identifiers: subsystems are named by role ("the render lock", "the
  status record"), not by code names.
- Artifact names such as `scenes.json`, `status.json` and `out.mp4` are used
  as-is, because they are what an operator sees on disk.
- Configuration names such as `OPENAI_API_KEY` and `KOKORO_VOICE` are used in
  the operations document, because they are the interface to the environment.
- Numbers quoted (scene caps, word budgets, the four-and-a-half-minute window)
  are the values the system enforces today.
