import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#1B0F3B",
        plum: "#2D1B69",
        grape: "#5B2EFF",
        bubble: "#FF4FA3",
        sunny: "#FFD23F",
        mint: "#3DDC97",
        tang: "#FF8A3D",
        sky: "#3FC1FF",
        cardboard: "#C8894B",
        cardboardDark: "#9C6634",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        chunky: "0 6px 0 0 rgba(0,0,0,0.35)",
        chunkySm: "0 4px 0 0 rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
