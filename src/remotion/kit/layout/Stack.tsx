/**
 * Flex and grid, with the kit's defaults.
 *
 * These are thin on purpose -- they exist so a scene reads as layout rather
 * than as CSS, and so `gap: SPACE.lg` is spelled once instead of a hundred
 * times. Anything that needs more than this should use a plain `div` with a
 * `style`, which is honest about being a one-off.
 */

import React from 'react';
import type { CSSProperties } from 'react';

export type RowProps = {
  children?: React.ReactNode;
  gap?: number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
  style?: CSSProperties;
};

export const Row: React.FC<RowProps> = ({
  children,
  gap = 24,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: align,
      justifyContent: justify,
      gap,
      flexWrap: wrap ? 'wrap' : undefined,
      ...style,
    }}
  >
    {children}
  </div>
);

export type ColumnProps = {
  children?: React.ReactNode;
  gap?: number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  style?: CSSProperties;
};

export const Column: React.FC<ColumnProps> = ({
  children,
  gap = 24,
  align = 'stretch',
  justify = 'flex-start',
  style,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, justifyContent: justify, gap, ...style }}>
    {children}
  </div>
);

export type GridProps = {
  children?: React.ReactNode;
  columns: number;
  gap?: number;
  style?: CSSProperties;
};

export const Grid: React.FC<GridProps> = ({ children, columns, gap = 24, style }) => (
  <div
    style={{
      display: 'grid',
      // minmax(0, 1fr) rather than 1fr: a grid track will otherwise refuse to
      // shrink below its content, which is how a long string pushes a diagram
      // off the right of the canvas.
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Fills its parent and centres what is inside it. */
export const Center: React.FC<{ children?: React.ReactNode; style?: CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style,
    }}
  >
    {children}
  </div>
);
