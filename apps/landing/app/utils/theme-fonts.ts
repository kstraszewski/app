const THEME_FONT_STYLESHEET_ID = 'openexpert-theme-fonts'
const THEME_FONT_STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Roboto:wght@300;400;500;600;700&display=swap'

export function loadThemeFonts() {
  if (!import.meta.client || document.getElementById(THEME_FONT_STYLESHEET_ID)) return

  const stylesheet = document.createElement('link')
  stylesheet.id = THEME_FONT_STYLESHEET_ID
  stylesheet.rel = 'stylesheet'
  stylesheet.href = THEME_FONT_STYLESHEET_URL
  document.head.append(stylesheet)
}
