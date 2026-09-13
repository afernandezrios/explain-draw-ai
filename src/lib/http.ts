/**
 * HTTP shapes shared by the API routes.
 *
 * Every route reports failures as `{ error, code, details? }` so the UI can
 * branch on `code` and show per-field `details` when the model returned
 * something that does not validate.
 */

import { NextResponse } from 'next/server';
import { LlmError } from './llm.ts';
import { PipelineError, isValidProjectId } from './pipeline.ts';

export type ErrorBody = {
  error: string;
  code: string;
  details?: string[];
};

/** A failure as data, so it can be built by code that does not know about HTTP. */
export type ApiFailure = { ok: false; status: number; body: ErrorBody };

/**
 * The body itself. Not exported: the envelope is what callers name
 * (`ErrorBody`), and everything here builds one through `failure` or `apiError`.
 */
function errorBody(code: string, message: string, details?: string[]): ErrorBody {
  const body: ErrorBody = { error: message, code };
  if (details && details.length > 0) {
    body.details = details;
  }
  return body;
}

/** A failure the caller is naming itself, rather than one thrown by the pipeline. */
export function failure(status: number, code: string, message: string, details?: string[]): ApiFailure {
  return { ok: false, status, body: errorBody(code, message, details) };
}

/**
 * The one mapping from a thrown pipeline/LLM error onto an HTTP failure.
 *
 * Shared with `generate.ts`, which runs the same pipeline for the tests with an
 * injected model and returns failures as data: two mappings would be two places
 * for a status code to drift.
 */
export function failureFrom(error: unknown): ApiFailure {
  if (error instanceof PipelineError) {
    switch (error.kind) {
      case 'empty-input':
        return failure(400, 'EMPTY_INPUT', error.message);
      case 'input-too-long':
        return failure(400, 'INPUT_TOO_LONG', error.message);
      case 'bad-project-id':
        return failure(400, 'BAD_PROJECT_ID', error.message);
    }
  }
  if (error instanceof LlmError) {
    switch (error.kind) {
      case 'missing-key':
        return failure(500, 'MISSING_KEY', error.message);
      case 'invalid-output':
        return failure(422, 'INVALID_LLM_JSON', error.message, error.details);
      case 'request-failed':
        return failure(502, 'LLM_REQUEST_FAILED', error.message, error.details);
    }
  }
  return failure(500, 'INTERNAL', error instanceof Error ? error.message : 'Something went wrong.');
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: string[],
): NextResponse {
  return NextResponse.json(errorBody(code, message, details), { status });
}

/** Guards against an id that would escape the projects directory. */
export function requireProjectId(id: string): NextResponse | null {
  return isValidProjectId(id) ? null : apiError(400, 'BAD_PROJECT_ID', `Not a valid project id: ${id}`);
}
