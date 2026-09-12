FROM texlive/texlive:latest

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip && \
    rm -rf /var/lib/apt/lists/*

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

COPY latex_service.py /srv/latex_service.py
WORKDIR /srv

CMD ["uvicorn", "latex_service:app", "--host", "0.0.0.0", "--port", "9000"]
