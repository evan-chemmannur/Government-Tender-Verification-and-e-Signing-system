/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0F2D5E',
        },
        'institutional-blue': {
          DEFAULT: '#1A6BAB',
        },
        saffron: {
          DEFAULT: '#C8922A',
          dark: '#A67520',
        },
        surface: {
          DEFAULT: '#F4F7FC',
        },
        card: {
          DEFAULT: '#FFFFFF',
        },
        border: {
          DEFAULT: '#DDE3EE',
        },
        success: {
          DEFAULT: '#1A7F4B',
        },
        danger: {
          DEFAULT: '#B91C1C',
        },
        text: {
          DEFAULT: '#0D1B2E',
        },
        muted: {
          DEFAULT: '#5C6F8A',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite'
      }
    },
  },
  plugins: [],
}
