---
'@ovd/cli': patch
'@ovd/gui': patch
---

Quitting OVD, or stopping it with a second Ctrl+C or SIGTERM, no longer leaves Vega SDK log streams or sign-in checks running.
