const STORAGE_KEY = 'mechanization.theme';

export function isDarkModeActive(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function setDarkMode(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {

  }
}
