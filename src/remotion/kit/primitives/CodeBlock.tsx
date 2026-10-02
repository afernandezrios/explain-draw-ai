/**
 * A listing in a window.
 *
 * The chrome is not decoration: three dots and a filename tell the viewer "this
 * is a file you could open", which is the difference between a code scene that
 * reads as a screenshot of a real system and one that reads as a slide.
 *
 * Lines arrive one at a time on the beats the scene hands in, and the line that
 * has just landed carries a highlight that fades behind it -- attention on the
 * line the narration is on, without anything moving.
 */

import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { FONT, alpha, mix, type Accent } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import {
  LANGUAGE_LABEL,
  tokenize,
  type Language,
  type Token,
  type TokenKind,
} from '../lib/highlight.ts';
import { revealStyle } from '../animation/presets.ts';
import type { Timing } from '../animation/timing.ts';

/** Matches `TYPE.code.fontSize`, as a number the fitting maths can use. */
export const DEFAULT_CODE_FONT_SIZE = 26;

export type CodeBlockProps = {
  code: string;
  language?: Language;
  /** What the window's title bar says: a filename, a URL, a topic. */
  title?: string;
  /** 1-based line numbers that stay emphasised for the whole scene. */
  highlight?: number[];
  /** One beat per line, from `paceReveals`. Without it the listing is simply
   * there, which is what a scene that is being talked *about* wants. */
  reveals?: Timing[];
  showLineNumbers?: boolean;
  startLine?: number;
  fontSize?: number;
  accent?: Accent;
  style?: CSSProperties;
};

function tokenColor(kind: TokenKind, theme: ReturnType<typeof useTheme>): string {
  switch (kind) {
    case 'keyword':
      return theme.code.keyword;
    case 'string':
      return theme.code.string;
    case 'number':
      return theme.code.number;
    case 'comment':
      return theme.code.comment;
    case 'fn':
      return theme.code.fn;
    case 'property':
      return theme.code.property;
    case 'punct':
      return theme.code.punct;
    case 'plain':
      return theme.code.plain;
  }
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'ts',
  title,
  highlight,
  reveals,
  showLineNumbers = true,
  startLine = 1,
  fontSize = DEFAULT_CODE_FONT_SIZE,
  accent = 'blue',
  style,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const lines = useMemo(() => tokenize(code, language), [code, language]);
  const marked = useMemo(() => new Set(highlight ?? []), [highlight]);
  const lineHeight = Math.round(fontSize * 1.62);

  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 22,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '18px 26px',
          borderBottom: `1px solid ${theme.border}`,
          backgroundColor: mix(theme.text, 3, theme.surface),
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((dot) => (
          <div
            key={dot}
            style={{ width: 13, height: 13, borderRadius: 999, backgroundColor: alpha(dot, 85) }}
          />
        ))}
        {title === undefined ? null : (
          <div
            style={{
              marginLeft: 10,
              fontFamily: FONT.mono,
              fontSize: 21,
              color: theme.textSecondary,
            }}
          >
            {title}
          </div>
        )}
        <div
          style={{
            marginLeft: 'auto',
            fontFamily: FONT.mono,
            fontSize: 19,
            color: theme.textMuted,
            letterSpacing: '0.04em',
          }}
        >
          {LANGUAGE_LABEL[language]}
        </div>
      </div>

      <div style={{ padding: '22px 0', flex: 1, overflow: 'hidden' }}>
        {lines.map((tokens, index) => {
          const lineNumber = startLine + index;
          const beat = reveals?.[index];
          const isMarked = marked.has(lineNumber);
          // The flash peaks as the line lands and is gone a beat later: it
          // marks where to look, it does not become part of the listing.
          const flash =
            beat === undefined
              ? 0
              : interpolate(
                  frame,
                  [beat.delay, beat.delay + beat.duration * 0.4, beat.delay + beat.duration * 2.2],
                  [0, 0.5, 0],
                  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
                );

          return (
            <div
              key={lineNumber}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                height: lineHeight,
                whiteSpace: 'pre',
                backgroundColor: isMarked
                  ? mix(theme.accent[accent], 12, 'transparent')
                  : flash > 0.002
                    ? alpha(theme.accent[accent], flash * 100)
                    : undefined,
                boxShadow: isMarked ? `inset 3px 0 0 0 ${theme.accent[accent]}` : undefined,
                ...(beat === undefined ? {} : revealStyle('rise', frame, beat, 8)),
              }}
            >
              {showLineNumbers ? (
                <div
                  style={{
                    width: 64,
                    flexShrink: 0,
                    textAlign: 'right',
                    paddingRight: 22,
                    fontFamily: FONT.mono,
                    fontSize: Math.round(fontSize * 0.82),
                    color: theme.code.lineNumber,
                  }}
                >
                  {lineNumber}
                </div>
              ) : null}
              <div style={{ fontFamily: FONT.mono, fontSize, lineHeight: `${lineHeight}px` }}>
                {tokens.length === 0 ? (
                  <span>{' '}</span>
                ) : (
                  tokens.map((token: Token, tokenIndex: number) => (
                    <span
                      key={`${tokenIndex}-${token.text}`}
                      style={{
                        color: tokenColor(token.kind, theme),
                        fontStyle: token.kind === 'comment' ? 'italic' : undefined,
                      }}
                    >
                      {token.text}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
