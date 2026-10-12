export const THEME_STORAGE_KEY = "loom-theme";

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * A choice saved with the toggle wins; otherwise it follows the visitor's OS setting.
 * Also marks <html data-motion> when animations are welcome, so scroll reveals can
 * start hidden without ever hiding content from no-JS or reduced-motion visitors.
 */
export const themeInitScript = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))d.dataset.theme="dark";if(!matchMedia("(prefers-reduced-motion: reduce)").matches)d.dataset.motion=""}catch(e){}`;
