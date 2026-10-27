---
'@sqve/mutation': patch
---

Skip the string mutants of a message pushed onto a `problems`, `messages`, `errors`, `warnings`,
`issues`, or `failures` array in `tauMessageIgnorer`. Strings pushed onto other arrays, or onto a
member such as `this.problems`, keep their mutants.
