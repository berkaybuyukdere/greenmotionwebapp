/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                sap: {
                    // Primary palette (reference1-aligned)
                    blue: {
                        50: '#EFF6FF',
                        100: '#DBEAFE',
                        200: '#BFDBFE',
                        300: '#93C5FD',
                        400: '#60A5FA',
                        500: '#3B82F6',
                        600: '#2563EB',
                        700: '#1D4ED8',
                        800: '#1E40AF',
                        900: '#1E3A8A',
                    },
                    // Semantic colors
                    semantic: {
                        positive: '#22C55E',
                        negative: '#EF4444',
                        critical: '#F59E0B',
                        informative: '#3B82F6',
                        neutral: '#6B7280',
                    },
                    // Background Colors (Light) — reference1: bg-white
                    bg: {
                        light: '#FFFFFF',
                        lightAlt: '#F9FAFB',
                        lightHover: '#F3F4F6',
                    },
                    // Backgrounds (Dark): near-black canvas + stepped greys; #555555 = accent / borders
                    bgDark: {
                        dark: '#0c0c0c',
                        darkAlt: '#141414',
                        darkHover: '#555555',
                        card: '#1f1f1f',
                        input: '#2a2a2a',
                    },
                    // Text Colors
                    text: {
                        primary: '#111827',
                        secondary: '#4B5563',
                        tertiary: '#6B7280',
                        disabled: '#9CA3AF',
                    },
                    textDark: {
                        primary: '#F9FAFB',
                        secondary: '#D1D5DB',
                        tertiary: '#9CA3AF',
                        disabled: '#6B7280',
                    },
                    // Border Colors — reference1: border-gray-200 / dark:border-[#1F1F23]
                    border: {
                        light: '#E5E7EB',
                        medium: '#D1D5DB',
                        dark: '#9CA3AF',
                    },
                    borderDark: {
                        light: '#2a2a2a',
                        medium: '#383838',
                        dark: '#555555',
                    },
                },
            },
            // Typography
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
            },
            fontSize: {
                'sap-xs':   ['0.75rem',  { lineHeight: '1rem' }],
                'sap-sm':   ['0.875rem', { lineHeight: '1.25rem' }],
                'sap-base': ['1rem',     { lineHeight: '1.5rem' }],
                'sap-lg':   ['1.125rem', { lineHeight: '1.75rem' }],
                'sap-xl':   ['1.25rem',  { lineHeight: '1.75rem' }],
                'sap-2xl':  ['1.5rem',   { lineHeight: '2rem' }],
                'sap-3xl':  ['1.875rem', { lineHeight: '2.25rem' }],
                'sap-4xl':  ['2.25rem',  { lineHeight: '2.75rem' }],
                'page-title':    ['2.25rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em' }],
                'section-title': ['1.5rem',  { lineHeight: '2rem',    letterSpacing: '-0.015em' }],
                'card-title':    ['1.125rem',{ lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
                'body':          ['1rem',    { lineHeight: '1.625rem' }],
                'caption':       ['0.875rem',{ lineHeight: '1.375rem' }],
            },
            fontWeight: {
                regular: '400',
                medium: '500',
                semibold: '600',
                bold: '700',
            },
            letterSpacing: {
                tightest: '-0.03em',
                tighter:  '-0.02em',
                tight:    '-0.01em',
                normal:   '0',
                wide:     '0.01em',
            },
            lineHeight: {
                snugger: '1.35',
                snug:    '1.45',
                normal:  '1.6',
                relaxed: '1.7',
            },
            maxWidth: {
                measure: '75ch',
                'measure-narrow': '60ch',
            },
            // Spacing (8px base unit)
            spacing: {
                'sap-0':   '0',
                'sap-0.5': '0.125rem',
                'sap-1':   '0.25rem',
                'sap-1.5': '0.375rem',
                'sap-2':   '0.5rem',
                'sap-2.5': '0.625rem',
                'sap-3':   '0.75rem',
                'sap-3.5': '0.875rem',
                'sap-4':   '1rem',
                'sap-5':   '1.25rem',
                'sap-6':   '1.5rem',
                'sap-8':   '2rem',
                'sap-10':  '2.5rem',
                'sap-12':  '3rem',
                'sap-16':  '4rem',
            },
            // Border radius — reference1: rounded-lg = 0.5rem, rounded-xl = 0.75rem
            borderRadius: {
                'sap-sm': '0.375rem',
                'sap-md': '0.5rem',
                'sap-lg': '0.75rem',
            },
            // Shadows — reference1: very subtle
            boxShadow: {
                'sap-1': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                'sap-2': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
                'sap-3': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05)',
            },
            animation: {
                'fade-in':   'fadeIn 0.25s ease-in-out',
                'slide-up':  'slideUp 0.25s ease-out',
                'slide-down':'slideDown 0.25s ease-out',
                'scale-in':  'scaleIn 0.2s ease-out',
            },
            keyframes: {
                fadeIn: {
                    '0%':   { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%':   { transform: 'translateY(8px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)',   opacity: '1' },
                },
                slideDown: {
                    '0%':   { transform: 'translateY(-8px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)',    opacity: '1' },
                },
                scaleIn: {
                    '0%':   { transform: 'scale(0.96)', opacity: '0' },
                    '100%': { transform: 'scale(1)',    opacity: '1' },
                },
            },
        },
    },
    plugins: [],
}
