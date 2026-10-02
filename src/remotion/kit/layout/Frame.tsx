/**
 * The scene shell: canvas, grid, header, and the content box everything is laid
 * out inside.
 *
 * Every scene in the kit is a `Frame` around a body, which is what makes six
 * different scene types look like one video: the margins, the header's
 * position, the size of a title and the accent glow behind it are decided here,
 * once, and a scene only chooses *what* it draws.
 *
 * The content box is handed down by context as a pair of numbers rather than
 * measured from the DOM. Measurements need a ref, a `delayRender` and a frame
 * rendered twice; arithmetic needs `frameContentBox`. A scene that lays out a
 * diagram reads the box and places nodes at exact pixel coordinates, which is
 * also what lets it tell an edge where the box's border is.
 *
 * The header is animated here too, and on its own beat: it is the one part of
 * a scene that is always the same, so it is also the one part whose entrance
 * should never be re-invented per scene.
 */

import React, { createContext, useContext } from 'react';
import type { CSSProperties } from 'react';
import { Interactive, useCurrentFrame, useVideoConfig } from 'remotion';
import { LAYOUT, alpha, frameContentBox, type Accent } from '../tokens.ts';
import { KitTheme, resolveTheme, useTheme, type ThemeProp } from '../theme.tsx';
import { useKitFonts } from '../fonts.ts';
import { AccentRule, Text } from '../primitives/Text.tsx';
import { revealStyle } from '../animation/presets.ts';
import { toFrames } from '../animation/timing.ts';

export type FrameBox = { width: number; height: number };

/** The default is the no-header box, so a component rendered outside a Frame
 * still lays out against a real size. */
const FrameBoxContext = createContext<FrameBox>(frameContentBox(false, false));

/** The pixel box a scene body may draw in. Never larger than the canvas. */
export function useFrameBox(): FrameBox {
  return useContext(FrameBoxContext);
}

export type FrameProps = {
  children: React.ReactNode;
  /** The scene's name in the Studio timeline. Hardcode it at the call site. */
  name: string;
  /** The small uppercase line above the title: a chapter, a section, a noun. */
  eyebrow?: string;
  /** One line, by contract -- see LAYOUT in tokens.ts. */
  title?: string;
  accent?: Accent;
  theme?: ThemeProp;
  /** The blueprint grid. Off for a scene that wants to feel like a slide. */
  grid?: boolean;
  footer?: React.ReactNode;
  /** Applied to the scene root, for an entrance that moves the whole scene. */
  style?: CSSProperties;
};

export const Frame: React.FC<FrameProps> = (props) => (
  <KitTheme theme={resolveTheme(props.theme)}>
    <FrameBody {...props} />
  </KitTheme>
);

const FrameBody: React.FC<FrameProps> = ({
  children,
  name,
  eyebrow,
  title,
  accent = 'blue',
  grid = true,
  footer,
  style,
}) => {
  useKitFonts();
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hasHeader = title !== undefined || eyebrow !== undefined;
  const box = frameContentBox(hasHeader, footer !== undefined);
  const headerBeat = { delay: 0, duration: toFrames(0.5, fps) };

  return (
    <Interactive.Div
      name={name}
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: theme.bg,
        overflow: 'hidden',
        ...style,
      }}
    >
      {grid ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(${theme.grid} 1px, transparent 1px), linear-gradient(90deg, ${theme.grid} 1px, transparent 1px)`,
            backgroundSize: `${LAYOUT.gridStep}px ${LAYOUT.gridStep}px`,
          }}
        />
      ) : null}

      {/* A wash of the scene's accent, so a scene about queues and a scene about
          caching are told apart before a word is read. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(1400px 820px at 14% -12%, ${alpha(theme.accent[accent], theme.name === 'dark' ? 17 : 11)}, transparent 68%)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: `${LAYOUT.padTop}px ${LAYOUT.padX}px ${LAYOUT.padBottom}px`,
        }}
      >
        {hasHeader ? (
          <div
            style={{
              height: LAYOUT.headerHeight,
              marginBottom: LAYOUT.headerGap,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 16,
            }}
          >
            {eyebrow === undefined ? null : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  ...revealStyle('slideRight', frame, headerBeat, 12),
                }}
              >
                <AccentRule progress={1} width={38} accent={accent} thickness={4} />
                <Text variant="label" tone="secondary">
                  {eyebrow}
                </Text>
              </div>
            )}
            {title === undefined ? null : (
              <div style={revealStyle('rise', frame, headerBeat, 20)}>
                <Text variant="title" clamp={1}>
                  {title}
                </Text>
              </div>
            )}
          </div>
        ) : null}

        <FrameBoxContext.Provider value={box}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{children}</div>
        </FrameBoxContext.Provider>

        {footer === undefined ? null : (
          <div
            style={{
              height: LAYOUT.footerHeight,
              marginTop: LAYOUT.footerGap,
              display: 'flex',
              alignItems: 'center',
              ...revealStyle('fade', frame, { delay: headerBeat.duration, duration: headerBeat.duration }),
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </Interactive.Div>
  );
};

/**
 * The one-line caption under a scene's diagram, for the sentence the narration
 * lands on. Belongs in a `Frame`'s footer.
 */
export const FrameCaption: React.FC<{ children: React.ReactNode; accent?: Accent }> = ({
  children,
  accent = 'blue',
}) => {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: theme.accent[accent] }}
      />
      <Text variant="small" tone="secondary">
        {children}
      </Text>
    </div>
  );
};
