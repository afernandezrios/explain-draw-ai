import { loadFont } from '@remotion/google-fonts/Inter';
import React from 'react';
import { useVideoConfig } from 'remotion';
import { CODE_THEMES } from '@/remotion/lib/code-syntax';
import { getSafeAreaPadding } from '@/remotion/lib/layout';
import { BadgeStamp } from '@/remotion/primitives/badge-stamp';
import { FadeIn } from '@/remotion/primitives/fade-in';
import { MarkerHighlight } from '@/remotion/primitives/marker-highlight';
import { SlideUp } from '@/remotion/primitives/slide-up';
import { StaggerChildren } from '@/remotion/primitives/stagger-children';
import { Typewriter } from '@/remotion/primitives/typewriter';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

/** Mirrors the accent the registry blocks default to, so the page keeps one voice. */
const DEFAULT_ACCENT = '#E8B86D';

export type ConceptTerm = {
  term: string;
  note?: string | null;
};

/** The scene's own copy, in the two forms the timeline and the component share. */
export type ConceptCopy = {
  explanation: string;
  terms: ConceptTerm[];
  keyPoints: string[];
  takeaway?: string | null;
};

/**
 * The concept scene has no registry block to lean on -- no single block reads as
 * "a paragraph plus its vocabulary" -- so it is assembled here from the adopted
 * primitives, with one beat plan below that both the drawing and the length
 * estimate read. `conceptTimeline` is the shared source: the component maps its
 * beats to frames, `nominalSeconds` in ./scene-adapters takes its `total`.
 */

/** Beat plan in seconds, at speed 1. */
const BEAT = {
  eyebrow: 0.15,
  eyebrowFor: 0.45,
  title: 0.2,
  titleFor: 0.5,
  /** The paragraph starts typing here. */
  explanation: 0.9,
  /** Characters per second the paragraph is written at. */
  typingCps: 33,
  minTyping: 1.2,
  maxTyping: 14,
  /** The first term is swept this long after the paragraph lands. */
  termsAfter: 0.35,
  /** Seconds between one term being struck and the next. */
  termStagger: 0.3,
  /** Length of the sweep across one term. */
  termSweep: 0.5,
  pointsAfter: 0.25,
  pointStagger: 0.22,
  /** How long one key point takes to rise in. */
  pointIn: 0.4,
  takeawayAfter: 0.35,
  takeawayIn: 0.5,
  /** A beat of quiet after the last thing lands. */
  settle: 0.3,
} as const;

/** How long the paragraph takes to type: a reading rate, not a keyboard's. */
function typingSeconds(explanation: string): number {
  return Math.min(
    BEAT.maxTyping,
    Math.max(BEAT.minTyping, explanation.length / BEAT.typingCps),
  );
}

export type ConceptTimeline = {
  eyebrow: number;
  title: number;
  /** When the paragraph starts typing, and for how long. */
  explanation: number;
  typingSeconds: number;
  /** When the first term is swept. */
  terms: number;
  /** When the first key point rises. */
  keyPoints: number;
  /** When the takeaway stamp lands. */
  takeaway: number;
  /** Every beat landed, plus a settle -- what the block naturally wants. */
  total: number;
};

/**
 * Where each beat falls, in scene seconds at speed 1. The stack reads top to
 * bottom, so each stage starts once the one above it has landed; the total is
 * what `speedFor` stretches a short scene against.
 */
export function conceptTimeline(copy: ConceptCopy): ConceptTimeline {
  const typing = typingSeconds(copy.explanation);
  const explanationEnd = BEAT.explanation + typing;

  const terms = copy.terms.length > 0 ? explanationEnd + BEAT.termsAfter : explanationEnd;
  const termsEnd =
    copy.terms.length > 0
      ? terms + (copy.terms.length - 1) * BEAT.termStagger + BEAT.termSweep
      : explanationEnd;

  const keyPoints = copy.keyPoints.length > 0 ? termsEnd + BEAT.pointsAfter : termsEnd;
  const pointsEnd =
    copy.keyPoints.length > 0
      ? keyPoints + (copy.keyPoints.length - 1) * BEAT.pointStagger + BEAT.pointIn
      : termsEnd;

  const takeaway = copy.takeaway ? pointsEnd + BEAT.takeawayAfter : pointsEnd;
  const takeawayEnd = copy.takeaway ? takeaway + BEAT.takeawayIn : pointsEnd;

  return {
    eyebrow: BEAT.eyebrow,
    title: BEAT.title,
    explanation: BEAT.explanation,
    typingSeconds: typing,
    terms,
    keyPoints,
    takeaway,
    total: takeawayEnd + BEAT.settle,
  };
}

export type ConceptProps = ConceptCopy & {
  title: string;
  eyebrow?: string | null;
  theme?: 'dark' | 'light';
  accentColor?: string;
  /** Animation speed multiplier, from the adapter's fitted-duration rule. */
  speed?: number;
};

/**
 * An explanation written out: the paragraph types on under a resting caret, the
 * terms worth knowing are struck with the marker in turn, the points to keep
 * rise as a staggered list, and the one line to remember is stamped on.
 */
