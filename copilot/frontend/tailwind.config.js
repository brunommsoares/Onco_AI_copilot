/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Remap emerald → SilverCancer navy blue (light) / teal (dark)
        emerald: {
          50:  '#f0f4f8',
          100: '#e8eef4',
          200: '#c5d5e5',
          300: '#8aaac8',
          400: '#4a7aaa',
          500: '#1a3a5c',
          600: '#0f2a4a',
          700: '#0a2040',
          800: '#071830',
          900: '#041020',
        },
        // Remap teal → copilot ink/teal palette
        teal: {
          50:  '#f0f4f8',
          100: '#e8eef4',
          200: '#c5d5e5',
          300: '#8aaac8',
          400: '#38B2AC',
          500: '#2A7A75',
          600: '#0f2a4a',
          700: '#0a2040',
          800: '#071830',
          900: '#041020',
        },
        // Copilot dark palette
        ink: {
          DEFAULT: '#08192A',
          deep:    '#04111E',
          mid:     '#0F2640',
          light:   '#163A5E',
        },
        cream: '#EDE8DF',
      },
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'system-ui', 'sans-serif'],
        'mono': ['SF Mono', 'IBM Plex Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '20px',
        '2xl': '24px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'md': '0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'lg': '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
        'xl': '0 8px 40px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      screens: {
        'xs': '320px',
        'motion-reduce': {'raw': '(prefers-reduced-motion: reduce)'},
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
