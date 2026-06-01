/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0a0e1a',
        'bg-card': '#111827',
        'bg-elevated': '#1a2235',
        'gold': '#f59e0b',
        'gold-dark': '#d97706',
        'purple-accent': '#7c3aed',
        'green-accent': '#10b981',
        'red-accent': '#ef4444',
        'text-primary': '#f1f5f9',
        'text-secondary': '#94a3b8',
        'text-dim': '#475569',
        'border-color': '#1e2d47',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
};
