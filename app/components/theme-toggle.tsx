"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return <button
    type="button"
    onClick={() => setTheme(isDark ? "light" : "dark")}
    aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
    aria-pressed={isDark}
    title={isDark ? "Светлая тема" : "Тёмная тема"}
    className="theme-toggle relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    <Sun aria-hidden="true" className="theme-toggle-sun absolute size-5" />
    <Moon aria-hidden="true" className="theme-toggle-moon absolute size-5" />
  </button>;
}
