export const THEME_KEY = "squadlock-theme";
export type Theme = "light" | "dark";

// Runs before the page paints, so a dark-mode user never sees a white flash.
// A saved choice wins; otherwise follow the phone/computer's own setting.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;
