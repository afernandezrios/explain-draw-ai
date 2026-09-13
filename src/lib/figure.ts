/**
 * The stick figure's skeleton, as fractions of its own `height`.
 *
 * One skeleton, two readers: `doodle.ts` builds the limbs from these numbers,
 * and `schema.ts` bounds the figure by them -- the drawing and the validator
 * must agree about where the feet are, and two copies of `0.5` would not stay
 * equal. A leaf module with no imports, so `schema.ts` can share them without
 * dragging rough.js into everything that validates a storyboard.
 *
 * Signs follow the drawing: positive is below the figure's centre, so
 * `HEAD_ABOVE` and `SHOULDER_ABOVE` are subtracted from the centre y.
 */

/** The head is a circle of `HEAD_RADIUS` centred `HEAD_ABOVE` above the centre. */
export const HEAD_ABOVE = 0.3;
export const HEAD_RADIUS = 0.15;

/** The joints the limbs hang from. */
export const SHOULDER_ABOVE = 0.14;
export const HIP_BELOW = 0.16;

/** How far the legs and arms spread sideways, and where the arms hang. */
export const ARM_SPREAD = 0.24;
export const LEG_SPREAD = 0.16;
export const ARM_BELOW = 0.02;

/** The feet: the lowest point of the figure, and the end of the legs. */
export const FEET_BELOW = 0.5;
