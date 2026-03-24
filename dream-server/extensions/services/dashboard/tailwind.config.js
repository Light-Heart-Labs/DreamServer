/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy palette (kept for backward compat)
        dream: {
          bg: '#0f0f13',
          card: '#18181b',
          border: '#27272a'
        },
        // Theme-aware colors driven by CSS custom properties
        theme: {
          bg: 'var(--theme-bg)',
          card: 'var(--theme-card)',
          border: 'var(--theme-border)',
          text: 'var(--theme-text)',
          'text-secondary': 'var(--theme-text-secondary)',
          'text-muted': 'var(--theme-text-muted)',
          accent: 'var(--theme-accent)',
          'accent-hover': 'var(--theme-accent-hover)',
          'accent-light': 'var(--theme-accent-light)',
          'surface-hover': 'var(--theme-surface-hover)',
          sidebar: 'var(--theme-sidebar)',
        }
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        }
      }
    },
  },
  plugins: [],
}
