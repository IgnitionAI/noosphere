tailwind.config = {
  theme: {
    extend: {
      colors: {
        canvas: "#F5F5F1",
        surface: "#FFFFFF",
        ink: "#111827",
        muted: "#687386",
        line: "#DFE3E8",
        navy: "#000E38",
        "navy-soft": "#0A192F",
        signal: "#C8F169",
        "signal-ink": "#24320A",
        brandblue: "#315EFB",
        success: "#15803D",
        warning: "#B45309",
        danger: "#B42318"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(17,24,39,.04)",
        float: "0 18px 50px rgba(0,14,56,.16)"
      }
    }
  }
};
