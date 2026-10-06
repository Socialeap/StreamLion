import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY, preferredTheme, applyTheme } from "./theme.js";

export default function ThemeSwitch({ initialTheme } = {}) {
  const [theme, setTheme] = useState(() =>
    ["light", "dark"].includes(initialTheme) ? initialTheme : preferredTheme(),
  );
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);
  function choose(next) {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      setError("");
    } catch {
      setError(
        "Theme changed for this visit. This browser could not remember it.",
      );
    }
  }
  return (
    <div className="appearance-control">
      <div className="theme-switch" role="group" aria-label="Appearance">
        {[
          ["light", Sun, "Light"],
          ["dark", Moon, "Dark"],
        ].map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            aria-label={`${label} theme`}
            aria-pressed={theme === value}
            onClick={() => choose(value)}
          >
            <Icon size={17} aria-hidden="true" />
            <span className="theme-label">{label}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
