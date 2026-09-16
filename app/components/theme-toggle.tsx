"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const nextTheme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    setTheme(nextTheme);
    setIsDark(nextTheme === "dark");
  };

  return <button
    type="button"
    onClick={toggleTheme}
    aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
    aria-pressed={isDark}
    title={isDark ? "Светлая тема" : "Тёмная тема"}
    className="theme-toggle relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-transparent text-foreground shadow-none hover:bg-muted sm:bg-card sm:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    <Sun aria-hidden="true" className="theme-toggle-sun absolute size-5" />
    <Moon aria-hidden="true" className="theme-toggle-moon absolute size-5" />
  </button>;
}
