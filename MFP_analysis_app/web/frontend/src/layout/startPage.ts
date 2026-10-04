// Where the app opens: the Home page (default) or the tab used last.
export const OPEN_ON_KEY = "mfp.openOn";
export const LAST_TAB_KEY = "mfp.lastTab";
export type OpenOn = "home" | "last";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function entryRoute(tabRoutes: string[]): string {
  const openOn = read(OPEN_ON_KEY);
  const last = read(LAST_TAB_KEY);
  // useStoredState keeps values as JSON.
  const parsedOpenOn = openOn ? (JSON.parse(openOn) as OpenOn) : "home";
  if (parsedOpenOn === "last" && last && tabRoutes.includes(last)) return last;
  return "/home";
}

export function rememberTab(pathname: string, tabRoutes: string[]): void {
  if (!tabRoutes.includes(pathname)) return;
  try {
    window.localStorage.setItem(LAST_TAB_KEY, pathname);
  } catch {
    // storage unavailable: the app simply opens on Home
  }
}
