export interface LatexTemplate {
  id: string;
  label: string;
  description: string;
  filename: string;
  source: string;
}

export const LATEX_TEMPLATES: LatexTemplate[] = [
  {
    id: "thesis",
    label: "Thesis / Book",
    description: "Multi-chapter report class with title page and fancy headers (Two-Fluid style)",
    filename: "thesis",
    source: `%% Thesis / Book — report class (adapted from Two-Fluid Model of Compact Stars)
\\documentclass[a4paper,12pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{setspace}
\\setstretch{1.15}
\\usepackage{graphicx}
\\usepackage{amsmath,amssymb}
\\usepackage{braket}
\\usepackage{caption}
\\usepackage{subcaption}
\\usepackage{placeins}
\\usepackage{multicol}
\\usepackage{xcolor}
\\usepackage[a4paper,width=150mm,top=25mm,bottom=25mm,bindingoffset=6mm]{geometry}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true, linkcolor=black, citecolor=red, urlcolor=blue}

\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhead{}
\\fancyhead[RO,LE]{Modeling Compact Stars}
\\fancyfoot{}
\\fancyfoot[LE,RO]{\\thepage}
\\fancyfoot[LO,CE]{Chapter \\thechapter}
\\fancyfoot[CO,RE]{Author One \\& Author Two}
\\renewcommand{\\headrulewidth}{0.4pt}
\\renewcommand{\\footrulewidth}{0.4pt}

\\begin{document}

% ---- Title page ---------------------------------------------------------
\\begin{titlepage}
  \\centering
  \\vspace*{1.5cm}
  {\\scshape\\LARGE Your Institution \\par}
  \\vspace{1.5cm}
  {\\huge\\bfseries A Two-Fluid Model of Compact Stars\\par}
  \\vspace{0.4cm}
  {\\Large A Thesis / Project Report\\par}
  \\vspace{2.5cm}
  {\\large\\itshape Author One \\quad Author Two\\par}
  \\vfill
  supervised by\\par
  {\\large Prof.~Supervisor Name\\par}
  \\vfill
  {\\large \\today\\par}
\\end{titlepage}

\\tableofcontents

% ---- Chapters -----------------------------------------------------------
\\chapter{Abstract}
Summarize the motivation, methods, and key results in a single paragraph.
This template mirrors a multi-chapter report: replace each chapter body with
your own text, or split chapters into separate files with \\verb|\\input{...}|.

\\chapter{Introduction}
Introduce the scientific context and state the open problem. Cite prior work
with \\verb|\\cite{}| once you add a bibliography. Compact objects such as
neutron stars probe matter at supranuclear densities.

\\section{Background}
Use sections and subsections freely; \\texttt{fancyhdr} prints the chapter
number in the footer.

\\chapter{Methodology}
Present the governing equations. The \\texttt{braket} package is available, e.g.
\\(\\Braket{\\psi | \\hat{H} | \\psi}\\), alongside standard math:
\\begin{equation}
  \\frac{dP}{dr} = -\\frac{G\\,\\rho(r)\\,m(r)}{r^{2}}
  \\left(1 + \\frac{P}{\\rho c^{2}}\\right).
\\end{equation}

\\chapter{Results and Analysis}
Discuss your findings. Figures use \\texttt{graphicx}:
\\begin{figure}[ht]
  \\centering
  \\fbox{\\rule{0pt}{4cm}\\rule{8cm}{0pt}}
  \\caption{Replace this placeholder with \\texttt{\\textbackslash includegraphics}.}
  \\label{fig:placeholder}
\\end{figure}
\\FloatBarrier

\\chapter{Discussion}
Interpret the results in the context of previous work.

\\chapter{Conclusion}
Summarize conclusions and outline future directions.

\\chapter*{References}
\\addcontentsline{toc}{chapter}{References}
\\begin{thebibliography}{9}
\\bibitem{example2024} Author, A.~N. 2024, \\textit{Journal of Compact Objects}, 12, 345.
\\end{thebibliography}

\\end{document}
`,
  },
  {
    id: "cv",
    label: "Academic CV",
    description: "Single-column academic CV with icons, sections, and highlights",
    filename: "cv",
    source: `%% Academic CV (adapted from a RenderCV-style single-column CV)
\\documentclass[10pt, letterpaper]{article}

\\usepackage[
    ignoreheadfoot,
    top=1.5cm, bottom=1.5cm, left=1.5cm, right=1.5cm, footskip=1.0cm,
]{geometry}
\\usepackage{titlesec}
\\usepackage{tabularx}
\\usepackage{array}
\\usepackage[dvipsnames]{xcolor}
\\definecolor{primaryColor}{RGB}{0, 0, 0}
\\usepackage{enumitem}
\\usepackage{fontawesome5}
\\usepackage{amsmath}
\\usepackage[
    pdftitle={Your Name's CV}, pdfauthor={Your Name},
    colorlinks=true, urlcolor=blue
]{hyperref}
\\usepackage[pscoord]{eso-pic}
\\usepackage{calc}
\\usepackage{bookmark}
\\usepackage{lastpage}
\\usepackage{changepage}
\\usepackage{paracol}
\\usepackage{ifthen}
\\usepackage{needspace}
\\usepackage{iftex}

\\ifPDFTeX
    \\input{glyphtounicode}
    \\pdfgentounicode=1
    \\usepackage[T1]{fontenc}
    \\usepackage[utf8]{inputenc}
    \\usepackage{lmodern}
\\fi
\\usepackage{charter}

\\raggedright
\\AtBeginEnvironment{adjustwidth}{\\partopsep0pt}
\\pagestyle{empty}
\\setcounter{secnumdepth}{0}
\\setlength{\\parindent}{0pt}
\\setlength{\\topskip}{0pt}
\\setlength{\\columnsep}{0.15cm}
\\pagenumbering{gobble}

\\titleformat{\\section}{\\needspace{4\\baselineskip}\\bfseries\\large}{}{0pt}{}[\\vspace{1pt}\\titlerule]
\\titlespacing{\\section}{-1pt}{0.3cm}{0.2cm}

\\renewcommand\\labelitemi{$\\vcenter{\\hbox{\\small$\\bullet$}}$}
\\newenvironment{highlights}{
    \\begin{itemize}[topsep=0.10cm, parsep=0.10cm, partopsep=0pt, itemsep=0pt, leftmargin=0cm + 10pt]
}{
    \\end{itemize}
}
\\newenvironment{onecolentry}{
    \\begin{adjustwidth}{0cm + 0.00001cm}{0cm + 0.00001cm}
}{
    \\end{adjustwidth}
}
\\newenvironment{twocolentry}[2][]{
    \\onecolentry
    \\def\\secondColumn{#2}
    \\setcolumnwidth{\\fill, 4.5cm}
    \\begin{paracol}{2}
}{
    \\switchcolumn \\raggedleft \\secondColumn
    \\end{paracol}
    \\endonecolentry
}
\\newenvironment{header}{
    \\setlength{\\topsep}{0pt}\\par\\kern\\topsep\\centering\\linespread{1.5}
}{
    \\par\\kern\\topsep
}
\\let\\hrefWithoutArrow\\href

\\begin{document}

\\newcommand{\\AND}{\\unskip
    \\cleaders\\copy\\ANDbox\\hskip\\wd\\ANDbox
    \\ignorespaces
}
\\newsavebox\\ANDbox
\\sbox\\ANDbox{$|$}

\\begin{header}
    \\fontsize{25pt}{25pt}\\selectfont Your Name

    \\vspace{5pt}
    \\normalsize
    \\mbox{\\hrefWithoutArrow{https://your-website.example}{Personal Website}}%
    \\kern 5.0pt\\AND\\kern 5.0pt%
    \\mbox{\\hrefWithoutArrow{mailto:you@example.com}{you@example.com}}%
    \\kern 5.0pt\\AND\\kern 5.0pt%
    \\mbox{\\hrefWithoutArrow{https://linkedin.com/in/you}{LinkedIn}}%
    \\kern 5.0pt\\AND\\kern 5.0pt%
    \\mbox{\\hrefWithoutArrow{https://github.com/you}{GitHub}}%
\\end{header}

\\vspace{0.3cm}

\\section{Research Interests}
\\begin{onecolentry}
Gamma-ray bursts, relativistic astrophysics, multi-messenger modelling,
and machine learning for time-domain astronomy.
\\end{onecolentry}

\\section{Education}
\\begin{twocolentry}{2023 -- Present}
    \\textbf{Ph.D. in Astrophysics}, Your University\\\\
    Thesis: \\textit{Working title of your dissertation}
\\end{twocolentry}
\\vspace{0.2cm}
\\begin{twocolentry}{2019 -- 2023}
    \\textbf{Integrated M.Sc. in Physics}, Your Institute\\\\
    Relevant coursework: general relativity, radiative processes, statistics
\\end{twocolentry}

\\section{Research Experience}
\\begin{twocolentry}{Summer 2024}
    \\textbf{Visiting Researcher}, Host Institute
\\end{twocolentry}
\\begin{onecolentry}
\\begin{highlights}
    \\item Built a pipeline to fit GRB prompt pulses with a physical model.
    \\item Automated retrieval and reduction of public Fermi/GBM data.
\\end{highlights}
\\end{onecolentry}

\\section{Skills}
\\begin{onecolentry}
    \\textbf{Programming:} Python, C++, LaTeX \\\\
    \\textbf{Tools:} NumPy, SciPy, Astropy, PyTorch, Git, Docker
\\end{onecolentry}

\\section{Publications}
\\begin{onecolentry}
\\begin{highlights}
    \\item Your Name, Coauthor, B. 2025, \\textit{ApJ}, 900, 1.
\\end{highlights}
\\end{onecolentry}

\\section{Awards \\& Achievements}
\\begin{twocolentry}{2024}
    Best Student Talk, National Astronomy Meeting
\\end{twocolentry}

\\end{document}
`,
  },
  {
    id: "proposal",
    label: "Research Proposal / Report",
    description: "Doctoral research proposal with header, objectives, and timeline",
    filename: "proposal",
    source: `%% Research Proposal / Report (adapted from a doctoral research proposal)
\\documentclass[a4paper, 11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{tabularx}
\\usepackage{multicol}
\\usepackage{array}
\\usepackage{graphicx}
\\usepackage{amsmath,amssymb}

\\linespread{1.18}

\\addtolength{\\oddsidemargin}{-.875in}
\\addtolength{\\evensidemargin}{-.875in}
\\addtolength{\\textwidth}{1.75in}
\\addtolength{\\topmargin}{-.875in}
\\addtolength{\\textheight}{1.75in}

\\usepackage[dvipsnames]{xcolor}
\\usepackage{xspace}
\\usepackage{hyperref}
\\hypersetup{
    colorlinks,
    linkcolor={red!50!black},
    citecolor={blue!50!black},
    urlcolor={blue!80!black}
}

\\newcommand{\\HRule}{\\rule{\\linewidth}{0.5mm}}
\\newcommand{\\Hrule}{\\rule{\\linewidth}{0.3mm}}

% Header
\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[LE,RO]{\\header\\hskip\\linepagesep\\vfootline\\thepage}
\\newskip\\linepagesep \\linepagesep 5pt\\relax
\\def\\vfootline{\\begingroup\\rule[-10pt]{0.75pt}{25pt}\\endgroup}
\\def\\header{%
    \\begin{minipage}[]{140pt}
        \\hfill Your Name
        \\par \\hfill
        Program, PhD, Fall 2026
    \\end{minipage}
}
\\fancyhead[RE,LO]{Doctoral Research Proposal}
\\renewcommand{\\headrulewidth}{0.4pt}

\\begin{document}

\\vspace{0.5cm}
\\begin{center}
    \\fontsize{13pt}{15pt}\\selectfont
    \\textbf{Unveiling the Physics of Gamma-Ray Bursts using Multi-Messenger
    Modelling, Machine Learning, and Next-Generation Instrumentation}\\\\
    \\vspace{0.2cm}
    \\textbf{Supervisor: Prof.~Supervisor Name}
\\end{center}
\\vspace{0.2cm}

\\section*{Abstract}
State, in a few sentences, the central question of the proposal and the
approach you will take to answer it.

\\section{Background and Motivation}
Describe the scientific context and the specific gap this project addresses,
citing prior work with \\verb|\\cite{}| such as \\cite{example2024}.

\\section{Research Objectives}
\\begin{enumerate}
    \\item Objective one --- a concrete, testable aim.
    \\item Objective two --- building on the first.
    \\item Objective three --- the longer-term goal.
\\end{enumerate}

\\section{Methodology}
Explain the data, models, and statistical methods. Include key equations, e.g.
\\begin{equation}
    L = 4\\pi d_L^{2}\\, F.
\\end{equation}

\\section{Timeline}
\\begin{center}
\\begin{tabularx}{\\linewidth}{@{}l X@{}}
\\textbf{Year 1} & Literature review, tool development, first dataset. \\\\
\\textbf{Year 2} & Core analysis and method validation. \\\\
\\textbf{Year 3} & Extension, write-up, and dissemination. \\\\
\\end{tabularx}
\\end{center}

\\section{Expected Outcomes}
Summarize the anticipated results and their significance.

\\begin{thebibliography}{9}
\\bibitem{example2024} Example, A.~N. 2024, \\textit{ApJ}, 900, 1.
\\end{thebibliography}

\\end{document}
`,
  },
  {
    id: "motivation-letter",
    label: "Motivation Letter",
    description: "Statement of purpose / letter of motivation for applications",
    filename: "motivation-letter",
    source: `%% Motivation / Statement of Purpose letter (adapted from an admissions letter)
\\documentclass[a4paper, 11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}

\\linespread{1.18}

\\addtolength{\\oddsidemargin}{-.875in}
\\addtolength{\\evensidemargin}{-.875in}
\\addtolength{\\textwidth}{1.75in}
\\addtolength{\\topmargin}{-.875in}
\\addtolength{\\textheight}{1.75in}

\\usepackage{xcolor}
\\usepackage{xspace}
\\usepackage{hyperref}
\\hypersetup{
    colorlinks,
    linkcolor={red!50!black},
    citecolor={blue!50!black},
    urlcolor={blue!80!black}
}

\\newcommand{\\HRule}{\\rule{\\linewidth}{0.5mm}}

% Header
\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[LE,RO]{\\header\\hskip\\linepagesep\\vfootline\\thepage}
\\newskip\\linepagesep \\linepagesep 5pt\\relax
\\def\\vfootline{\\begingroup\\rule[-10pt]{0.75pt}{25pt}\\endgroup}
\\def\\header{%
    \\begin{minipage}[]{140pt}
        \\hfill Your Name
        \\par \\hfill
        Program, PhD, Fall 2026
    \\end{minipage}
}
\\fancyhead[RE,LO]{Letter of Motivation}
\\renewcommand{\\headrulewidth}{0.4pt}

\\begin{document}
\\hfill

\\begin{center}
    {\\large\\textbf{Letter of Motivation}}
\\end{center}
\\vspace{0.3cm}

\\noindent Dear Members of the Admissions Committee,
\\vspace{0.3cm}

I am writing to express my strong interest in the doctoral program at your
institution. Over the past years I have developed a deep fascination with
gamma-ray bursts and the physics of relativistic outflows, and I am eager to
pursue this line of research under expert supervision.

\\vspace{0.2cm}
During my studies I built a hands-on foundation in data analysis and physical
modelling. In particular, I developed a pipeline to fit prompt GRB pulses with a
physically motivated internal-shock model, which taught me both the theory and
the practical challenges of confronting models with real observations.

\\vspace{0.2cm}
Your group's work aligns closely with my interests. The opportunity to combine
multi-messenger observations, machine learning, and next-generation
instrumentation is exactly the direction in which I wish to grow as a
researcher, and I am confident that I would contribute meaningfully to your
ongoing projects.

\\vspace{0.2cm}
Thank you for considering my application. I would welcome the opportunity to
discuss how my background and goals fit within your program.

\\vspace{0.6cm}
\\noindent Sincerely,\\\\[0.4cm]
\\noindent Your Name

\\end{document}
`,
  },
  {
    id: "poster-horizontal",
    label: "Poster (Horizontal)",
    description: "Wide 3-column gemini beamerposter, LuaLaTeX",
    filename: "poster-horizontal",
    source: `% !TEX program = lualatex
%% Horizontal research poster — gemini beamerposter theme (Yale/MSU style)
%% The gemini theme uses fontspec, so this compiles with LuaLaTeX
%% (selected automatically by the magic comment on line 1).
\\documentclass[final]{beamer}

\\usepackage[size=custom, width=122, height=91, scale=1.2]{beamerposter}
\\usetheme{gemini}
\\usecolortheme{msu}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{tikz}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.14}
\\usepackage{anyfontsize}

% ---- Column geometry: (N+1)*sepwidth + N*colwidth = paperwidth ----
\\newlength{\\sepwidth}
\\newlength{\\colwidth}
\\setlength{\\sepwidth}{0.025\\paperwidth}
\\setlength{\\colwidth}{0.3\\paperwidth}
\\newcommand{\\separatorcolumn}{\\begin{column}{\\sepwidth}\\end{column}}

\\title{Your Poster Title: A Concise, Readable Headline}
\\author{Your Name \\and Coauthor Name}
\\institute[shortinst]{Your University}

\\footercontent{
  \\href{https://github.com/you}{github.com/you} \\hfill
  Conference / Poster Session \\hfill
  \\href{mailto:you@example.com}{you@example.com}}

\\begin{document}
\\begin{frame}[t]
\\begin{columns}[t]
\\separatorcolumn

% ---- Column 1 -------------------------------------------------------
\\begin{column}{\\colwidth}

  \\begin{block}{Introduction}
    State the motivation and the question your poster answers. Keep sentences
    short and readable from two metres away.
    \\begin{itemize}
      \\item Context: why the problem matters.
      \\item Gap: what remains unknown.
      \\item Aim: what this work contributes.
    \\end{itemize}
  \\end{block}

  \\begin{block}{Methods}
    Summarize your approach. A schematic works well here:
    \\begin{figure}
      \\centering
      \\begin{tikzpicture}
        \\draw[thick, rounded corners, fill=blue!10] (0,0) rectangle (6,3);
        \\node at (3,1.5) {\\Large Method schematic};
      \\end{tikzpicture}
      \\caption{Replace with your pipeline or setup figure.}
    \\end{figure}
  \\end{block}

  \\begin{alertblock}{Key Idea}
    Highlight the single most important message of the poster here.
  \\end{alertblock}

\\end{column}

\\separatorcolumn

% ---- Column 2 -------------------------------------------------------
\\begin{column}{\\colwidth}

  \\begin{block}{Results}
    Present your main findings with a plot generated inline:
    \\begin{figure}
      \\centering
      \\begin{tikzpicture}
        \\begin{axis}[width=0.9\\colwidth, height=8cm,
          xlabel={$x$}, ylabel={$f(x)$}, grid=both]
          \\addplot[blue, thick, domain=0:6, samples=60] {x^2 - x + 4};
        \\end{axis}
      \\end{tikzpicture}
      \\caption{Example result plot (\\texttt{pgfplots}).}
    \\end{figure}
  \\end{block}

  \\begin{block}{Analysis}
    Interpret the results. Use bold leads for scannability:
    \\begin{itemize}
      \\item \\textbf{Finding one.} Short explanation.
      \\item \\textbf{Finding two.} Short explanation.
      \\item \\textbf{Finding three.} Short explanation.
    \\end{itemize}
  \\end{block}

\\end{column}

\\separatorcolumn

% ---- Column 3 -------------------------------------------------------
\\begin{column}{\\colwidth}

  \\begin{exampleblock}{Some Math}
    \\[
      \\int_{-\\infty}^{\\infty} e^{-x^{2}}\\,dx = \\sqrt{\\pi}
    \\]
    \\heading{A sub-heading inside a block}
    Explain a derivation or a model component concisely.
  \\end{exampleblock}

  \\begin{block}{A Table}
    \\begin{table}
      \\centering
      \\begin{tabular}{l r r}
        \\toprule
        \\textbf{Sample} & \\textbf{Value} & \\textbf{Count} \\\\
        \\midrule
        Foo & 13.37 & 384{,}394 \\\\
        Bar & 2.17  & 1{,}392   \\\\
        Baz & 3.14  & 83{,}742  \\\\
        \\bottomrule
      \\end{tabular}
      \\caption{A compact results table.}
    \\end{table}
  \\end{block}

  \\begin{block}{Conclusions \\& References}
    \\begin{itemize}
      \\item Restate the takeaway in one line.
      \\item Name the next step.
    \\end{itemize}
    \\footnotesize
    [1] Example, A.~N. 2024, ApJ, 900, 1.
  \\end{block}

\\end{column}

\\separatorcolumn
\\end{columns}
\\end{frame}
\\end{document}
`,
  },
  {
    id: "poster-vertical",
    label: "Poster (Vertical)",
    description: "Portrait A0 tikzposter with sub-columns (ERIC-lab style)",
    filename: "poster-vertical",
    source: `%% Vertical research poster — tikzposter (adapted from the ERIC Lab model)
\\documentclass[25pt, a0paper, portrait, margin=0mm, innermargin=15mm,
    blockverticalspace=15mm, colspace=15mm, subcolspace=8mm]{tikzposter}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[scaled]{helvet}
\\renewcommand\\familydefault{\\sfdefault}
\\usepackage{lipsum}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{colortbl}
\\usepackage{xspace}
\\usepackage{enumitem}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.14}
\\usepackage{tikz}
\\usetikzlibrary{arrows,shapes}

% ---- Appearance ---------------------------------------------------------
\\tikzposterlatexaffectionproofoff
\\usetheme{Simple}

\\definecolor{titledarkcolor}{RGB}{51,102,153}
\\definecolor{Grey}{RGB}{222, 223, 225}
\\definecolor{FontColor}{RGB}{131,136,138}
\\definecolor{accent}{RGB}{255,73,1}   % ERIC-orange style accent
\\definecolor{Orange}{RGB}{240,163,10}

\\colorlet{blocktitlefgcolor}{accent}
\\colorlet{blocktitlebgcolor}{Grey}
\\colorlet{blockbodyfgcolor}{FontColor}
\\colorlet{innerblocktitlefgcolor}{white}

\\definetitlestyle{sampletitle}{
    width=840mm, roundedcorners=0, linewidth=2pt, innersep=15pt,
    titletotopverticalspace=0mm, titletoblockverticalspace=30mm
}{
    \\begin{scope}[line width=\\titlelinewidth, rounded corners=\\titleroundedcorners]
        \\draw[fill=accent, color=white]
        (\\titleposleft,\\titleposbottom) rectangle (\\titleposright,\\titlepostop);
    \\end{scope}
}
\\usetitlestyle[]{sampletitle}
\\setlength{\\columnseprule}{0.4pt}

\\title{\\parbox{1700pt}{Put Your Poster Title Here --- It Wraps Automatically If Long}}
\\author{First Author, Second Author}
\\institute{Your Lab, Your University, Country}

\\begin{document}
\\maketitle

\\begin{columns}
\\column{1}
\\begin{subcolumns}

    % ---- Sub-column 1 ----
    \\subcolumn{.33}
    \\block{\\textsc{Motivations}}{\\lipsum[1]}

    \\block{\\textsc{Objectives}}{
        \\begin{itemize}
            \\item First objective
            \\item Second objective
            \\item Third objective
        \\end{itemize}
        \\vspace{0.5cm}
        \\underline{Deliverables}:
        \\begin{itemize}[label=-]
            \\item item;
            \\item item;
            \\item item;
        \\end{itemize}\\vspace{-1cm}}

    \\block{\\textsc{Method}}{
        \\innerblock{Pipeline}{
            \\begin{tikzpicture}
                \\draw[thick, rounded corners, fill=blue!10] (0,0) rectangle (10,4);
                \\node at (5,2) {\\Large Method schematic};
            \\end{tikzpicture}
        }
        \\vspace{0.5cm}
        \\lipsum[1]\\vspace{-1cm}}

    % ---- Sub-column 2 ----
    \\subcolumn{.33}
    \\block{\\textsc{Results}}{
        \\innerblock{}{
            \\begin{tikzpicture}
                \\begin{axis}[width=28cm, height=20cm,
                    xlabel={$x$}, ylabel={$f(x)=x^2-x+4$}, grid=both]
                    \\addplot[thick]{x^2 - x + 4};
                \\end{axis}
            \\end{tikzpicture}
        }
        \\vspace{1cm}
        \\lipsum[2]\\vspace{-1cm}}

    \\block{\\textsc{Analysis}}{\\lipsum[1]
        \\vspace{0.5cm}
        \\begin{center}
        \\begin{tabular}{l r r}
            \\toprule
            \\textbf{Sample} & \\textbf{Value} & \\textbf{Count} \\\\
            \\midrule
            Foo & 13.37 & 384{,}394 \\\\
            Bar & 2.17  & 1{,}392   \\\\
            Baz & 3.14  & 83{,}742  \\\\
            \\bottomrule
        \\end{tabular}
        \\end{center}\\vspace{-1cm}}

    % ---- Sub-column 3 ----
    \\subcolumn{.33}
    \\block{\\textsc{Conclusion}}{
        \\lipsum[1]
        \\vspace{0.5cm}
        \\lipsum[2]\\vspace{-1cm}}

    \\block{\\textsc{Abbreviations}}{
        \\vspace{1cm}
        \\textbf{GRB}: Gamma-Ray Burst $\\bullet$
        \\textbf{GBM}: Gamma-ray Burst Monitor $\\bullet$
        \\textbf{SNR}: Signal-to-Noise Ratio}

\\end{subcolumns}

\\block{\\textsc{References}}{\\vspace{0.5cm}
    \\footnotesize [1] Example, A.~N. 2024, ApJ, 900, 1.}

\\end{columns}

\\node[above right, text=white, outer sep=45pt, minimum width=\\paperwidth,
    align=center, draw, fill=titledarkcolor] at (-43.6,-61)
    {\\textcolor{white}{\\normalsize Contact: you@example.com}};

\\end{document}
`,
  },
  {
    id: "apj-article",
    label: "AASTeX Article",
    description: "Official AASTeX v7.0.1 for ApJ / AJ / ApJS / PSJ",
    filename: "aastex-article",
    source: `%% AASTeX v7.0.1 — AAS Journals article (ApJ, AJ, ApJS, PSJ, …)
%% Class options: twocolumn | manuscript | preprint | preprint2 | modern
%%                linenumbers | trackchanges | anonymous | times | longbib
\\documentclass[linenumbers]{aastex701}

\\newcommand{\\vdag}{(v)^\\dagger}
\\newcommand\\aastex{AAS\\TeX}

\\shorttitle{Short Title}
\\shortauthors{Author et al.}
%% \\submitjournal{ApJ}

\\begin{document}

\\title{Title of the Manuscript}

\\author[orcid=0000-0000-0000-0000,sname=Author,gname=A.]{A.~Author}
\\affiliation{Department of Astronomy, Your University}
\\email[show]{author@example.edu}

\\author[sname=Collaborator,gname=B.]{B.~Collaborator}
\\affiliation{Department of Astronomy, Your University}
\\affiliation{Second Institution}
\\email{collaborator@example.edu}

\\correspondingauthor{A.~Author}

\\begin{abstract}
Write a concise abstract summarizing the scientific motivation, methods,
main results, and conclusions. AAS Journals limit abstracts to 250 words
(150 for RNAAS).
\\end{abstract}

\\keywords{gamma-ray burst: general --- radiation mechanisms: non-thermal ---
methods: analytical}

\\section{Introduction}\\label{sec:intro}
Introduce the scientific context and state the open question this paper
addresses \\citep{example2024}.

\\section{Observations and data}\\label{sec:data}
Describe instruments, sample selection, and data reduction.

\\section{Analysis}\\label{sec:analysis}
Present the model and key equations,
\\begin{equation}\\label{eq:example}
  F_\\nu \\propto \\nu^{-\\beta}.
\\end{equation}

\\section{Results}\\label{sec:results}
Main findings. Reference figures with Fig.~\\ref{fig:example} once you add
\\verb|\\plotone{example.pdf}| inside a figure environment.

\\section{Discussion}\\label{sec:disc}
Interpret results in the context of previous work.

\\section{Conclusions}\\label{sec:conc}
Summarize the main conclusions.

\\begin{acknowledgments}
We thank colleagues for useful discussions.
\\end{acknowledgments}

\\software{YourPackage}

%% Prefer BibTeX + aasjournalv7 when you have a .bib file:
%% \\bibliography{refs}
%% \\bibliographystyle{aasjournalv7}

\\begin{thebibliography}{99}
\\bibitem[Example(2024)]{example2024} Example, A.~N.\\ 2024,\\ ApJ, 900, 1
\\end{thebibliography}

\\end{document}
`,
  },
  {
    id: "apj-letter",
    label: "AASTeX Letter (ApJL)",
    description: "Official AASTeX v7.0.1 twocolumn Letter for ApJL",
    filename: "aastex-letter",
    source: `%% AASTeX v7.0.1 — Astrophysical Journal Letters (ApJL)
%% twocolumn approximates the published Letter layout
\\documentclass[twocolumn,linenumbers]{aastex701}

\\newcommand\\aastex{AAS\\TeX}

\\shorttitle{Short Letter Title}
\\shortauthors{Author \\& Coauthor}
\\submitjournal{ApJL}

\\begin{document}

\\title{Short Title of the Discovery}

\\author[orcid=0000-0000-0000-0000,sname=Author,gname=A.]{A.~Author}
\\affiliation{Your Institution}
\\email[show]{author@example.edu}

\\author[sname=Coauthor,gname=B.]{B.~Coauthor}
\\affiliation{Your Institution}
\\affiliation{Second Institution}
\\email{coauthor@example.edu}

\\correspondingauthor{A.~Author}

\\begin{abstract}
Letters are concise. State the result in the first sentence, then summarize
methods and implications. Keep the abstract $\\lesssim$250 words
(AAS Journals limit).
\\end{abstract}

\\keywords{gamma rays: bursts --- stars: black holes}

\\section{Introduction}\\label{sec:intro}
Motivate the Letter and cite prior work \\citep{example2024}.

\\section{Observations}\\label{sec:obs}
Brief data description.

\\section{Analysis and results}\\label{sec:results}
Key result, with one equation if needed:
\\begin{equation}\\label{eq:lum}
  L = 4\\pi d_L^2 F.
\\end{equation}

\\section{Discussion and conclusions}\\label{sec:disc}
Interpret and state the implication clearly in the final paragraph.

\\begin{acknowledgments}
We acknowledge support from \\ldots
\\end{acknowledgments}

\\software{YourPackage}

\\begin{thebibliography}{9}
\\bibitem[Example(2024)]{example2024} Example, A.~N.\\ 2024,\\ ApJ, 900, 1
\\end{thebibliography}

\\end{document}
`,
  },
  {
    id: "beamer",
    label: "Slides (Beamer)",
    description: "Beamer presentation for talks / group meetings",
    filename: "slides",
    source: `\\documentclass[aspectratio=169]{beamer}
\\usetheme{Madrid}
\\usecolortheme{default}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}

\\title{Talk Title}
\\subtitle{Internal shocks and GRB pulse morphology}
\\author{Your Name}
\\institute{Your Institution}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\begin{frame}{Outline}
  \\tableofcontents
\\end{frame}

\\section{Motivation}
\\begin{frame}{Why this problem?}
  \\begin{itemize}
    \\item Prompt GRB emission mechanism still debated
    \\item Internal shocks can produce hard-to-soft evolution
    \\item Goal: fit pulses with physical parameters ($a_u$, $\\tau$)
  \\end{itemize}
\\end{frame}

\\section{Model}
\\begin{frame}{Internal shock sketch}
  \\begin{block}{Key parameters}
    \\begin{itemize}
      \\item $a_u$ — proper velocity contrast
      \\item $\\tau \\equiv t_{\\rm on}/t_{\\rm off}$ — activity ratio
    \\end{itemize}
  \\end{block}
  \\begin{equation*}
    F_{\\rm peak} = F_{\\rm peak}(\\nu_{\\rm peak}; a_u, \\tau)
  \\end{equation*}
\\end{frame}

\\section{Results}
\\begin{frame}{Preliminary fits}
  % \\includegraphics[width=0.85\\textwidth]{figure.pdf}
  \\begin{itemize}
    \\item Show one pulse fit
    \\item Compare inferred $a_u$ across the sample
  \\end{itemize}
\\end{frame}

\\section{Summary}
\\begin{frame}{Take-away}
  \\begin{enumerate}
    \\item Physical pulse fits are feasible
    \\item Next: larger GBM sample
  \\end{enumerate}
  \\vfill
  \\centering\\textit{Questions?}
\\end{frame}

\\end{document}
`,
  },
  {
    id: "abstract",
    label: "Conference Abstract",
    description: "From your Abstract.tex — GRB pulse / conference abstract",
    filename: "abstract",
    source: `\\documentclass[11pt]{article}
\\usepackage{amsmath,amssymb,lmodern}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=3cm]{geometry}
\\usepackage{xcolor}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true, linkcolor=blue, citecolor=blue, urlcolor=cyan}

\\definecolor{rufous}{rgb}{0.66, 0.11, 0.03}
\\newcommand\\ac[1]{{\\color{rufous}[AC: #1]}}

\\title{Study of GRB Pulse Morphology \\\\ Using Internal Shock Hydrodynamic Model}
\\author{Your Name \\\\ \\emph{Your Affiliation}}
\\date{}

\\begin{document}
\\maketitle

\\noindent\\textbf{ABSTRACT}\\\\[0.5em]
Gamma-ray bursts (GRBs) are the most extreme relativistic outflows in the universe,
yet the physical mechanism powering their prompt gamma-ray emission remains debated.
We fit individual GRB prompt pulses using a reverse-shock dominated internal shock
hydrodynamic model, parameterized by the proper velocity contrast $a_u$ and the
activity timescale ratio $\\tau \\equiv t_{\\rm on}/t_{\\rm off}$.

% Write your abstract body here.

\\end{document}
`,
  },
  {
    id: "grb-report",
    label: "GRB Report / Notes",
    description: "From your report.tex — article with natbib, physics macros",
    filename: "grb-report",
    source: `\\documentclass{article}
\\usepackage[top=1.5cm,left=2cm,right=2cm,bottom=2cm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage[english]{babel}
\\usepackage{graphicx}
\\usepackage{amsmath,amssymb,mathtools}
\\usepackage{xcolor}
\\usepackage[round]{natbib}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true, linkcolor=blue, citecolor=blue, urlcolor=cyan}
\\setlength{\\parindent}{0pt}

\\definecolor{seagreen}{rgb}{0.18, 0.55, 0.34}
\\definecolor{royalfuchsia}{rgb}{0.79, 0.17, 0.57}
\\newcommand\\jg[1]{{\\color{royalfuchsia}[JG: #1]}}
\\newcommand\\add[1]{{\\color{orange}#1}}

\\newcommand{\\on}{{\\rm on}}
\\newcommand{\\off}{{\\rm off}}
\\newcommand{\\sh}{{\\rm sh}}
\\newcommand{\\pk}{{\\rm pk}}

\\title{Fitting prompt GRB pulses}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

This document documents modeling of peak frequency and flux for a pulse in the
internal shock model (spherical geometry).

\\section{Model}\\label{sec:model}
The model needs two input parameters:
\\begin{itemize}
  \\item proper velocity contrast between shells: $a_u$,
  \\item activity ratio $\\tau \\equiv t_\\on / t_\\off$.
\\end{itemize}

\\subsection{Peak frequency and peak flux}\\label{sec:pks}
% Equations and discussion

\\section{Discussion}
% Results

\\bibliographystyle{plainnat}
% \\bibliography{refs}

\\end{document}
`,
  },
];

export function getTemplate(id: string): LatexTemplate | undefined {
  return LATEX_TEMPLATES.find((t) => t.id === id);
}
