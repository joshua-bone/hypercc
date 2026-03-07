# hypercc

Static React/TypeScript demo: a hyperbolic (Poincaré disk) 2D maze you can explore with the arrow keys.

## Demos

- `/`: defaults to the tick-based `{4,5}` hyperbolic cell maze and includes a demo switcher
- `/grid45.html`: direct entry that also opens with the `{4,5}` grid selected
- `#line`: hash target for the original continuous wall-rendered hyperbolic maze

## Dev

```bash
npm install
npm run dev
```

Then open either `/` or `/grid45.html`.

## Build

```bash
npm run build
npm run preview
```

Controls: arrow keys to move, `R` to regenerate.
