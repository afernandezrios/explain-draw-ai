/**
 * A short label in a capsule: an HTTP method, a status code, a topic name, a
 * protocol. Sized to sit in a row of them -- the fastest way to say "these are
 * the three things this scene is about" without spending a bullet on it.
 *
 * `mono` is the usual choice for anything a machine would spell: `GET`,
 * `202 Accepted`, `orders.created`.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { FONT, alpha, mix, toneAccent, type Accent, type Tone } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { Icon, type IconName } from './Icon.tsx';

export type PillProps = {
  children: React.ReactNode;
  tone?: Tone;
  accent?: Accent;
  icon?: IconName;
  mono?: boolean;
  size?: 'sm' | 'md';
  style?: CSSProperties;
};

export const Pill: React.FC<PillProps> = ({
  children,
  tone = 'neutral',
  accent,
  icon,
  mono = false,
  size = 'md',
  style,
}) => {
  const theme = useTheme();
  const resolved = accent ?? toneAccent(tone);
  const text = resolved === null ? theme.textSecondary : theme.accent[resolved];

  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 7 : 9,
        padding: size === 'sm' ? '5px 12px' : '8px 16px',
        borderRadius: 999,
        backgroundColor: resolved === null ? alpha(theme.borderStrong, 55) : mix(theme.accent[resolved], 15, theme.surface),
        border: `1px solid ${resolved === null ? theme.border : alpha(theme.accent[resolved], 40)}`,
        color: text,
        fontFamily: mono ? FONT.mono : FONT.sans,
        fontSize: size === 'sm' ? 19 : 22,
        fontWeight: 500,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon === undefined ? null : <Icon name={icon} size={size === 'sm' ? 18 : 21} color={text} />}
      {children}
    </div>
  );
};
