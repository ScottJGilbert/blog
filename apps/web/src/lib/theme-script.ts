export const THEME_STORAGE_KEY = "blog-theme";

/**
 * Blocking inline script injected into <head>. It runs before first paint and
 * applies the `dark` class + `color-scheme` so there is never a flash of the
 * wrong theme. Keep it tiny, dependency-free and wrapped in try/catch (storage
 * can throw in private mode).
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)},s=localStorage.getItem(k),d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
