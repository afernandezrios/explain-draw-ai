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
 * Frame concurrency is capped by design: this is a solo app on a 7.6 GiB
 * laptop and one render runs at a time. Raising it is not a supported knob.
 */
export const MAX_FRAME_CONCURRENCY = 2;

export const INPUT_FILENAME = 'input.txt';
export const SCRIPT_FILENAME = 'script.json';
export const SCENES_FILENAME = 'scenes.json';
export const STATUS_FILENAME = 'status.json';
export const OUTPUT_FILENAME = 'out.mp4';
export const PREVIEW_FILENAME = 'preview.mp4';
/**
 * The preview scene renders here first and is then renamed to preview.mp4, so
 * previewing can never clobber a finished clip from a real render -- and a
 * cancelled preview leaves the previous preview.mp4 intact.
 */
export const PREVIEW_CLIP_FILENAME = 'preview-clip.mp4';
export const CLIPS_DIRNAME = 'clips';

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

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}
