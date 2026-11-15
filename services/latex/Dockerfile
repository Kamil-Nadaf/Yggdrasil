FROM texlive/texlive:latest

# Helper programs that scientific LaTeX documents shell out to:
#   minted/pythontex -> python3 + pygments     svg -> inkscape      pgfplots/gnuplot -> gnuplot
#   graphviz (dot2tex/doxygen figures)         ghostscript/poppler  -> eps/pdf conversion, epstopdf
#   latexindent -> perl modules                chktex -> LaTeX linting
#   fonts -> fontspec/xelatex/lualatex documents (Noto, DejaVu, Liberation)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3-pip python3-pygments \
        inkscape gnuplot-nox graphviz ghostscript poppler-utils imagemagick \
        chktex libyaml-tiny-perl libfile-homedir-perl libunicode-linebreak-perl \
        fonts-dejavu fonts-liberation2 fonts-noto-core fonts-noto-mono fonts-firacode fonts-stix \
        make git && \
    rm -rf /var/lib/apt/lists/* && \
    fc-cache -f

RUN pip3 install --no-cache-dir --break-system-packages \
    fastapi==0.115.0 \
    uvicorn[standard]==0.30.6 \
    python-frontmatter==1.1.0 \
    aiofiles==24.1.0

# AASTeX v7.0.1 for ApJ / AJ / ApJS / ApJL / PSJ / RNAAS submissions
COPY aastex/aastex701.cls aastex/orcid-ID.png /usr/local/texlive/texmf-local/tex/latex/aastex701/
COPY aastex/aasjournalv7.bst /usr/local/texlive/texmf-local/bibtex/bst/aastex/

# Gemini beamerposter theme (Yale / MSU horizontal poster template)
COPY posters/beamerthemegemini.sty posters/beamercolorthemegemini.sty posters/beamercolorthememsu.sty \
     /usr/local/texlive/texmf-local/tex/latex/gemini/
RUN mktexlsr

# Build-time report: the base image is a full TeX Live; this just proves the usual research
# packages/classes are present (prints MISSING lines, never fails the build).
RUN for f in amsmath.sty siunitx.sty biblatex.sty natbib.sty hyperref.sty cleveref.sty pgfplots.sty tikz.sty \
        minted.sty listings.sty algorithm2e.sty algorithmicx.sty booktabs.sty multirow.sty subcaption.sty \
        mhchem.sty physics.sty braket.sty glossaries.sty tcolorbox.sty beamerposter.sty tikzposter.cls \
        revtex4-2.cls IEEEtran.cls acmart.cls elsarticle.cls svjour3.cls memoir.cls scrartcl.cls \
        fontspec.sty unicode-math.sty svg.sty pythontex.sty todonotes.sty lipsum.sty; do \
        kpsewhich "$f" >/dev/null || echo "MISSING: $f"; done; \
    which biber latexmk pygmentize inkscape gnuplot dot gs chktex latexindent >/dev/null || true

COPY latex_service.py /srv/latex_service.py
WORKDIR /srv

CMD ["uvicorn", "latex_service:app", "--host", "0.0.0.0", "--port", "9000"]
