"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "noosphere-theme";

export function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = readPreference();
    setPreference(stored);
    applyTheme(stored);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (readPreference() === "system") applyTheme("system");
    };
    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  function changePreference(value: ThemePreference) {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
    setPreference(value);
    applyTheme(value);
  }

  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Laptop;

  return (
    <label className="theme-switcher" title="Thème de l’interface">
      <Icon aria-hidden="true" size={14} />
      <span className="sr-only">Thème</span>
      <select
        aria-label="Thème de l’interface"
        onChange={(event) => changePreference(event.target.value as ThemePreference)}
        value={preference}
      >
        <option value="system">Système</option>
        <option value="light">Clair</option>
        <option value="dark">Sombre</option>
      </select>
    </label>
  );
}

function readPreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark"
    || preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;
}
