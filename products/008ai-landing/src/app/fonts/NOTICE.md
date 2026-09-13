# Vendored fonts

`Manrope.woff2` is the **latin** subset of the Manrope variable font
(`wght 200..800`), vendored so `next build` never touches the network.

- Source: `https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSg.woff2`
  (resolved from `https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap`)
- Downloaded: 2026-09-13
- Loaded via `next/font/local` in `src/app/layout.tsx` as `--font-manrope`

Manrope is licensed under the SIL Open Font License 1.1. The OFL requires the
license text to ship with the font, so add `OFL.txt` here (or in the deployed
static assets) before a public release.

To refresh: download the latin subset again and replace `Manrope.woff2`; keep the
`weight` range and the CSS variable name in sync with `layout.tsx` and the
`--font-sans` stack in `src/app/globals.css`.
