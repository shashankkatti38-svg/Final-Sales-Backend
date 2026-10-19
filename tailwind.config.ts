import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        backgroundDark: "#FFFFFF",
        sidebarDark: "#FFFFFF",
        cardDark: "#FFFFFF",
        textPrimary: "#0F172A",
        textMuted: "#64748B",
        primaryAccent: "#7A1F3D",
        goldAccent: "#C9A96B",

        // Palette definitions
        deepPlum: "#FFFFFF",
        garnet: "#7A1F3D",
        darkGarnet: "#5F172F",
        champagne: "#C9A96B",
        softIvory: "#FFFFFF",
        richCharcoal: "#0F172A",
        cardWhite: "#FFFFFF",
        mutedSage: "#4F7C6D",
        mutedRed: "#BB5A5B",
        borderSubtle: "#E2E8F0",
        borders: "#E2E8F0",
        hoverBg: "#F1F5F9",

        // Semantic aliases
        primaryAction: "#7A1F3D",
        appBackground: "#F8FAFC",
        sidebar: "#FFFFFF",
        success: "#16A34A",
        warning: "#D97706",
        errors: "#DC2626",

        // Theme mapping aliases ensuring 100% component consistency
        signalBlue: "#7A1F3D",
        porcelain: "#F8FAFC",
        deepNavy: "#0B1B46",
        emeraldGreen: "#16A34A",
        amberWarm: "#C9A96B",
        roseAlert: "#BB5A5B",
      },
      borderRadius: {
        '2xl': '18px',
      },
    },
  },
  plugins: [],
};
export default config;
