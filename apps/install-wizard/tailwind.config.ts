import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'hsl(222, 47%, 96%)',
          100: 'hsl(222, 47%, 90%)',
          200: 'hsl(222, 47%, 80%)',
          300: 'hsl(222, 47%, 70%)',
          400: 'hsl(222, 47%, 60%)',
          500: 'hsl(222, 47%, 50%)',
          600: 'hsl(222, 47%, 40%)',
          700: 'hsl(222, 47%, 31%)',
          800: 'hsl(222, 47%, 22%)',
          900: 'hsl(222, 47%, 15%)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
