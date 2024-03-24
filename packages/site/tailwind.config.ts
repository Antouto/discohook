import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    fontFamily: {
      sans: ["Whitney", "Helvetica", "sans-serif"],
    },
    extend: {
      colors: {
        brand: {
          blue: "#58B9FF",
          pink: "#FF81FF",
        },
        primary: {
          130: "#EFF0F3",
          160: "#EBEDEF",
          200: "#E3E5E8",
          230: "#DBDEE1",
          300: "#C4C9CE",
          400: "#80848E",
          500: "#4E5058",
          600: "#313338",
          630: "#202225",
          700: "#17181A",
        },
        blurple: {
          50: "#eef3ff",
          100: "#e0e9ff",
          200: "#c6d6ff",
          260: "#C9CDFB",
          300: "#a4b9fd",
          400: "#8093f9",
          DEFAULT: "#5865f2",
          500: "#5865f2",
          600: "#4445e7",
          700: "#3836cc",
          800: "#2f2fa4",
          900: "#2d2f82",
          950: "#1a1a4c",
        },
        blue: {
          345: "#00A8FC",
          430: "#006CE7",
        },
        gray: {
          100: "#f2f3f5",
          200: "#ebedef",
          300: "#e3e5e8",
          400: "#d4d7dc",
          600: "#4f545c",
          700: "#36393f",
          800: "#2f3136",
          900: "#202225",
        },
      },
    },
  },
  plugins: [],
  darkMode: "class",
} satisfies Config;
