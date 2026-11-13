/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./pet.html",
    "./chat.html",
    "./notch.html",
    "./index.html",
    "./frontend/src/**/*.{js,ts,jsx,tsx}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      colors: {
        duck: {
          yellow: '#FFD13B',
          amber: '#F59E0B',
          orange: '#FF8800',
          beak: '#FF6B00',
          dark: '#0A0E17',
          surface: '#121826',
          card: 'rgba(23, 31, 51, 0.72)',
          border: 'rgba(255, 255, 255, 0.08)'
        }
      },
      backdropBlur: {
        xs: '2px',
        acrylic: '24px',
        '2xl': '40px',
        '3xl': '64px'
      },
      boxShadow: {
        'glass-glow': '0 0 35px -5px rgba(245, 158, 11, 0.15)',
        'inner-gloss': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.12)'
      },
      animation: {
        'bounce-subtle': 'bounceSubtle 2s infinite ease-in-out',
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      },
      keyframes: {
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' }
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '.6' }
        }
      }
    }
  },
  plugins: []
};
