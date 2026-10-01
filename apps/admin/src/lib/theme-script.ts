export const THEME_STORAGE_KEY = "blog-admin-theme";
export type ThemePreference = "system" | "light" | "dark";

/**
 * Blocking inline script (runs before first paint => no theme flash, zero CLS). Applies the `dark` class and
 * `color-scheme` from the stored preference ("light" | "dark"; anything else = follow the OS).
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)},s=localStorage.getItem(k),d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
