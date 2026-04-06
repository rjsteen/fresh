// Fresh design system — light green, crisp, privacy-first
// All colour decisions intentionally evoke "clean slate", "growth", and "clarity"

export const theme = {
  color: {
    // Brand greens
    green50:  '#f0fdf5',
    green100: '#dcfce9',
    green200: '#bbf7d2',
    green300: '#86efad',
    green400: '#4ade80',
    green500: '#22c55e',  // primary action
    green600: '#16a34a',  // hover / active
    green700: '#15803d',  // pressed
    green800: '#166534',
    green900: '#14532d',

    // Neutrals (slight green undertone keeps everything cohesive)
    bg:         '#f7faf8',  // page background
    surface:    '#ffffff',  // cards, panels
    surfaceAlt: '#f2f7f4',  // zebra rows, hover states
    border:     '#ddeee5',  // default border
    borderFocus:'#4ade80',  // focus ring

    // Text
    text:       '#14291c',  // primary — deep forest
    textSub:    '#3d6b50',  // secondary — mid forest
    textMuted:  '#7da98a',  // placeholder / labels
    textInvert: '#ffffff',

    // Semantic
    success:    '#22c55e',
    successBg:  '#f0fdf5',
    warning:    '#f59e0b',
    warningBg:  '#fffbeb',
    danger:     '#ef4444',
    dangerBg:   '#fef2f2',
    info:       '#0ea5e9',
    infoBg:     '#f0f9ff',

    // Chart palette — works against white, greenish-friendly
    chart: ['#22c55e', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'],
  },

  font: {
    family: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif",
    mono:   "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    size: {
      xs:   '11px',
      sm:   '13px',
      base: '14px',
      md:   '15px',
      lg:   '17px',
      xl:   '20px',
      '2xl':'24px',
      '3xl':'30px',
    },
    weight: {
      regular: 400,
      medium:  500,
      semibold:600,
      bold:    700,
    },
    lineHeight: {
      tight:  1.25,
      normal: 1.5,
      relaxed:1.75,
    },
  },

  space: {
    '0':   '0',
    '1':   '4px',
    '2':   '8px',
    '3':   '12px',
    '4':   '16px',
    '5':   '20px',
    '6':   '24px',
    '8':   '32px',
    '10':  '40px',
    '12':  '48px',
    '16':  '64px',
    '20':  '80px',
  },

  radius: {
    sm:   '6px',
    md:   '10px',
    lg:   '16px',
    xl:   '24px',
    full: '9999px',
  },

  shadow: {
    sm:   '0 1px 2px rgba(20, 41, 28, 0.05)',
    md:   '0 1px 4px rgba(20, 41, 28, 0.07), 0 2px 8px rgba(20, 41, 28, 0.05)',
    lg:   '0 4px 16px rgba(20, 41, 28, 0.10), 0 1px 4px rgba(20, 41, 28, 0.06)',
    focus:'0 0 0 3px rgba(74, 222, 128, 0.35)',
  },

  transition: {
    fast:   'all 0.10s ease',
    normal: 'all 0.18s ease',
    slow:   'all 0.30s ease',
  },

  sidebar: {
    width: '220px',
  },
} as const;

export type Theme = typeof theme;

// Augment styled-components DefaultTheme so all styled components are typed
declare module 'styled-components' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface DefaultTheme extends Theme {}
}
