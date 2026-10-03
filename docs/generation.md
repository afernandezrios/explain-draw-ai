# Generation: from pasted text to a validated storyboard

Generation is the model half of the product: two model calls — a script, then a
storyboard — wrapped in local validation strict enough that the model is never
trusted with a rule the system can check itself. It talks to any
OpenAI-compatible chat endpoint; the endpoint, model name and key are
configuration, defaulting to DeepSeek.

Everything in this document happens behind a boundary that the test suite
replaces with a fake. That is deliberate: the model is the one unreliable
component, so it is the *only* thing that is substituted in tests. Validation,
layout, file-writing and rendering are the real code in tests as in production.

## Call one: the script

The user's pasted text is trimmed, checked against the length limit, and sent
as the request. The model is asked to act as a writer of short diagram-style
explainer videos: about five minutes of spoken explanation, roughly 700 words,
a short title plus a body of prose with one heading per beat, in plain
language, with every beat drawable.

The reply is a JSON object wrapping a title and a body. The title is capped at
160 characters and the body at 20,000; the same limits the application enforces
when a human edits the script. **A malformed script reply fails the whole
generation immediately** — the script step gets no repair pass. Only the
storyboard does.

Nothing is written to disk until the script has come back: a missing key, an
empty input or a failed request leaves no project behind. Once the project
folder exists, any later failure removes exactly that folder.

## Call two: the storyboard

The script — title and body — is the input, and the reply is the storyboard:
an ordered list of scenes, scene 1 being the title scene. Each scene carries a
short title (used in the progress list), a duration in whole seconds, the
shapes to draw in order, and the narration line.

The instructions the model is given are assembled from the *same* constants the
validator enforces, so the prompt cannot promise something the validator will
reject and the two cannot drift apart. The prompt states, in the model's terms:

**Scene structure**

- Each scene lasts 7–20 seconds and draws 3–12 shapes, in drawing order —
  background panels and containers before what sits on them.
- A scene's written words total 20 or fewer; every drawn word counts.
- The first scene is a hand-lettered title card for the topic.
- Shapes are spread across the board; the top band carries an app-drawn header
  (scene title and progress bar), so the drawing stays below it.
- Colour is a signal, not decoration: the default ink for most things, blue for
  the one thing that matters most in a scene, red for failures and removals,
  green and amber for the good and bad sides of a comparison, and three further
  names for extra categories and de-emphasised parts.

**Narration**

- Narration is spoken at 2 words per second, and a scene's budget is its own
  duration times that rate, rounded *down*: 7 seconds allows 14 words, 10
  allows 20, 20 allows 40. The prompt quotes the full table, a worked
  "19 seconds allows 38, never 39" example, and tells the model to leave two or
  three words of headroom rather than write to the brim.
- Narration is plain spoken English in full sentences — no headings, lists or
  stage directions — and every scene has one.

**Total length**

- The target is 5 minutes; the accepted window is 4:30–5:30. The prompt quotes
  typical scene lengths (12–18 seconds, roughly 17–25 scenes) rather than the
  theoretical extremes, because the extremes can only reach the target by
  hugging an edge and would mislead the model into producing too little.
- The script is the anchor: read at 2 words per second, the scenes' narration
  together should re-tell the whole script rather than condense it.

**The drawing vocabulary**

The prompt teaches the same fourteen shape kinds the storyboard defines — nine
geometric primitives and five composites that carry their own words and
structure (a titled card, a grouping panel, a symbol badge, a bullet list, a
divider) — and encourages the composites, because they do more inside the
12-shape cap. It also teaches the relationship fields: a label can name the
shape it sits in, an underline the label it belongs to, an arrow or connector
the two shapes it joins. The model is told the index counts from the start of
the scene's own list and that a wrong index is worse than none, and it is told
the honest division of labour: coordinates are a starting point, and the system
centres, shrinks, and docks anchored geometry itself.

**When the narration says something is broken**, the model draws a dedicated
cross-out shape rather than a hand-made X, listed after the shape it crosses.
**Every stick figure is labelled** with what it stands for, so no figure is
anonymous.

## How replies are constrained

Two mechanisms, tried in order:

1. **Strict structured output.** The provider is given a machine-readable
   schema generated automatically from the same definitions the local parser
   uses. The strict subset of JSON Schema cannot express "may be absent" or
   array size limits, so fields that may be empty are sent as
   *required-but-nullable* (the model writes nothing as an explicit nothing),
   and the caps that cannot be expressed in the schema live in the prose and in
   local validation instead.
2. **Plain-JSON fallback.** Some providers reject strict schema mode outright.
   That one specific rejection (recognized precisely, not by a blanket catch)
   triggers a retry in plain JSON mode: the schema is embedded in the prompt as
   text, the reply is parsed locally, and an explicit generous output ceiling is
   set so the provider's lower default cannot truncate a long storyboard
   mid-JSON. Any other failure — a timeout, a rejection for another reason — is
   surfaced as an error rather than silently downgraded.

One asymmetry matters: **the model is shown the strict shape but its reply is
read with a forgiving one.** A model that omits a field whose only sensible
value was "none" does not cost the storyboard. One optional markdown code fence
around the JSON is tolerated; anything else must already be valid JSON.

