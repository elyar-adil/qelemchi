# In-browser TeX engine assets

These files let Qelemchi compile a real PDF entirely in the browser. They are
committed so `node build.mjs` can produce the single-file app without a local
TeX installation or network access.

| Path | Contents |
| --- | --- |
| `engine/*.js` | SwiftLaTeX Emscripten worker glue for pdfTeX, XeTeX and dvipdfmx |
| `wasm/*.wasm.gz` | the matching WebAssembly engines |
| `format/pdflatex.fmt.gz`, `format/xelatex.fmt.gz` | LaTeX formats dumped with SwiftLaTeX `compileformat` |
| `texmf.bin.gz` | the minimal TeX Live 2026 file archive used by the templates |
| `texmf-manifest.json` | names and sizes of every file inside the archive |
| `fflate.umd.js` | MIT-licensed gzip decoder used inside the workers |

`texmf.bin.gz` is a `TXMF1` archive: the magic, a little-endian 32-bit header
length, a JSON manifest, then the concatenated file bytes. Files are stored by
basename because that is how the SwiftLaTeX `kpse` hook requests them. The
archive contains the 229 files requested by the demo, CVPR 2026 and NeurIPS
2025 templates plus their package dependencies. `microtype.sty` carries one
compatibility line (`\providecommand\partokencontext[1]{}`) because the
bundled engines predate that 2026 kernel primitive.

The five Fandol CJK faces are subset to GB2312 level 1, the characters used by
the bundled templates, ASCII and common punctuation (3,940 code points per
face). This keeps the engine pack around 19 MB. Documents that use rarer Chinese
characters need a larger subset or a font not bundled here.

## Delivery

`node build.mjs` no longer embeds these payloads in `index.html`. It writes them
to `tex-assets/` together with a `manifest.json` containing each file's
SHA-256, and embeds only the small manifest (plus the SwiftLaTeX worker glue)
in the app. The published files live in `assets/tex/` of this same public
repository, `elyar-adil/qelemchi`, and are served from jsDelivr. On first compile the
browser downloads the engine for the detected format, verifies every file
against the embedded hash, and stores it in IndexedDB; later compiles read the
cache and work offline. The app never uploads source files or PDFs.

## Regenerating

```sh
# 1. Rebuild the texmf archive from captured kpse requests (needs TeX Live
#    2026 and the capture logs described in tools/build-texmf.mjs).
node tools/build-texmf.mjs --captures /path/to/captures --out /tmp/texmf.bin.gz

# 2. Assemble the committed bundle.
node tools/build-tex-assets.mjs \
  --swiftlatex /path/to/swiftlatex-build \
  --formats    /path/to/formats \
  --texmf      /tmp/texmf.bin.gz \
  --fflate     /path/to/fflate.umd.js
```

## Licences and attribution

- **SwiftLaTeX** — the WASM engines and worker glue are from the
  [SwiftLaTeX project](https://github.com/SwiftLaTeX/SwiftLaTeX). Upstream
  distributes the engines under EPL-2.0 or GPL-2.0 with the Classpath
  exception, and the repository under AGPL-3.0. Keep the upstream notices when
  redistributing.
- **TeX Live 2026** — the files in `texmf.bin.gz` come from TeX Live and keep
  their original licences (mostly LPPL; the Fandol fonts use the GUST Font
  License). `texmf-manifest.json` lists exactly what is included.
- **fflate** — MIT licence, <https://github.com/101arrowz/fflate>.

Qelemchi is an independent editor. It is not affiliated with Overleaf,
SwiftLaTeX, CVPR or NeurIPS.
