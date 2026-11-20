// Amber's Typst helpers. Templates import this file:
//
//   #import "/_shared/amber.typ": *
//   #show: amber
//
// It styles [[Wiki links]] in the preview and in PDFs. It is a plain file in
// your vault: edit it, or drop the two lines above from a note to turn the
// styling off there. In Typst notes, link to a heading as [[Note\#Heading]]
// and to a PDF page as [[paper.pdf\#page=12]].

#let amber-link-color = rgb("#c96a0b")

#let amber(body) = {
  show regex("\[\[[^\[\]\n]+\]\]"): it => {
    let inner = it.text.slice(2, -2)
    let parts = inner.split("|")
    let dest = parts.first().split("#")
    // [[paper.pdf#page=12]] reads "paper.pdf, p. 12".
    let page = if dest.len() > 1 and dest.at(1).starts-with("page=") { ", p. " + dest.at(1).slice(5) } else { "" }
    let label = if parts.len() > 1 { parts.last().trim() } else { dest.first().trim() + page }
    text(fill: amber-link-color, underline(offset: 2pt, stroke: 0.5pt + amber-link-color, label))
  }
  body
}