These fallbacks are expected traffic, not error paths — on a provider that
rejects schema mode, *every* generate makes the rejected request and then the
plain-JSON one.

## Validation and the repair pass

Every storyboard reply is judged locally by the same three steps every read
path uses, in the same order:

1. **Structure** — types, ranges, required fields, string lengths, index
   bounds. A reply that fails this cannot be repaired, because the complaint
   cannot be attached to a well-formed scene; it is a hard error.
2. **Layout** — relationships resolved: labels centred and shrunk to fit, line
   ends docked to the shapes they name, out-of-range relationships cleared and
   reported rather than fatal.
3. **Whole-scene rules** — the 20-word budget, the narration word budget, the
   3–12 shape count, bullet-list length, and the rule that nothing may be drawn
   off the board.

Then a fourth, separate check on the storyboard as a whole: the total duration
must fall inside the 4:30–5:30 window. It is separate because only the total
can see it — no single scene is at fault.

**The storyboard gets two attempts: the first, plus one targeted repair.** When
the first attempt fails, the validator's own complaints — with their exact
per-field paths, rewritten to scene numbers the model can act on — are sent
back with the instruction to fix exactly those problems and return the complete
corrected storyboard. For a duration miss, the repair is specific: under the
minimum, the script's word count and read-aloud time are quoted and the model is
told to add scenes and lengthen narrations; over the maximum, to shorten or
merge.

The final attempt is judged asymmetrically, and deliberately so:

- A storyboard that still **fails the per-scene rules** (or the structural
  parse) is a hard error: *"The model returned a storyboard that does not match
  the scene format."* with the field-level complaints.
- A storyboard that passes per-scene validation but misses the **duration
  window** is **accepted and saved**. The user sees a budget warning, a full
  render is refused, and Regenerate is the remedy. A second repair round could
  throw away an otherwise drawable storyboard, and the product would rather
  hand the user a usable board with a warning than nothing.

That trade shapes the failure mode users actually meet: not a hard error, but a
saved storyboard with a budget warning and a disabled Render.

## The error contract

Every failure — from any endpoint — has one shape: a human-readable message, a
machine-readable code, and optional per-field details. The details list serves
both a freshly rejected model reply and a stored storyboard that later fails to
validate, and the page renders it as a bullet list.

| Situation | User-visible outcome |
|---|---|
| No key configured | *"No API key found. Copy .env.local.example to .env.local, set OPENAI_API_KEY, then restart the dev server."* — detected before any network request |
| Input missing, empty, or over the limit | A 400 with a message naming the actual length against the 20,000 limit |
| Model refused, returned nothing, or returned unparseable JSON | *"The model returned …"* messages, classified as the model's bad output rather than a provider failure — the endpoint answered fine |
| Storyboard unusable after repair | *"The model returned a storyboard that does not match the scene format."* plus the field list |
| Provider error or network failure | *"The model endpoint replied …"* / *"The model request failed: …"* |
| Unknown project | *"There is no project …"* |

The interface offers one-click recovery only where it can help: a **Retry**
button appears for a rejected storyboard when no project exists yet (the
generate itself failed). Once a project exists, the remedy is the user-driven
Regenerate, because a whole new storyboard is a decision, not an automatic
retry.

## Cost and latency behaviour

- **One script call, plus one or two storyboard calls** per generate. Each
  logical call is one HTTP request normally, or two when strict mode is
  rejected and the fallback is made; the HTTP client may additionally retry a
  transient failure once. Worst case is therefore about six requests for a
  single generate, and a rejected-schema provider pays it on every run.
- **Everything is sequential** — script, then storyboard, then the repair if
  needed. No parallel model traffic, no batching, no caching of replies.
- **Each request may run up to four minutes** before timing out, sized because
  a thinking-enabled storyboard can take well over the old two-minute mark and
  a timeout loses the whole generate.
- **Thinking mode** is a configuration switch. The default model measurably
  under-produces without it (storyboards a third of the required length), so
  thinking is the compliant default and off is the faster, cheaper, less
  compliant mode. Reasoning tokens share the output budget with the answer,
  which is why the fallback's ceiling is generous.
- Regenerate reuses the saved script: one or two storyboard calls, no script
  call, and no script tokens or timings in the metadata.

## What the user is told about a generate

Each run reports the script's wall-clock time (absent from a rebuild, which has
no script call), the storyboard's wall-clock time, the model name, and the
total tokens across every call and every attempt — a rejected strict-mode
request that got no answer carries zero usage, so the numbers reflect traffic
that actually happened rather than double-counting. The interface shows these
as a parenthetical on the success notice, e.g. *"Storyboard ready: 18 scenes
(script 4.2s, storyboard 61.8s, deepseek-v4-flash, 12,345 tokens)."* The token
and timing record exists to make cost and latency visible, and to show how
often the storyboard needed its repair attempt or its fallback.

Next: what happens to a validated storyboard in
[rendering.md](rendering.md), and how its scenes become pictures in
[visual-language.md](visual-language.md).
