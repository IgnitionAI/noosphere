import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Noosphere",
    template: "%s · Noosphere",
  },
  description: "Créer la demande, capter les prospects et récolter les appels.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

const themeBootScript = `
  (() => {
    try {
      const stored = localStorage.getItem("noosphere-theme");
      const preference = stored === "light" || stored === "dark" ? stored : "system";
      const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      const resolved = dark ? "dark" : "light";
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = preference;
      document.documentElement.style.colorScheme = resolved;
    } catch {
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themePreference = "system";
    }
  })();
`;
