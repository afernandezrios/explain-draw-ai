/**
 * HTTP byte ranges (RFC 9110), used by the video route.
 *
 * Kept out of `http.ts` so the parsing rule can be tested on its own: importing
 * `http.ts` pulls in `next/server`, which a unit-level check of a pure function
 * should not need.
 */

export type ByteRange = { start: number; end: number };
/** `null` means "no usable range, send the whole file". */
export type RangeResult = ByteRange | 'unsatisfiable' | null;

/**
 * A Range header that does not parse is ignored and the whole file is served
 * with 200; a range that parses but cannot be satisfied gets 416.
 *
 * `last-byte-pos < first-byte-pos` belongs to the first group, not the second:
 * RFC 9110 §14.1.2 calls such a byte-range-spec *invalid*, and an invalid Range
 * header field is ignored (the whole file, 200) -- `bytes=5-1` is a caller's
 * mistake, not a request for bytes that do not exist.
 */
export function parseRange(header: string, size: number): RangeResult {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    // Malformed, or a multi-range request. Both fall back to the whole file.
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    return null;
  }

  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) {
      return 'unsatisfiable';
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) {
    return 'unsatisfiable';
  }
  if (rawEnd === '') {
    return { start, end: size - 1 };
  }
  const end = Number(rawEnd);
  if (end < start) {
    // An invalid byte-range-spec, so the whole header is ignored.
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}
