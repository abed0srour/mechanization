const STORAGE_KEY = 'mechanization.theme';

/**
 * Reads the live DOM rather than storage: the layout's pre-paint script may
 * have chosen dark from the OS preference with nothing written down yet.
 */
export function isDarkModeActive(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Applies the theme and remembers it. Storage failures are ignored — the
 * toggle still works for this page load in a private window.
 */
export function setDarkMode(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {

  }
}
