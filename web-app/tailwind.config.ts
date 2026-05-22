import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0a66c2",
          dark: "#004182",
          light: "#e8f3ff",
        },
      },
    },
  },
  plugins: [],
};

export default config;
