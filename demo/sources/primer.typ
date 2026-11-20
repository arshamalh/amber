#set page(paper: "a5", margin: 1.6cm, numbering: "1")
#set text(font: "New Computer Modern", size: 10pt)
#set par(justify: true)
#set heading(numbering: "1.")
#show heading.where(level: 1): set text(fill: rgb("#b4580f"))

#align(center)[
  #v(2.2cm)
  #text(size: 9pt, tracking: 0.2em, fill: rgb("#b4580f"))[A SHORT PRIMER]
  #v(4pt)
  #text(size: 22pt, weight: "bold")[Cellular Automata]
  #v(2pt)
  #text(style: "italic")[Local rules, global behaviour]
  #v(1.2cm)
  #line(length: 50%, stroke: 0.6pt + rgb("#b4580f"))
  #v(1.2cm)
  #text(size: 9pt)[Study notes for the demo notebook]
]
#pagebreak()

= Lattices and neighbours
A cellular automaton is a grid of cells. At each tick every cell updates from its own state and its neighbours' states:
$ x_i^(t+1) = f(x_(i-1)^t, thin x_i^t, thin x_(i+1)^t). $
Information travels at most one site per tick, so after $t$ ticks a signal covers a diamond of radius $t$.

#figure(
  grid(columns: 9, gutter: 2pt, ..range(81).map(i => {
    let (x, y) = (calc.rem(i, 9) - 4, calc.quo(i, 9) - 4)
    box(width: 10pt, height: 10pt, fill: if calc.abs(x) + calc.abs(y) <= 3 { rgb("#e8a35c") } else { luma(92%) })
  })),
  caption: [Sites reached after three ticks.],
)

= Reversibility
A rule is *reversible* when the previous state can always be recovered. The Toffoli gate
$ (a, b, c) arrow.r.bar (a, b, c xor (a and b)) $
is its own inverse and computes AND without erasing information.
#pagebreak()

= Simulating nature
Feynman's rule: the number of elements may grow only in proportion to the volume simulated. Quantum systems break it classically, since $n$ spins need $2^n$ amplitudes.
