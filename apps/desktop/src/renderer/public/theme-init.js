// 在首帧绘制前从 window.pch.bootstrap（preload 先于页面脚本执行）应用主题、强调色、密度与语言。
// 放在 public/ 作为同步加载的外部脚本：既能在 React 挂载前生效，又不需要 CSP 允许内联脚本。
;(function () {
  try {
    var b = window.pch && window.pch.bootstrap
    if (!b) return
    var d = document.documentElement
    if (b.theme === 'dark') d.classList.add('dark')
    d.style.colorScheme = b.theme
    if (b.themeName && b.themeName !== 'default') d.dataset.theme = b.themeName
    d.dataset.accent = b.accent
    d.dataset.density = b.density
    d.lang = b.language
  } catch {
    // 忽略：React 挂载后 ThemeProvider 会再次应用
  }
})()
