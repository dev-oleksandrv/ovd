---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd doctor` and the desktop Doctor get a Shell PATH row. It warns when your terminal runs another `vega` before the Vega CLI, such as the one in the SDK's own `bin` folder, and says how to reorder your PATH. With both on PATH in that order, `react-native build-vega` failed every time while OVD was open, because the SDK rebuilds part of itself whenever it is called through the other path.
