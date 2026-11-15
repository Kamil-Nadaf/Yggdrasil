# LaTeX engine spike (2026-11-15, Darwin arm64)

tectonic: Tectonic 0.17.0
latexmk: Latexmk, John Collins, 9 March 2026. Version 4.88

| Document | Tectonic cold | Tectonic warm | latexmk | Tectonic error / latexmk error |
|---|---|---|---|---|
| article | OK 16.6s | OK 0.4s | OK 0.6s | T: - / L: - |
| beamer | OK 79.5s | OK 0.8s | OK 1.1s | T: - / L: - |
| biblatex-biber | FAIL 14.3s | FAIL 0.5s | FAIL 0.2s | T: note: downloading biblatex.sty / L: ! LaTeX Error: File `biblatex.sty' not found. |
| bibtex | OK 4.6s | OK 0.2s | OK 0.5s | T: - / L: - |
| book-thesis | OK 4.3s | OK 0.2s | OK 0.3s | T: - / L: - |
| minted | FAIL 12.3s | FAIL 0.2s | FAIL 0.2s | T: note: downloading minted.sty / L: ! LaTeX Error: File `minted.sty' not found. |
| poster-tikzposter | OK 57.0s | OK 0.6s | FAIL 0.1s | T: - / L: ! LaTeX Error: File `tikzposter.cls' not found. |
| tcolorbox-siunitx-listings | FAIL 11.9s | FAIL 0.3s | FAIL 0.2s | T: note: downloading tcolorbox.sty / L: ! LaTeX Error: File `tcolorbox.sty' not found. |
| tikz-pgfplots | OK 27.9s | OK 0.7s | FAIL 0.3s | T: - / L: ! LaTeX Error: File `pgfplots.sty' not found. |
| xelatex-fontspec | OK 4.7s | OK 0.4s | FAIL 0.2s | T: - / L: ! Fatal Package fontspec Error: The fontspec package requires either X |
