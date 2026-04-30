/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  theme: { 
    extend: {
      colors: {
        background: '#060608',
        card: '#0c0c14',
        cardAlt: '#0e0e1a',
        border: '#1a1a28',
        primary: '#C8F135',
        bullish: '#00FF87',
        bearish: '#FF3B3B',
        muted: '#333344',
        ghost: '#1a1a28',
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    } 
  },
  plugins: [],
};
