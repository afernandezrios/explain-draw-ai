/**
 * A box in a diagram: one system, one service, one store.
 *
 * It exists so that `FlowScene` and `TopologyScene` draw the same object, and
 * so that an edge has something to be drawn to: the component fills exactly the
 * width and height it is given, which is the rectangle the scene hands to
 * `segmentBetween` when it works out where the arrows stop.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { alpha, mix, type Accent } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { Surface } from './Surface.tsx';
import { Text } from './Text.tsx';

export const NODE_DEFAULT_WIDTH = 300;
/**
 * The height at which the stacked form fits: padding, a 56px icon chip, a
 * one-line label and a sublabel, and not a pixel to spare. Below it the node
 * switches to the inline row -- an icon above a label needs the room, and a
 * label that spilled out of its own rectangle would be drawn outside the box
 * its edges are anchored to.
 */
export const NODE_STACK_MIN_HEIGHT = 206;
/** The default box: the stacked form at its natural size. */
export const NODE_DEFAULT_HEIGHT = NODE_STACK_MIN_HEIGHT;

export type DiagramNodeProps = {
  label: string;
  sublabel?: string;
  icon?: IconName;
  accent?: Accent;
  width?: number;
  height?: number;
  style?: CSSProperties;
};

export const DiagramNode: React.FC<DiagramNodeProps> = ({
  label,
  sublabel,
  icon,
  accent,
  width = NODE_DEFAULT_WIDTH,
  height = NODE_DEFAULT_HEIGHT,
  style,
}) => {
  const theme = useTheme();
  const tint = accent === undefined ? theme.textSecondary : theme.accent[accent];
  // A short box reads better as a row than as a stack, and it also keeps the
  // label inside the rectangle the edges are anchored to.
  const inline = height < NODE_STACK_MIN_HEIGHT;
  const chip = inline ? 48 : 56;

  const iconChip =
    icon === undefined ? null : (
      <div
        style={{
          width: chip,
          height: chip,
          flexShrink: 0,
          borderRadius: inline ? 14 : 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            accent === undefined
              ? alpha(theme.borderStrong, 60)
              : mix(theme.accent[accent], 16, theme.surface),
        }}
      >
        <Icon name={icon} size={inline ? 26 : 30} color={tint} />
      </div>
    );

  const words = (
    <div style={{ minWidth: 0 }}>
      <Text variant={inline ? 'body' : 'subheading'} clamp={2} style={{ fontWeight: 600 }}>
        {label}
      </Text>
      {sublabel === undefined ? null : (
        <Text variant="small" tone="muted" mono clamp={1} style={{ marginTop: 6 }}>
          {sublabel}
        </Text>
      )}
    </div>
  );

  return (
    <Surface
      accent={accent}
      pad={inline ? 20 : 22}
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: inline ? 'center' : 'flex-start',
        // A box taller than the form is centred rather than left with its icon
        // pinned to the ceiling: the topology grid hands out cells of whatever
        // height the row count implies.
        justifyContent: inline ? 'flex-start' : 'center',
        gap: inline ? 18 : 0,
        ...style,
      }}
    >
      {iconChip}
      {inline ? (
        words
      ) : (
        // A two-line label can outgrow even the stacked height; it clips inside
        // the node rather than spilling past the border an edge stops at.
        <div style={{ marginTop: icon === undefined ? 0 : 16, minHeight: 0, overflow: 'hidden' }}>
          {words}
        </div>
      )}
    </Surface>
  );
};
