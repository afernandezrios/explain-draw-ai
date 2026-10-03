# Generation: from pasted text to a validated storyboard

Generation is the model half of the product: two model calls — a script, then a
storyboard — wrapped in local validation strict enough that the model is never
trusted with a rule the system can check itself. It talks to any
OpenAI-compatible chat endpoint; the endpoint, model name and key are
configuration, defaulting to DeepSeek.

Everything in this document happens behind a boundary that the test suite
replaces with a fake. That is deliberate: the model is the one unreliable
component, so it is the *only* thing that is substituted in tests. Validation,
file-writing, stills and rendering are the real code in tests as in production.

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
an ordered list of scenes, scene 1 being the title scene. Each scene names a
kind — title, points, flow, topology, diagram, sequence, code or concept —
carries the fields that kind defines, a short title (used in the progress
list), a duration in whole seconds and the narration line, and may name a theme
and an accent colour.

The instructions the model is given are assembled from the *same* constants the
validator enforces, so the prompt cannot promise something the validator will
reject and the two cannot drift apart. The prompt states, in the model's terms:

**Scene structure**

- Each scene lasts 7–20 seconds, and each kind's own fields are capped: a list
  of 2–5 points, a pipeline of 2–5 stages, a hierarchy of 3–10 nodes, a diagram
  of 2–6 boxes and 1–8 arrows, a rail of 2–5 steps, a listing of at most 24
  lines of at most 100 characters. The caps are quoted from the same numbers
  the validator enforces.
- A scene's written words are capped per kind — 30 for a title card, 65 for
  points, 45 for a flow, 70 for a topology, 70 for a diagram, 65 for a
  sequence, 40 for code, 55 for a concept — and every word the scene writes
  counts, except the code listing, which is bounded by lines and characters.
- The first scene is the title kind: a title card for the topic.
- Theme is dark or light, and accent marks the one thing that matters most in a
  scene — one of six named colours, or none. Accent is a signal, not
  decoration.
- In a hierarchy, a node names its parent by the index of an *earlier* node in
  the same scene, and exactly one node has no parent. A parent listed after its
  child, or a second root, is rejected.
- In a diagram, an arrow names the box it leaves and the box it lands on by
  their 0-based indexes in the scene's own box list, and every arrow must name
  boxes that exist. Loops, arrows back to an earlier box and repeated arrows
  are all fine — only an index that names no box is rejected. A box is drawn as
  a rounded rectangle, or as the cylinder a store of rows gets when the box's
  shape says so.
- The kinds are to be chosen for the beat, not reused by habit, and the drawn
  kinds are preferred over the written ones: anything where boxes talk to boxes
  is diagram, a chain of stages is flow, who reports to whom is topology, an
  ordered walk-through is sequence; a list of reasons to tick off is points, an
  excerpt to read closely is code, and concept is the one thesis scene the
  video exists for — one at most.

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

**The scene kinds**

The prompt teaches the same eight kinds the storyboard defines, built by
mapping over the schema's own kind table — so a kind added to the schema cannot
be missing from the prompt. Each kind arrives with its purpose, its fields and
its caps; the written-word budgets, the per-kind counts, the accent vocabulary
and the duration window are all read from the same constants the validator
uses, so the prompt cannot promise something the validator will reject.

The division of labour is stated once: the model states content and, in two
places, a relationship. In a hierarchy that relationship is a node's parent —
the index of a node *listed before it* in the same scene's node list, with
exactly one node left parentless as the root. In a diagram it is an edge's two
endpoints — the 0-based indexes of the boxes it leaves and lands on, with no
ordering rule and cycles allowed, because a round-trip has no root and no first
box. The prompt says both indexes count from the start of the scene's own list
and that a parent listed after its child, a scene with no root or two, or an
arrow naming a box that does not exist is rejected. Coordinates never enter the
picture: the block that draws the kind decides where everything sits.

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

Every storyboard reply is judged locally by the same two steps every read path
uses, in the same order:

1. **Structure** — types, ranges, required fields, string lengths, index
   bounds. A reply that fails this cannot be repaired, because the complaint
   cannot be attached to a well-formed scene; it is a hard error.
2. **Whole-scene rules** — each kind's word budget and item caps, the narration
   word budget, the listing's line and character limits, and the hierarchy's
   parent rules — a parent must be listed before its child, and exactly one
   node is the root.

Then a separate check on the storyboard as a whole: the total duration must
fall inside the 4:30–5:30 window. It is separate because only the total can see
it — no single scene is at fault.

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
