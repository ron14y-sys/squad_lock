"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, type Theme } from "./theme";

const EVENT = "squadlock-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

// The truth lives on <html data-theme>, set by the inline script before paint.
function read(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function choose(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode: the choice still applies until the tab closes
  }
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);

  return (
    <div className="sl-toggle" role="group" aria-label="ערכת נושא">
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => choose("light")}
      >
        בהיר
      </button>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => choose("dark")}
      >
        כהה
      </button>
    </div>
  );
}
