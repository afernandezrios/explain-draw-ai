/**
 * The icon set, as data.
 *
 * Inline SVG rather than an icon package: these are the twenty-eight nouns a
 * software explainer actually reaches for, they are drawn on a shared 24x24
 * grid so they sit together, and shipping them as one exported record means a
 * scene names an icon by the same word it names everything else -- `icon:
 * 'database'` -- and an unknown name is a type error rather than a missing
 * picture at render time.
 *
 * All of them stroke rather than fill, so one `color` and one `strokeWidth`
 * restyle the whole set and an icon inherits the tone of whatever it labels.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { useTheme } from '../theme.tsx';

export const ICON_NAMES = [
  'server',
  'database',
  'table',
  'queue',
  'broadcast',
  'cloud',
  'browser',
  'terminal',
  'code',
  'braces',
  'layers',
  'cube',
  'route',
  'globe',
  'shield',
  'lock',
  'key',
  'user',
  'users',
  'bolt',
  'gear',
  'clock',
  'file',
  'message',
  'search',
  'filter',
  'check',
  'close',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const GLYPHS: Record<IconName, React.ReactNode> = {
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M9.5 9.5v10" />
    </>
  ),
  queue: (
    <>
      <rect x="3" y="4" width="12" height="4" rx="1.5" />
      <rect x="3" y="10" width="12" height="4" rx="1.5" />
      <rect x="3" y="16" width="12" height="4" rx="1.5" />
      <path d="m18.5 9.5 3 2.5-3 2.5" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2.3" />
      <path d="M7.9 7.9a5.8 5.8 0 0 0 0 8.2M16.1 7.9a5.8 5.8 0 0 1 0 8.2" />
      <path d="M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14" />
    </>
  ),
  cloud: <path d="M7 18.5h10a3.6 3.6 0 0 0 .5-7.2A5.2 5.2 0 0 0 7.6 10 4 4 0 0 0 7 18.5z" />,
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M6.4 6.5h.01M8.9 6.5h.01" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9.5 9.5 12 7 14.5M12.5 15H17" />
    </>
  ),
  code: <path d="M9 6 4 12l5 6M15 6l5 6-5 6" />,
  braces: (
    <>
      <path d="M9.5 4.5c-2.2 0-3 1.3-3 3.3v1.7c0 1.6-.8 2.5-2.2 2.5 1.4 0 2.2.9 2.2 2.5v1.7c0 2 .8 3.3 3 3.3" />
      <path d="M14.5 4.5c2.2 0 3 1.3 3 3.3v1.7c0 1.6.8 2.5 2.2 2.5-1.4 0-2.2.9-2.2 2.5v1.7c0 2-.8 3.3-3 3.3" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
      <path d="m3.5 17 8.5 4.5 8.5-4.5" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.8 4.4 7.2v9.6L12 21.2l7.6-4.4V7.2L12 2.8z" />
      <path d="M4.4 7.2 12 11.6l7.6-4.4M12 11.6v9.6" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M6 8.6v5.4a4 4 0 0 0 4 4h5.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3a13.6 13.6 0 0 1 0 18 13.6 13.6 0 0 1 0-18z" />
    </>
  ),
  shield: <path d="M12 3 5 5.8v6.1c0 4.1 2.9 7.1 7 8.6 4.1-1.5 7-4.5 7-8.6V5.8L12 3z" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2.4" />
      <path d="M8 10V7.2a4 4 0 0 1 8 0V10" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.6" />
      <path d="M11.6 12H21M17.5 12v3M20.5 12v2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.2" cy="8" r="3.2" />
      <path d="M3 19.5a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.2 5.3a3.2 3.2 0 0 1 0 6.2M18 13.7a6.2 6.2 0 0 1 3.4 5.8" />
    </>
  ),
  bolt: <path d="M13.2 2.5 4.8 13.4h6l-1 8.1 8.4-10.9h-6z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3H7.4A2.4 2.4 0 0 0 5 5.4v13.2A2.4 2.4 0 0 0 7.4 21h9.2a2.4 2.4 0 0 0 2.4-2.4V8.5L13.5 3z" />
      <path d="M13.5 3v5.5H19" />
    </>
  ),
  message: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <path d="m3.8 7.4 8.2 5.8 8.2-5.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.4 4.4" />
    </>
  ),
  filter: <path d="M3.5 5.4h17l-6.6 7.6V20l-3.8-2.2v-4.8L3.5 5.4z" />,
  check: <path d="m5 12.8 4.6 4.6L19 6.6" />,
  close: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
};

export type IconProps = {
  name: IconName;
  size?: number;
  /** Defaults to the theme's primary text colour; pass an accent to label. */
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
};

export const Icon: React.FC<IconProps> = ({ name, size = 32, color, strokeWidth = 1.8, style }) => {
  const theme = useTheme();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.text}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {GLYPHS[name]}
    </svg>
  );
};
