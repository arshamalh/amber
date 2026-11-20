#import "/_shared/amber.typ": *
#show: amber

= Simulating physics with computers

Feynman asks a deceptively simple question: can a computer *be* nature, rather than only approximate it?

== The rule of simulation

The number of computer elements may grow at most _proportionally_ to the volume $V$ of space-time being simulated:

$ N(V) = O(V) quad "rather than" quad O(e^V) $

#block(fill: rgb("#fbeedd"), inset: 12pt, radius: 6pt, width: 100%)[
  *Why quantum?* Describing $n$ entangled spins classically takes $2^n$ complex amplitudes.
]

The lattice picture is in [[Cellular automata]], and the primer works it through on [[Primer.pdf\#page=2]].

== Reversible gates

A Toffoli gate flips $c$ only when both controls are set:

$ (a, b, c) arrow.r.bar (a, b, c xor (a and b)) $
