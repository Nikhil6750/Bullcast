/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  theme: { 
    extend: {
      colors: {
        background: '#0a0a0f',
        card: '#12121a',
        border: '#1e1e2e',
        primary: '#6c63ff',
        bullish: '#00d26a',
        bearish: '#ff4d4d',
        neutral: '#888899',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    } 
  },
  plugins: [],
};
