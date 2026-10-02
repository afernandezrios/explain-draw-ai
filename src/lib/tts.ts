/**
 * Kokoro, the local text-to-speech engine.
 *
 * WORKER-ONLY. This module imports kokoro-js and, through it,
 * @huggingface/transformers and onnxruntime-node -- native, multi-hundred-
 * megabyte machinery that must never reach the Next server bundle or the
 * Remotion composition. Only `scripts/render-worker.ts` imports it; nothing
 * under `src/app/` or `src/remotion/` may.
 *
 * Synthesis is in-process and local: the Kokoro-82M ONNX model (q8, ~90 MB)
 * is downloaded from the Hugging Face Hub into `KOKORO_MODELS_DIR` on the
 * first narration and read from there afterwards. The voice weight files ship
 * inside the kokoro-js package itself, so only the model needs the network --
 * and only once, the way the renderer's font download already does. There is
 * no subprocess: a synthesis already under way cannot be interrupted, it is
 * abandoned and dies with the worker process.
 */

import path from 'node:path';
import { env as transformersEnv } from '@huggingface/transformers';
import { KokoroTTS, type GenerateOptions } from 'kokoro-js';

export const KOKORO_VOICE_ENV = 'KOKORO_VOICE';
export const KOKORO_MODELS_DIR_ENV = 'KOKORO_MODELS_DIR';
export const DEFAULT_KOKORO_VOICE = 'af_heart';
/** Relative to the project's own root, not the working directory. */
export const DEFAULT_KOKORO_MODELS_DIR = 'models';

/** This file sits in `src/lib/`, two directories below the project root. */
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The quantized (q8) weights on the CPU; the dtype picks `onnx/model_quantized.onnx` out of the repo. */
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_DTYPE = 'q8';
const KOKORO_DEVICE = 'cpu';

export const KOKORO_INSTALL_HINT =
  'Kokoro speaks the narration in-process: it ships with `npm install` (kokoro-js), and the ' +
  'first narration downloads its ~90 MB quantized model into KOKORO_MODELS_DIR, so that first ' +
  'render needs network the way the font download already does.';

/**
 * `generate()`'s voice option is `keyof typeof VOICES` in kokoro-js, and VOICES
 * is not re-exported -- so the union is derived from the package's own
 * signature instead of duplicating the bundled voice list here.
 */
type KokoroVoice = NonNullable<GenerateOptions['voice']>;

/** Progress notices from the model load; the worker turns them into status writes. */
type ProgressListener = (message: string) => void;

/**
 * The voice, and where the model lives.
 *
 * `KOKORO_MODELS_DIR` names the directory the model is cached in; unset, it is
 * the repo's `models/`. Both the configured value and the default resolve
 * against the project root rather than the working directory, so the same
 * setting and the same render find the same model from anywhere --
 * `KOKORO_MODELS_DIR=models` means the repo's `models/`, not a `models/` beside
 * whatever folder the render was started from.
 */
function kokoroConfig(): { voice: string; modelsDir: string } {
  const voice = process.env[KOKORO_VOICE_ENV]?.trim() || DEFAULT_KOKORO_VOICE;
  const configured = process.env[KOKORO_MODELS_DIR_ENV]?.trim();
  const modelsDir = configured
    ? path.resolve(PROJECT_ROOT, configured)
    : path.join(PROJECT_ROOT, DEFAULT_KOKORO_MODELS_DIR);
  return { voice, modelsDir };
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/**
 * Loads the one KokoroTTS session, once per worker run.
 *
 * transformers.js picks its file cache from `env.cacheDir` at load time and
 * reads no environment variable for it, and kokoro-js's own options carry no
 * cache_dir -- so the directory has to be set here, before `from_pretrained`.
 * Unset, the cache would land inside node_modules, which an install or a
 * prune silently wipes.
 *
 * The voice is checked against the bundled list the moment the model is up, so
 * a bad `KOKORO_VOICE` fails fast, naming the valid ones -- not per-scene,
 * halfway through a render. A load failure (no network on the first run, an
 * ONNX runtime that cannot start) is wrapped with the install hint; there is
 * no silent fallback and no second voice.
 */
async function loadKokoro(onProgress?: ProgressListener): Promise<KokoroTTS> {
  transformersEnv.cacheDir = kokoroConfig().modelsDir;

  let tts: KokoroTTS;
  try {
    tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: KOKORO_DTYPE,
      device: KOKORO_DEVICE,
      progress_callback: (info) => {
        // The callback fires for cache hits too; only a real download carries a
        // progress figure, so only those become status messages.
        if (info.status === 'progress') {
          onProgress?.(`Downloading the voice model (${Math.round(info.progress)}%)...`);
        }
      },
    });
  } catch (error) {
    throw new Error(
      `kokoro could not load its voice model: ${error instanceof Error ? error.message : String(error)} ${KOKORO_INSTALL_HINT}`,
    );
  }

  const { voice } = kokoroConfig();
  if (!Object.hasOwn(tts.voices, voice)) {
    throw new Error(
      `unknown ${KOKORO_VOICE_ENV} "${voice}": kokoro ships these voices: ` +
        `${Object.keys(tts.voices).sort().join(', ')}.`,
    );
  }
  return tts;
}

function getTts(onProgress?: ProgressListener): Promise<KokoroTTS> {
  // One session per worker run: loading the model is the slow part (90 MB off
  // disk even when cached) and every scene speaks through the same instance.
  ttsPromise ??= loadKokoro(onProgress);
  return ttsPromise;
}

/**
 * Speaks one narration into `outputPath` -- a 24 kHz mono WAV -- in-process.
 *
 * Callers own the temp-name + ffprobe + rename dance (the worker's
 * `synthesizeNarration`); this only produces the file. Never more than one
 * synthesis at a time: the worker's overlap structure starts the next scene's
 * voice only after awaiting this one's, so the single session is never
 * re-entered.
 */
export async function synthesize(
  text: string,
  outputPath: string,
  onProgress?: ProgressListener,
): Promise<void> {
  const { voice } = kokoroConfig();
  const tts = await getTts(onProgress);
  const audio = await tts.generate(text, { voice: voice as KokoroVoice });
  // RawAudio.save() writes the WAV itself (16-bit PCM) and is async in Node:
  // awaiting it is what keeps the caller's rename from racing the write.
  await audio.save(outputPath);
}
