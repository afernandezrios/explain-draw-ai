/**
 * A box with a name on it: one system, one service, one store.
 *
 * `Node` is the semantic markup primitive -- what a diagram is *about* -- where
 * `Box` is only a rectangle. It is a `Box` with a `Label`, an optional icon and
 * an optional sublabel, laid out centred so the same component reads well at
 * 150px and at 300px wide; `Connection` takes the rectangle it was placed at
 * and stops its arrow on the border.
 *
 * `DiagramNode` is the scene-level cousin and stays as it is: it carries the
 * video's fixed stack/inline height contract, which is what a scene's grid math
 * relies on. `Node` has no such contract -- it is sized by the markup author,
 * and it clips its own text rather than growing past the rectangle an arrow was
 * anchored to.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import type { Accent, Tone } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { type RevealPreset } from '../animation/presets.ts';
import type { Timing } from '../animation/timing.ts';
import { Box } from './Box.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { Label } from './Label.tsx';

export type NodeProps = {
  label: string;
  sublabel?: string;
  icon?: IconName;
  accent?: Accent;
  tone?: Tone;
  /** Absolute placement in the nearest positioned ancestor, in pixels -- the
   * rectangle a `Connection` snaps to. Omit `x`/`y` to let the node sit in
   * flow. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** When to arrive, in frames from the composition's start. Omit to draw it at
   * rest. */
  enter?: Timing;
  preset?: RevealPreset;
  distance?: number;
  style?: CSSProperties;
};

export const Node: React.FC<NodeProps> = ({
  label,
  sublabel,
  icon,
  accent,
  tone,
  x,
  y,
  w,
  h,
  enter,
  preset = 'pop',
  distance,
  style,
}) => {
  const theme = useTheme();
  const tint = accent === undefined ? theme.textSecondary : theme.accent[accent];

  return (
    <Box
      x={x}
      y={y}
      w={w}
      h={h}
      pad={22}
      tone={tone}
      accent={accent}
      center
      enter={enter}
      preset={preset}
      distance={distance}
      style={style}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          minWidth: 0,
        }}
      >
        {icon === undefined ? null : <Icon name={icon} size={30} color={tint} />}
        <Label variant="subheading" align="center" clamp={2} style={{ width: '100%', fontWeight: 600 }}>
          {label}
        </Label>
        {sublabel === undefined ? null : (
          <Label variant="small" tone="muted" mono align="center" clamp={1} style={{ width: '100%' }}>
            {sublabel}
          </Label>
        )}
      </div>
    </Box>
  );
};