export const ConceptScene: React.FC<ConceptProps> = ({
  title,
  eyebrow,
  explanation,
  terms = [],
  keyPoints = [],
  takeaway,
  theme = 'dark',
  accentColor = DEFAULT_ACCENT,
  speed = 1,
}) => {
  const { fps, width, height } = useVideoConfig();
  const palette = CODE_THEMES[theme];
  const safe = getSafeAreaPadding({ width, height });
  const timeline = conceptTimeline({ explanation, terms, keyPoints, takeaway });

  /** The blocks' own speed convention: a beat at `seconds` sits at this frame. */
  const at = (seconds: number) => (seconds * fps) / speed;
  const forSeconds = (seconds: number) =>
    Math.max(1, Math.round((seconds * fps) / speed));

  const stage = {
    w: width - safe.paddingLeft - safe.paddingRight,
    h: height - safe.paddingTop - safe.paddingBottom,
  };
  const portrait = height > width;
  const u = portrait
    ? Math.min(stage.w / 620, stage.h / 1120)
    : Math.min(stage.w / 1120, stage.h / 620);

  /** Guard against a zero-length paragraph dividing the typing rate by zero. */
  const characters = Math.max(1, explanation.length);

  return (
    <div
      style={{
        width,
        height,
        background: palette.page,
        fontFamily,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 70% 55% at 50% 24%, ${accentColor}14, transparent 70%)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: safe.paddingLeft,
          top: safe.paddingTop,
          width: stage.w,
          height: stage.h,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {eyebrow || title ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 * u }}>
            {eyebrow ? (
              <FadeIn
                delayInFrames={at(timeline.eyebrow)}
                durationInFrames={forSeconds(BEAT.eyebrowFor)}
              >
                <div
                  style={{
                    color: accentColor,
                    fontSize: 20 * u,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                  }}
                >
                  {eyebrow}
                </div>
              </FadeIn>
            ) : null}
            {title ? (
              <SlideUp
                mask
                block
                delayInFrames={at(timeline.title)}
                durationInFrames={forSeconds(BEAT.titleFor)}
              >
                <h2
                  style={{
                    margin: 0,
                    color: palette.fg,
                    fontSize: 52 * u,
                    fontWeight: 700,
                    lineHeight: 1.06,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {title}
                </h2>
              </SlideUp>
            ) : null}
          </div>
        ) : null}

        <FadeIn
          block
          delayInFrames={at(timeline.explanation - 0.2)}
          durationInFrames={forSeconds(0.4)}
          style={{ marginTop: 20 * u }}
        >
          <Typewriter
            text={explanation}
            charFrames={(timeline.typingSeconds * fps) / (speed * characters)}
            delayInFrames={at(timeline.explanation)}
            fontSize={29 * u}
            fontWeight={400}
            color={palette.fg}
            cursorColor={accentColor}
            fontFamily={fontFamily}
            style={{ lineHeight: 1.55 }}
          />
        </FadeIn>

        {terms.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: 44 * u,
              rowGap: 16 * u,
              marginTop: 30 * u,
            }}
          >
            {terms.map((term, index) => (
              <div
                key={`${term.term}-${index}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 4 * u }}
              >
                <MarkerHighlight
                  text={term.term}
                  phrase={term.term}
                  variant="marker"
                  markerColor={accentColor}
                  color={palette.fg}
                  fontSize={24 * u}
                  fontWeight={600}
                  delayInFrames={at(timeline.terms + index * BEAT.termStagger)}
                  durationInFrames={forSeconds(BEAT.termSweep)}
                  staggerInFrames={forSeconds(0.1)}
                />
                {term.note ? (
                  <span style={{ color: palette.faint, fontSize: 19 * u, lineHeight: 1.35 }}>
                    {term.note}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {keyPoints.length > 0 ? (
          <StaggerChildren
            staggerInFrames={forSeconds(BEAT.pointStagger)}
            baseDelayInFrames={at(timeline.keyPoints)}
          >
            {keyPoints.map((point, index) => (
              <SlideUp
                key={`${point}-${index}`}
                block
                distance={14 * u}
                durationInFrames={forSeconds(BEAT.pointIn)}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12 * u,
                    marginTop: index === 0 ? 24 * u : 9 * u,
                  }}
                >
                  <span
                    style={{
                      width: 7 * u,
                      height: 7 * u,
                      marginTop: 9 * u,
                      borderRadius: '50%',
                      background: accentColor,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: palette.dim, fontSize: 23 * u, lineHeight: 1.4 }}>
                    {point}
                  </span>
                </div>
              </SlideUp>
            ))}
          </StaggerChildren>
        ) : null}

        {takeaway ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24 * u,
              marginTop: 32 * u,
            }}
          >
            <BadgeStamp
              label="KEY"
              ringText="TAKEAWAY"
              size={132 * u}
              color={accentColor}
              delayInFrames={at(timeline.takeaway)}
            />
            <FadeIn
              block
              delayInFrames={at(timeline.takeaway + 0.2)}
              durationInFrames={forSeconds(BEAT.takeawayIn)}
            >
              <span
                style={{
                  color: palette.fg,
                  fontSize: 26 * u,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {takeaway}
              </span>
            </FadeIn>
          </div>
        ) : null}
      </div>
    </div>
  );
};
