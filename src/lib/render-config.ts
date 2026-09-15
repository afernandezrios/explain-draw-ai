/**
 * The render contract.
 *
 * Every scene is rendered with exactly these settings. ffmpeg concatenates the
 * scene clips with `-c copy`, which is only lossless when every clip agrees on
 * codec, pixel format, frame rate and canvas -- so these values are shared by
 * the composition, the worker, the API routes and the tests rather than being
 * repeated at each call site.
 */

export const FPS = 24;
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const VIDEO_CODEC = 'h264';
export const PIXEL_FORMAT = 'yuv420p';
export const CRF = 18;
export const X264_PRESET = 'medium';
export const IMAGE_FORMAT = 'png';

/**
 * The audio half of that agreement: every clip carries its scene's narration as
 * an audio track, and ffmpeg's `-c copy` join passes those tracks through
 * untouched -- which is only lossless while every clip encodes audio the same
 * way. Same codec and bitrate here, same sample rate and channel layout by
 * construction (every clip goes through the same renderer), so a preview clip
 * and a full-render clip stay interchangeable.
 */
export const AUDIO_CODEC = 'aac';
export const AUDIO_BITRATE = '192k';

/**
 * A clip whose loudest sample is at or below this is refused as silent. The
 * audio track is guaranteed to exist whether or not the composition played
 * anything, so an audio stream on its own proves nothing: a scene that rendered
 * with no narration would otherwise join into a video that is silent for that
 * scene's whole length and ship as if it were fine. -50 dB is far below any
 * speech and far above the digital silence a missing `<Audio>` produces.
 */
export const AUDIO_SILENCE_MAX_VOLUME_DB = -50;

/**
 * Frame concurrency is capped by design: this is a solo app on a 7.6 GiB
 * laptop and one render runs at a time. Raising it is not a supported knob.
 */
export const MAX_FRAME_CONCURRENCY = 2;

export const INPUT_FILENAME = 'input.txt';
export const SCRIPT_FILENAME = 'script.json';
export const SCENES_FILENAME = 'scenes.json';
export const STATUS_FILENAME = 'status.json';
/** The worker's stdout/stderr for the most recent job; truncated at job start. */
export const RENDER_LOG_FILENAME = 'render.log';
export const OUTPUT_FILENAME = 'out.mp4';
export const PREVIEW_FILENAME = 'preview.mp4';
/**
 * The preview scene renders here first and is then renamed to preview.mp4, so
 * previewing can never clobber a finished clip from a real render -- and a
 * cancelled preview leaves the previous preview.mp4 intact.
 */
export const PREVIEW_CLIP_FILENAME = 'preview-clip.mp4';
export const CLIPS_DIRNAME = 'clips';
/**
 * One WAV per scene, worker-owned, beside `clips/`. The worker writes them
 * before bundling, the bundle serves them to the composition, and nothing prunes
 * them -- the same posture as `clips/`.
 */
export const NARRATION_DIRNAME = 'narration';

/**
 * How far a narration WAV may run past its scene's own length before the render
 * is refused, in seconds. One frame, and nothing more: the scene's length is
 * frame-rounded while the WAV's duration is a real measurement, so the slack
 * absorbs that rounding -- the WAV is allowed the fraction of a frame the
 * rounded scene length left over. Anything longer than that is a narration that
 * does not fit its scene, and it is refused rather than truncated or sped up to
 * make it fit: a clipped syllable is a broken video, and a rejected render is
 * not.
 */
export const NARRATION_OVERRUN_TOLERANCE_SECONDS = 1 / FPS;

/**
 * Piper, the local text-to-speech engine (see the README's prerequisites).
 *
 * The worker spawns `piper` from PATH, and `PIPER_MODELS_DIR` is the directory
 * the voice's model file is resolved from: the worker passes the joined,
 * absolute `<dir>/<voice>.onnx` path to piper, so a relative directory here is
 * resolved against the project root rather than the working directory. Nothing
 * here is bundled or uploaded: synthesis is a local subprocess, and the default
 * voice is the one model the README asks the user to download.
 */
export const PIPER_VOICE_ENV = 'PIPER_VOICE';
export const PIPER_MODELS_DIR_ENV = 'PIPER_MODELS_DIR';
export const DEFAULT_PIPER_VOICE = 'en_US-lessac-medium';
/** Relative to the project's own root, not the working directory. */
export const DEFAULT_PIPER_MODELS_DIR = 'models';

/** The app's only cross-project state: at most one render exists at a time. */
export const LOCK_FILENAME = '.active-render.json';

/** Longest generate input we will accept, in characters. */
export const MAX_INPUT_CHARS = 20_000;

/**
 * Longest script title we will accept, in characters. The title travels to the
 * model with the script, so it is capped like the script is -- and the script
 * schema asks the model for the same limit, so a hand-typed title cannot be
 * longer than one the model is allowed to return.
 */
export const MAX_TITLE_CHARS = 160;

export function sceneClipName(index: number): string {
  return `scene-${String(index).padStart(3, '0')}.mp4`;
}

/** Mirrors `sceneClipName`, including the storyboard index it is keyed by. */
export function narrationFileName(index: number): string {
  return `scene-${String(index).padStart(3, '0')}.wav`;
}

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}
