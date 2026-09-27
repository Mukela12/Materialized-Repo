/**
 * The sky switch (ported from Levy's Canopy theme control, recoloured to
 * MTRLZD blue): the sun slides across while a moon slides out from inside it,
 * the sky darkens, clouds drop away and stars settle in. A real switch
 * (role="switch", aria-checked) rather than an icon swap, with a 44px-tall
 * touch target around the 30px track.
 */
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      className={`mz-theme-toggle ${className}`}
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
    >
      <span className="mz-theme-sky" aria-hidden="true">
        <span className="mz-theme-night" />
        <span className="mz-theme-clouds" />
        <span className="mz-theme-stars"><i /><i /><i /></span>
        <span className="mz-theme-orbit">
          <span className="mz-theme-sun">
            <span className="mz-theme-moon"><i /><i /><i /></span>
          </span>
        </span>
      </span>
    </button>
  );
}
