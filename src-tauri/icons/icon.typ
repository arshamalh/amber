// Source for the app icon. Rebuild with:
//   typst compile --format png --ppi 72 src-tauri/icons/icon.typ src-tauri/icons/icon-source.png
//   npx tauri icon src-tauri/icons/icon-source.png
#set page(width: 1024pt, height: 1024pt, margin: 0pt, fill: none)
#place(center + horizon, box(
  width: 880pt,
  height: 880pt,
  radius: 200pt,
  fill: gradient.linear(rgb("#f6b73c"), rgb("#c96a0b"), angle: 60deg),
))
#place(center + horizon, dy: -10pt, text(
  font: ("New Computer Modern", "Libertinus Serif"),
  size: 700pt,
  fill: rgb("#fff8ec"),
  weight: "bold",
)[A])
