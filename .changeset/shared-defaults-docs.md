---
'@sqve/mutation': patch
---

Correct the README on defaults: the command always adds the ignorer and its plugin, even to
`plugins` and `ignorers` lists you set. Only `ignoreStatic` and `timeoutMS` take your value.
