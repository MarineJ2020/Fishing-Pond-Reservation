/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0b1118',
          surface: '#131c27',
          surface2: '#1a2535',
          border: '#1e2e44',
          text: '#e8edf3',
          muted: '#5a7a9a',
        },
        water: {
          light: '#0a4d8c',
          dark: '#0c6bbf',
        },
        accent: {
          primary: '#00d4aa',
          secondary: '#f5a623',
          danger: '#e24a4a',
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", 'sans-serif'],
        sans: ["'DM Sans'", 'sans-serif'],
        mono: ["'DM Mono'", 'monospace'],
      },
      borderRadius: {
        lg: '14px',
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Disable default Tailwind styles to use custom CSS
  }
}
