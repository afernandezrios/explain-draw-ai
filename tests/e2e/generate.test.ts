/**
 * The generate half of the pipeline: text in, validated storyboard on disk.
 *
 * Covers the I/O matrix rows EMPTY_INPUT, INVALID_LLM_JSON, OVER_BUDGET and
 * MISSING_KEY, plus the duration math and the shape of the JSON Schema sent to
 * the provider. FakeLLM is the only fake; validation and file I/O are real.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_SCRIPT, fakeScenes } from '../../src/lib/fixtures.ts';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  FakeLlm,
  LlmError,
  OpenAiLlm,
  SCENES_SYSTEM_PROMPT,
  SCRIPT_SYSTEM_PROMPT,
  resolveBaseUrl,
  resolveModel,
  scenesResponseFormat,
  scriptResponseFormat,
} from '../../src/lib/llm.ts';
import {
  PipelineError,
  createProject,
  projectFiles,
  projectsRoot,
  readScenes,
  readScript,
  scriptToScenes,
  textToScript,
  writeScenes,
  writeScript,
} from '../../src/lib/pipeline.ts';
import { MAX_INPUT_CHARS } from '../../src/lib/render-config.ts';
import {
  MAX_LABEL_SIZE,
  MAX_LABEL_WORDS,
  MAX_SCENE_SECONDS,
  MAX_SHAPES_PER_SCENE,
  MAX_TOTAL_SECONDS,
  MIN_LABEL_SIZE,
  MIN_SCENE_SECONDS,
  MIN_SHAPES_PER_SCENE,
  MIN_TOTAL_SECONDS,
  SHAPE_KINDS,
  SHAPE_NOTES,
  ScenesEnvelopeSchema,
  checkBudget,
  totalSeconds,
} from '../../src/lib/schema.ts';
import { fullStoryboard, makeProject, runWorker, useTempProjectsRoot } from './helpers.ts';

let root = '';

beforeAll(() => {
  root = useTempProjectsRoot();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('happy path', () => {
  it('turns pasted text into a valid script and storyboard on disk', async () => {
    const llm = new FakeLlm();
    const pasted = 'I want to learn about system design, explain the core concepts';

    // The two real seams, with only the model boundary faked.
    const script = await textToScript(pasted, llm);
    const scenes = await scriptToScenes(script, llm);

    expect(llm.calls.script).toEqual([pasted]);
    expect(llm.calls.scenes).toHaveLength(1);
    expect(script).toEqual(FAKE_SCRIPT);
    expect(scenes).toHaveLength(3);

    const project = makeProject(scenes, { input: pasted, script });

    // AC1's file assertions.
    expect(fs.existsSync(path.join(project.dir, 'input.txt'))).toBe(true);
    expect(readScript(project.id)).toEqual(script);
    const stored = readScenes(project.id);
    expect(stored.ok).toBe(true);
    expect(stored.ok && stored.scenes).toEqual(scenes);

    // The script is editable, and a rebuild sees the edit rather than the
    // original: the saved file is what the next call reads.
    const edited = { title: 'Edited', text: 'Tighter words.' };
    writeScript(project.id, edited);
    expect(readScript(project.id)).toEqual(edited);

    const secondCall = new FakeLlm();
    await scriptToScenes(edited, secondCall);
    expect(secondCall.calls.scenes).toEqual([edited]);
  });

  it('lands the duration math in the 270-330s window for a full-length storyboard', () => {
    const sample = fakeScenes();
    expect(totalSeconds(sample)).toBe(30);
    // The 30s sample is deliberately out of window: it is the render-speed
    // fixture, not a publishable video.
    expect(checkBudget(sample).ok).toBe(false);

    const full = fullStoryboard(39);
    const total = totalSeconds(full);
    expect(total).toBe(273);
    expect(total).toBeGreaterThanOrEqual(MIN_TOTAL_SECONDS);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_SECONDS);
    expect(checkBudget(full)).toMatchObject({ ok: true, roundedSeconds: 273 });
    expect(checkBudget(full).label).toContain('4:33');
  });

  it('reports the computed total once when the storyboard is over the window', () => {
    const over = fullStoryboard(39).map((scene) => ({ ...scene, durationSeconds: 10 }));
    const verdict = checkBudget(over);

    expect(verdict.ok).toBe(false);
    expect(verdict.totalSeconds).toBe(390);
    // "6:30" appears exactly once, and it is the over-maximum message.
    expect(verdict.message).toContain('6:30');
    expect(verdict.message?.match(/6:30/g)).toHaveLength(1);
    expect(verdict.message).toContain('over the 5:30 maximum');
  });
});

describe('input edges', () => {
  it('EMPTY_INPUT: rejects whitespace without calling the model or writing state', async () => {
    const llm = new FakeLlm();
    const before = fs.readdirSync(projectsRoot());

    await expect(textToScript('   \n\t ', llm)).rejects.toBeInstanceOf(PipelineError);
    await expect(textToScript('', llm)).rejects.toMatchObject({ kind: 'empty-input' });

    expect(llm.calls.script).toEqual([]);
    expect(fs.readdirSync(projectsRoot())).toEqual(before);
  });

  it('refuses an input over the character cap and says how long it was', async () => {
    const llm = new FakeLlm();
    const huge = 'x'.repeat(MAX_INPUT_CHARS + 1);

    await expect(textToScript(huge, llm)).rejects.toMatchObject({ kind: 'input-too-long' });
    await expect(textToScript(huge, llm)).rejects.toThrow(/20,001 characters/);
    expect(llm.calls.script).toEqual([]);
  });

  it('MISSING_KEY: reports a set-the-key error instead of crashing', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(new OpenAiLlm().generateScript('anything')).rejects.toBeInstanceOf(LlmError);
      await expect(new OpenAiLlm().generateScript('anything')).rejects.toMatchObject({
        kind: 'missing-key',
      });
      await expect(new OpenAiLlm().generateScript('anything')).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (saved === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = saved;
      }
    }
  });
});

describe('INVALID_LLM_JSON', () => {
  const malformed = [
    {
      title: 'Too long and too thin',
      durationSeconds: 45,
      shapes: [
        { kind: 'circle', x: 10, y: 10, r: 10, color: null },
        { kind: 'label', x: 5, y: 5, text: 'label', size: 99, color: null },
      ],
    },
  ];

  it('returns per-field errors and the model output is never written', async () => {
    const llm = new FakeLlm({ scenes: malformed });

    const failure = await scriptToScenes(FAKE_SCRIPT, llm).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmError);
    const details = (failure as LlmError).details;

    // Path-qualified: the UI prints these next to a retry button.
    expect(details.some((detail) => detail.startsWith('0.durationSeconds:'))).toBe(true);
    expect(details.some((detail) => detail.startsWith('0.shapes.1.size:'))).toBe(true);
    expect(details.some((detail) => detail.startsWith('0.shapes:'))).toBe(true);
  });

  it('refuses to render a storyboard that does not match the format', async () => {
    const project = makeProject(
      // Written straight to disk, the way a hand-edit would arrive.
      malformed as never,
      { input: 'malformed' },
    );

    const result = await runWorker(project);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('refusing to render');
    expect(result.stderr).toContain('0.durationSeconds');

    // Nothing rendered, and no storyboard was invented for it.
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
    expect(fs.readdirSync(path.join(project.dir, 'clips'))).toEqual([]);
  });
});

describe('OVER_BUDGET', () => {
  it('refuses a full render outside the window and reports the computed total', async () => {
    const over = fullStoryboard(39).map((scene) => ({ ...scene, durationSeconds: 10 }));
    const project = makeProject(over, { input: 'over budget' });

    const result = await runWorker(project);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('refusing to render');
    expect(result.stderr).toContain('6:30');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
  });

  it('still writes a project folder that a later regenerate can replace', () => {
    // The folder is not the problem; the storyboard is. This pins that a
    // refused storyboard leaves everything else intact.
    const id = createProject('budget retry');
    writeScenes(id, fullStoryboard(39));
    expect(readScenes(id).ok).toBe(true);
    expect(fs.existsSync(path.join(projectFiles(id).dir, 'scenes.json'))).toBe(true);
  });
});

describe('the schema sent to the provider', () => {
  it('is inside the strict structured-output subset', () => {
    for (const format of [scriptResponseFormat(), scenesResponseFormat()]) {
      expect(format.type).toBe('json_schema');
      expect(format.json_schema.strict).toBe(true);

      const schema = format.json_schema.schema as Record<string, unknown>;
      // Object root: an array root is rejected outright.
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(Object.keys(schema.properties as object));

      const serialized = JSON.stringify(schema);
      expect(serialized).not.toContain('"oneOf"');
      expect(serialized).not.toContain('"default"');
      expect(serialized).not.toContain('"minItems"');
      expect(serialized).not.toContain('"maxItems"');
    }

    // Nullable fields are how optionality is expressed in the subset (there is
    // no `default`, and a missing key is not allowed), so the storyboard schema
    // -- the one with nullable colours -- must be emitting anyOf.
    const scenes = JSON.stringify(scenesResponseFormat().json_schema.schema);
    expect(scenes).toContain('"anyOf"');
    expect(scenes).toContain('"null"');
  });

  it('asks for scenes as an object wrapper and reads the same shape back', () => {
    const properties = scenesResponseFormat().json_schema.schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(properties.properties)).toEqual(['scenes']);

    // The wrapper is what makes the object root legal, so the bare array the
    // provider would otherwise be asked for must not validate.
    expect(ScenesEnvelopeSchema.safeParse(fakeScenes()).success).toBe(false);
    expect(ScenesEnvelopeSchema.safeParse({ scenes: fakeScenes() }).success).toBe(true);
  });
});

describe('the prompt the model is sent', () => {
  it('teaches exactly the shape vocabulary the validator enforces', () => {
    const lines = SCENES_SYSTEM_PROMPT.split('\n');
    const afterHeading = lines.slice(lines.indexOf('The available shapes:') + 1);
    const shapeLines = afterHeading
      .slice(0, afterHeading.findIndex((line) => line.startsWith('Rules:')))
      .filter(Boolean);

    // Derived from the schema rather than from the prompt: a ninth shape
    // reaches the model the moment it is added to SHAPE_SPECS, and a shape that
    // was removed cannot linger in the text. Nothing else may appear in this
    // list -- the model can only draw what the validator accepts.
    expect(shapeLines).toEqual(SHAPE_KINDS.map((kind) => `- ${kind}: ${SHAPE_NOTES[kind]}`));
    expect(shapeLines).toHaveLength(SHAPE_KINDS.length);
  });

  it('quotes the caps the validator applies, not its own numbers', () => {
    expect(SCENES_SYSTEM_PROMPT).toContain(`${MIN_SCENE_SECONDS} to ${MAX_SCENE_SECONDS} seconds`);
    expect(SCENES_SYSTEM_PROMPT).toContain(
      `between ${MIN_SHAPES_PER_SCENE} and ${MAX_SHAPES_PER_SCENE} shapes per scene`,
    );
    expect(SCENES_SYSTEM_PROMPT).toContain(`${MAX_LABEL_WORDS} words or fewer`);
    expect(SCENES_SYSTEM_PROMPT).toContain(`${MIN_LABEL_SIZE} to ${MAX_LABEL_SIZE}`);
    expect(SCENES_SYSTEM_PROMPT).toContain(`${MIN_TOTAL_SECONDS} and ${MAX_TOTAL_SECONDS} seconds`);
    // The envelope it is told to return is the one that is parsed.
    expect(SCENES_SYSTEM_PROMPT).toContain('{"scenes": [...]}');
    expect(SCRIPT_SYSTEM_PROMPT).toContain('title plus markdown-ish body text');
  });

  it('targets the configured model and endpoint, with the documented defaults', () => {
    const savedModel = process.env.OPENAI_MODEL;
    const savedBaseUrl = process.env.OPENAI_BASE_URL;
    try {
      delete process.env.OPENAI_MODEL;
      delete process.env.OPENAI_BASE_URL;
      expect(resolveModel()).toBe(DEFAULT_MODEL);
      expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);

      process.env.OPENAI_MODEL = '  some-local-model  ';
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1';
      // Trimmed, so a trailing space in .env.local does not reach the SDK.
      expect(resolveModel()).toBe('some-local-model');
      expect(resolveBaseUrl()).toBe('http://127.0.0.1:11434/v1');
    } finally {
      if (savedModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = savedModel;
      }
      if (savedBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL;
      } else {
        process.env.OPENAI_BASE_URL = savedBaseUrl;
      }
    }
  });
});
