"""Universal Academic & arXiv category taxonomy for the Daily Papers topic picker."""
from __future__ import annotations

import re

# Curated academic topic presets across all disciplines
ARXIV_TOPICS: list[dict[str, str]] = [
    {"id": "all", "label": "All new papers (every field)", "group": "Start here"},
    
    # Chinese Academy of Social Sciences & NCPSSD (国家社科文献中心)
    {"id": "chinese:ncpssd-philosophy", "label": "NCPSSD / CASS: Philosophy & Thought (哲学与思想)", "group": "NCPSSD / CASS (社科院)"},
    {"id": "chinese:ncpssd-history", "label": "NCPSSD / CASS: History & Archaeology (历史与考古)", "group": "NCPSSD / CASS (社科院)"},
    {"id": "chinese:ncpssd-literature", "label": "NCPSSD / CASS: Literature & Linguistics (文学与语言学)", "group": "NCPSSD / CASS (社科院)"},
    {"id": "chinese:ncpssd-sociology", "label": "NCPSSD / CASS: Social Sciences & Law (社会学与法学)", "group": "NCPSSD / CASS (社科院)"},
    {"id": "chinese:ncpssd-economics", "label": "NCPSSD / CASS: Economics & Politics (经济与政治学)", "group": "NCPSSD / CASS (社科院)"},

    # Chinese Academy of Sciences (CAS / 中国科学院)
    {"id": "chinese:cas-science-china", "label": "CAS: Science China & CAS Open Access (中国科学)", "group": "Chinese Academy of Sciences (中科院)"},
    {"id": "chinese:cas-earth-geography", "label": "CAS: Earth & Geographic Sciences (地理与地球科学)", "group": "Chinese Academy of Sciences (中科院)"},
    {"id": "chinese:cas-physics-math", "label": "CAS: Physics & Mathematics (数理科学)", "group": "Chinese Academy of Sciences (中科院)"},
    {"id": "chinese:cas-life-medicine", "label": "CAS: Life Sciences & Bio-Medicine (生命科学与医学)", "group": "Chinese Academy of Sciences (中科院)"},
    {"id": "chinese:cas-computing-tech", "label": "CAS: Computing & High Technology (信息与计算科学)", "group": "Chinese Academy of Sciences (中科院)"},

    # China Academic Journals / CNKI (中国知网)
    {"id": "chinese:cnki-humanities", "label": "CNKI / CAJ: Literature, History & Philosophy (知网文史哲)", "group": "China Academic Journals (CNKI)"},
    {"id": "chinese:cnki-social-sciences", "label": "CNKI / CAJ: Social Sciences & Education (知网社科与教育)", "group": "China Academic Journals (CNKI)"},
    {"id": "chinese:cnki-geography-env", "label": "CNKI / CAJ: Geography & Urban Planning (知网地理与环境)", "group": "China Academic Journals (CNKI)"},
    {"id": "chinese:cnki-science-tech", "label": "CNKI / CAJ: Natural Sciences & Technology (知网自然科学)", "group": "China Academic Journals (CNKI)"},

    # Psychology & Cognitive Sciences
    {"id": "field:psychology", "label": "Psychology (all)", "group": "Psychology & Cognitive Sciences"},
    {"id": "field:cognitive-psychology", "label": "Cognitive Psychology", "group": "Psychology & Cognitive Sciences"},
    {"id": "field:neuropsychology", "label": "Neuropsychology & Behavioral Neuroscience", "group": "Psychology & Cognitive Sciences"},
    {"id": "field:developmental-psychology", "label": "Developmental Psychology", "group": "Psychology & Cognitive Sciences"},
    {"id": "field:social-psychology", "label": "Social & Personality Psychology", "group": "Psychology & Cognitive Sciences"},
    {"id": "field:clinical-psychology", "label": "Clinical Psychology & Psychopathology", "group": "Psychology & Cognitive Sciences"},

    # Linguistics & Language Sciences
    {"id": "field:linguistics", "label": "Linguistics (all)", "group": "Linguistics & Language"},
    {"id": "field:computational-linguistics", "label": "Computational Linguistics & NLP", "group": "Linguistics & Language"},
    {"id": "field:psycholinguistics", "label": "Psycholinguistics & Neurolinguistics", "group": "Linguistics & Language"},
    {"id": "field:sociolinguistics", "label": "Sociolinguistics & Language Evolution", "group": "Linguistics & Language"},
    {"id": "field:syntax-semantics", "label": "Syntax, Semantics & Pragmatics", "group": "Linguistics & Language"},

    # Philosophy & Ethics
    {"id": "field:philosophy", "label": "Philosophy (all)", "group": "Philosophy & Ethics"},
    {"id": "field:philosophy-of-mind", "label": "Philosophy of Mind & Consciousness", "group": "Philosophy & Ethics"},
    {"id": "field:ethics", "label": "Ethics & Moral Philosophy", "group": "Philosophy & Ethics"},
    {"id": "field:epistemology", "label": "Epistemology & Logic", "group": "Philosophy & Ethics"},
    {"id": "field:chinese-philosophy", "label": "Chinese Philosophy & Thought (中国哲学与思想)", "group": "Philosophy & Ethics"},
    {"id": "field:philosophy-of-science", "label": "Philosophy of Science", "group": "Philosophy & Ethics"},

    # Geography & Earth Sciences
    {"id": "field:geography", "label": "Geography (all)", "group": "Geography & Earth"},
    {"id": "field:human-geography", "label": "Human & Urban Geography", "group": "Geography & Earth"},
    {"id": "field:physical-geography", "label": "Physical Geography & Geomorphology", "group": "Geography & Earth"},
    {"id": "field:gis-spatial", "label": "GIS & Spatial Analysis", "group": "Geography & Earth"},
    {"id": "field:geopolitics", "label": "Geopolitics & Environmental Policy", "group": "Geography & Earth"},
    {"id": "physics.geo-ph", "label": "Geophysics (arXiv)", "group": "Geography & Earth"},

    # Social Sciences, History & Education
    {"id": "field:sociology", "label": "Sociology (all)", "group": "Social Sciences & Humanities"},
    {"id": "field:history", "label": "History (all)", "group": "Social Sciences & Humanities"},
    {"id": "field:chinese-history", "label": "Chinese History & East Asian Studies (中国历史与东亚研究)", "group": "Social Sciences & Humanities"},
    {"id": "field:political-science", "label": "Political Science & International Relations", "group": "Social Sciences & Humanities"},
    {"id": "field:education", "label": "Education & Pedagogy", "group": "Social Sciences & Humanities"},
    {"id": "field:anthropology", "label": "Anthropology & Archaeology", "group": "Social Sciences & Humanities"},

    # Medicine & Life Sciences
    {"id": "field:medicine", "label": "Medicine & Clinical Research", "group": "Medicine & Health"},
    {"id": "field:neuroscience", "label": "Neuroscience", "group": "Medicine & Health"},
    {"id": "field:public-health", "label": "Public Health & Epidemiology", "group": "Medicine & Health"},
    {"id": "field:immunology", "label": "Immunology & Infectious Disease", "group": "Medicine & Health"},
    {"id": "q-bio", "label": "Quantitative Biology (all arXiv)", "group": "Medicine & Health"},
    {"id": "q-bio.BM", "label": "Biomolecules", "group": "Medicine & Health"},
    {"id": "q-bio.CB", "label": "Cell Behavior", "group": "Medicine & Health"},
    {"id": "q-bio.GN", "label": "Genomics", "group": "Medicine & Health"},
    {"id": "q-bio.MN", "label": "Molecular Networks", "group": "Medicine & Health"},
    {"id": "q-bio.NC", "label": "Neurons & Cognition", "group": "Medicine & Health"},
    {"id": "q-bio.OT", "label": "Other Quantitative Biology", "group": "Medicine & Health"},
    {"id": "q-bio.PE", "label": "Populations & Evolution", "group": "Medicine & Health"},
    {"id": "q-bio.QM", "label": "Quantitative Methods", "group": "Medicine & Health"},
    {"id": "q-bio.SC", "label": "Subcellular Processes", "group": "Medicine & Health"},
    {"id": "q-bio.TO", "label": "Tissues & Organs", "group": "Medicine & Health"},

    # Chemistry & Materials
    {"id": "physics.chem-ph", "label": "Chemical Physics", "group": "Chemistry & Materials"},
    {"id": "cond-mat.mtrl-sci", "label": "Materials Science", "group": "Chemistry & Materials"},
    {"id": "physics.ao-ph", "label": "Atmospheric & Oceanic Physics", "group": "Chemistry & Materials"},
    {"id": "physics.flu-dyn", "label": "Fluid Dynamics", "group": "Chemistry & Materials"},
    {"id": "physics.hist-ph", "label": "History & Philosophy of Physics", "group": "Chemistry & Materials"},

    # Astrophysics
    {"id": "astro-ph", "label": "Astrophysics (all)", "group": "Astrophysics"},
    {"id": "astro-ph.CO", "label": "Cosmology & Nongalactic Astrophysics", "group": "Astrophysics"},
    {"id": "astro-ph.EP", "label": "Earth & Planetary Astrophysics", "group": "Astrophysics"},
    {"id": "astro-ph.GA", "label": "Astrophysics of Galaxies", "group": "Astrophysics"},
    {"id": "astro-ph.HE", "label": "High Energy Astrophysical Phenomena", "group": "Astrophysics"},
    {"id": "astro-ph.IM", "label": "Instrumentation & Methods for Astrophysics", "group": "Astrophysics"},
    {"id": "astro-ph.SR", "label": "Solar & Stellar Astrophysics", "group": "Astrophysics"},

    # Condensed Matter
    {"id": "cond-mat", "label": "Condensed Matter (all)", "group": "Condensed Matter"},
    {"id": "cond-mat.dis-nn", "label": "Disordered Systems & Neural Networks", "group": "Condensed Matter"},
    {"id": "cond-mat.mes-hall", "label": "Mesoscale & Nanoscale Physics", "group": "Condensed Matter"},
    {"id": "cond-mat.other", "label": "Other Condensed Matter", "group": "Condensed Matter"},
    {"id": "cond-mat.quant-gas", "label": "Quantum Gases", "group": "Condensed Matter"},
    {"id": "cond-mat.soft", "label": "Soft Condensed Matter", "group": "Condensed Matter"},
    {"id": "cond-mat.stat-mech", "label": "Statistical Mechanics", "group": "Condensed Matter"},
    {"id": "cond-mat.str-el", "label": "Strongly Correlated Electrons", "group": "Condensed Matter"},
    {"id": "cond-mat.supr-con", "label": "Superconductivity", "group": "Condensed Matter"},

    # Physics
    {"id": "gr-qc", "label": "General Relativity & Quantum Cosmology", "group": "Physics"},
    {"id": "hep-ex", "label": "High Energy Physics – Experiment", "group": "Physics"},
    {"id": "hep-lat", "label": "High Energy Physics – Lattice", "group": "Physics"},
    {"id": "hep-ph", "label": "High Energy Physics – Phenomenology", "group": "Physics"},
    {"id": "hep-th", "label": "High Energy Physics – Theory", "group": "Physics"},
    {"id": "math-ph", "label": "Mathematical Physics", "group": "Physics"},
    {"id": "nlin", "label": "Nonlinear Sciences (all)", "group": "Physics"},
    {"id": "nlin.AO", "label": "Adaptation & Self-Organizing Systems", "group": "Physics"},
    {"id": "nlin.CD", "label": "Chaotic Dynamics", "group": "Physics"},
    {"id": "nlin.CG", "label": "Cellular Automata & Lattice Gases", "group": "Physics"},
    {"id": "nlin.PS", "label": "Pattern Formation & Solitons", "group": "Physics"},
    {"id": "nlin.SI", "label": "Exactly Solvable & Integrable Systems", "group": "Physics"},
    {"id": "nucl-ex", "label": "Nuclear Experiment", "group": "Physics"},
    {"id": "nucl-th", "label": "Nuclear Theory", "group": "Physics"},
    {"id": "physics", "label": "Physics (all)", "group": "Physics"},
    {"id": "physics.acc-ph", "label": "Accelerator Physics", "group": "Physics"},
    {"id": "physics.app-ph", "label": "Applied Physics", "group": "Physics"},
    {"id": "physics.atm-clus", "label": "Atomic & Molecular Clusters", "group": "Physics"},
    {"id": "physics.atom-ph", "label": "Atomic Physics", "group": "Physics"},
    {"id": "physics.bio-ph", "label": "Biological Physics", "group": "Physics"},
    {"id": "physics.class-ph", "label": "Classical Physics", "group": "Physics"},
    {"id": "physics.comp-ph", "label": "Computational Physics", "group": "Physics"},
    {"id": "physics.data-an", "label": "Data Analysis, Statistics & Probability", "group": "Physics"},
    {"id": "physics.ed-ph", "label": "Physics Education", "group": "Physics"},
    {"id": "physics.gen-ph", "label": "General Physics", "group": "Physics"},
    {"id": "physics.ins-det", "label": "Instrumentation & Detectors", "group": "Physics"},
    {"id": "physics.med-ph", "label": "Medical Physics", "group": "Physics"},
    {"id": "physics.optics", "label": "Optics", "group": "Physics"},
    {"id": "physics.plasm-ph", "label": "Plasma Physics", "group": "Physics"},
    {"id": "physics.pop-ph", "label": "Popular Physics", "group": "Physics"},
    {"id": "physics.soc-ph", "label": "Physics & Society", "group": "Physics"},
    {"id": "physics.space-ph", "label": "Space Physics", "group": "Physics"},
    {"id": "quant-ph", "label": "Quantum Physics", "group": "Physics"},

    # Mathematics
    {"id": "math", "label": "Mathematics (all)", "group": "Mathematics"},
    {"id": "math.AG", "label": "Algebraic Geometry", "group": "Mathematics"},
    {"id": "math.AT", "label": "Algebraic Topology", "group": "Mathematics"},
    {"id": "math.AP", "label": "Analysis of PDEs", "group": "Mathematics"},
    {"id": "math.CT", "label": "Category Theory", "group": "Mathematics"},
    {"id": "math.CA", "label": "Classical Analysis & ODEs", "group": "Mathematics"},
    {"id": "math.CO", "label": "Combinatorics", "group": "Mathematics"},
    {"id": "math.AC", "label": "Commutative Algebra", "group": "Mathematics"},
    {"id": "math.CV", "label": "Complex Variables", "group": "Mathematics"},
    {"id": "math.DG", "label": "Differential Geometry", "group": "Mathematics"},
    {"id": "math.DS", "label": "Dynamical Systems", "group": "Mathematics"},
    {"id": "math.FA", "label": "Functional Analysis", "group": "Mathematics"},
    {"id": "math.GM", "label": "General Mathematics", "group": "Mathematics"},
    {"id": "math.GN", "label": "General Topology", "group": "Mathematics"},
    {"id": "math.GT", "label": "Geometric Topology", "group": "Mathematics"},
    {"id": "math.GR", "label": "Group Theory", "group": "Mathematics"},
    {"id": "math.HO", "label": "History & Overview", "group": "Mathematics"},
    {"id": "math.IT", "label": "Information Theory", "group": "Mathematics"},
    {"id": "math.KT", "label": "K-Theory & Homology", "group": "Mathematics"},
    {"id": "math.LO", "label": "Logic", "group": "Mathematics"},
    {"id": "math.MP", "label": "Mathematical Physics", "group": "Mathematics"},
    {"id": "math.MG", "label": "Metric Geometry", "group": "Mathematics"},
    {"id": "math.NT", "label": "Number Theory", "group": "Mathematics"},
    {"id": "math.NA", "label": "Numerical Analysis", "group": "Mathematics"},
    {"id": "math.OA", "label": "Operator Algebras", "group": "Mathematics"},
    {"id": "math.OC", "label": "Optimization & Control", "group": "Mathematics"},
    {"id": "math.PR", "label": "Probability", "group": "Mathematics"},
    {"id": "math.QA", "label": "Quantum Algebra", "group": "Mathematics"},
    {"id": "math.RT", "label": "Representation Theory", "group": "Mathematics"},
    {"id": "math.RA", "label": "Rings & Algebras", "group": "Mathematics"},
    {"id": "math.SP", "label": "Spectral Theory", "group": "Mathematics"},
    {"id": "math.ST", "label": "Statistics Theory", "group": "Mathematics"},
    {"id": "math.SG", "label": "Symplectic Geometry", "group": "Mathematics"},

    # Computer Science
    {"id": "cs", "label": "Computer Science (all)", "group": "Computer Science"},
    {"id": "cs.AI", "label": "Artificial Intelligence", "group": "Computer Science"},
    {"id": "cs.AR", "label": "Hardware Architecture", "group": "Computer Science"},
    {"id": "cs.CC", "label": "Computational Complexity", "group": "Computer Science"},
    {"id": "cs.CE", "label": "Computational Engineering, Finance & Science", "group": "Computer Science"},
    {"id": "cs.CG", "label": "Computational Geometry", "group": "Computer Science"},
    {"id": "cs.CL", "label": "Computation & Language", "group": "Computer Science"},
    {"id": "cs.CR", "label": "Cryptography & Security", "group": "Computer Science"},
    {"id": "cs.CV", "label": "Computer Vision & Pattern Recognition", "group": "Computer Science"},
    {"id": "cs.CY", "label": "Computers & Society", "group": "Computer Science"},
    {"id": "cs.DB", "label": "Databases", "group": "Computer Science"},
    {"id": "cs.DC", "label": "Distributed, Parallel & Cluster Computing", "group": "Computer Science"},
    {"id": "cs.DL", "label": "Digital Libraries", "group": "Computer Science"},
    {"id": "cs.DM", "label": "Discrete Mathematics", "group": "Computer Science"},
    {"id": "cs.DS", "label": "Data Structures & Algorithms", "group": "Computer Science"},
    {"id": "cs.ET", "label": "Emerging Technologies", "group": "Computer Science"},
    {"id": "cs.FL", "label": "Formal Languages & Automata", "group": "Computer Science"},
    {"id": "cs.GL", "label": "General Literature", "group": "Computer Science"},
    {"id": "cs.GR", "label": "Graphics", "group": "Computer Science"},
    {"id": "cs.GT", "label": "Computer Science & Game Theory", "group": "Computer Science"},
    {"id": "cs.HC", "label": "Human-Computer Interaction", "group": "Computer Science"},
    {"id": "cs.IR", "label": "Information Retrieval", "group": "Computer Science"},
    {"id": "cs.IT", "label": "Information Theory", "group": "Computer Science"},
    {"id": "cs.LG", "label": "Machine Learning", "group": "Computer Science"},
    {"id": "cs.LO", "label": "Logic in Computer Science", "group": "Computer Science"},
    {"id": "cs.MA", "label": "Multiagent Systems", "group": "Computer Science"},
    {"id": "cs.MM", "label": "Multimedia", "group": "Computer Science"},
    {"id": "cs.MS", "label": "Mathematical Software", "group": "Computer Science"},
    {"id": "cs.NA", "label": "Numerical Analysis", "group": "Computer Science"},
    {"id": "cs.NE", "label": "Neural & Evolutionary Computing", "group": "Computer Science"},
    {"id": "cs.NI", "label": "Networking & Internet Architecture", "group": "Computer Science"},
    {"id": "cs.OH", "label": "Other Computer Science", "group": "Computer Science"},
    {"id": "cs.OS", "label": "Operating Systems", "group": "Computer Science"},
    {"id": "cs.PF", "label": "Performance", "group": "Computer Science"},
    {"id": "cs.PL", "label": "Programming Languages", "group": "Computer Science"},
    {"id": "cs.RO", "label": "Robotics", "group": "Computer Science"},
    {"id": "cs.SC", "label": "Symbolic Computation", "group": "Computer Science"},
    {"id": "cs.SD", "label": "Sound", "group": "Computer Science"},
    {"id": "cs.SE", "label": "Software Engineering", "group": "Computer Science"},
    {"id": "cs.SI", "label": "Social & Information Networks", "group": "Computer Science"},
    {"id": "cs.SY", "label": "Systems & Control", "group": "Computer Science"},

    # Economics & Finance
    {"id": "econ", "label": "Economics (all)", "group": "Economics & Finance"},
    {"id": "econ.EM", "label": "Econometrics", "group": "Economics & Finance"},
    {"id": "econ.GN", "label": "General Economics", "group": "Economics & Finance"},
    {"id": "econ.TH", "label": "Theoretical Economics", "group": "Economics & Finance"},
    {"id": "q-fin", "label": "Quantitative Finance (all)", "group": "Economics & Finance"},
    {"id": "q-fin.CP", "label": "Computational Finance", "group": "Economics & Finance"},
    {"id": "q-fin.EC", "label": "Economics (q-fin)", "group": "Economics & Finance"},
    {"id": "q-fin.GN", "label": "General Finance", "group": "Economics & Finance"},
    {"id": "q-fin.MF", "label": "Mathematical Finance", "group": "Economics & Finance"},
    {"id": "q-fin.PM", "label": "Portfolio Management", "group": "Economics & Finance"},
    {"id": "q-fin.PR", "label": "Pricing of Securities", "group": "Economics & Finance"},
    {"id": "q-fin.RM", "label": "Risk Management", "group": "Economics & Finance"},
    {"id": "q-fin.ST", "label": "Statistical Finance", "group": "Economics & Finance"},
    {"id": "q-fin.TR", "label": "Trading & Market Microstructure", "group": "Economics & Finance"},

    # Statistics & Engineering
    {"id": "stat", "label": "Statistics (all)", "group": "Statistics & Engineering"},
    {"id": "stat.AP", "label": "Applications", "group": "Statistics & Engineering"},
    {"id": "stat.CO", "label": "Computation", "group": "Statistics & Engineering"},
    {"id": "stat.ME", "label": "Methodology", "group": "Statistics & Engineering"},
    {"id": "stat.ML", "label": "Machine Learning", "group": "Statistics & Engineering"},
    {"id": "stat.OT", "label": "Other Statistics", "group": "Statistics & Engineering"},
    {"id": "stat.TH", "label": "Statistics Theory", "group": "Statistics & Engineering"},
    {"id": "eess", "label": "Electrical Engineering & Systems Science (all)", "group": "Statistics & Engineering"},
    {"id": "eess.AS", "label": "Audio & Speech Processing", "group": "Statistics & Engineering"},
    {"id": "eess.IV", "label": "Image & Video Processing", "group": "Statistics & Engineering"},
    {"id": "eess.SP", "label": "Signal Processing", "group": "Statistics & Engineering"},
    {"id": "eess.SY", "label": "Systems & Control", "group": "Statistics & Engineering"},
]

CAT_RE = re.compile(r"^[A-Za-z]+(?:-[A-Za-z0-9]+)?(?:\.[A-Za-z0-9-]+)?$")
FIELD_RE = re.compile(r"^(?:field|custom|chinese):[A-Za-z0-9._ -]+$", re.IGNORECASE)

# Friendly mapping from field ids to search query keywords
FIELD_QUERY_MAP: dict[str, str] = {
    # Chinese Academy of Social Sciences & NCPSSD
    "chinese:ncpssd-philosophy": "Chinese Academy of Social Sciences philosophy OR 中国社会科学院 哲学 OR 哲学研究",
    "chinese:ncpssd-history": "Chinese Academy of Social Sciences history OR 中国社会科学院 历史学 OR 考古",
    "chinese:ncpssd-literature": "Chinese Academy of Social Sciences literature linguistics OR 文学评论 OR 文学研究",
    "chinese:ncpssd-sociology": "Chinese Academy of Social Sciences sociology law OR 社会学研究 OR 法学研究",
    "chinese:ncpssd-economics": "Chinese Academy of Social Sciences economics political science OR 经济研究 OR 政治学",

    # Chinese Academy of Sciences (CAS)
    "chinese:cas-science-china": "Chinese Academy of Sciences Science China OR 中国科学院 中国科学 OR 科学通报",
    "chinese:cas-earth-geography": "Chinese Academy of Sciences geography earth sciences OR 中国科学院 地理科学 OR 地理学报",
    "chinese:cas-physics-math": "Chinese Academy of Sciences physics mathematics OR 中国科学院 物理学 数学",
    "chinese:cas-life-medicine": "Chinese Academy of Sciences life sciences biology medicine OR 中国科学院 生命科学",
    "chinese:cas-computing-tech": "Chinese Academy of Sciences computing technology information OR 中国科学院 计算所 自动化所",

    # China Academic Journals / CNKI
    "chinese:cnki-humanities": "China Academic Journals Literature History Philosophy OR 中国学术期刊 文史哲",
    "chinese:cnki-social-sciences": "China Academic Journals Social Sciences Education OR 中国学术期刊 社会科学",
    "chinese:cnki-geography-env": "China Academic Journals Geography Urban Planning Environment OR 中国学术期刊 地理",
    "chinese:cnki-science-tech": "China Academic Journals Natural Sciences Technology Engineering OR 中国学术期刊 自然科学",

    # Psychology & Cognitive Sciences
    "field:psychology": "psychology",
    "field:cognitive-psychology": "cognitive psychology",
    "field:neuropsychology": "neuropsychology neuroscience",
    "field:developmental-psychology": "developmental psychology child development",
    "field:social-psychology": "social psychology personality",
    "field:clinical-psychology": "clinical psychology psychopathology psychotherapy",
    "field:linguistics": "linguistics language",
    "field:computational-linguistics": "computational linguistics natural language processing",
    "field:psycholinguistics": "psycholinguistics neurolinguistics",
    "field:sociolinguistics": "sociolinguistics language variation",
    "field:syntax-semantics": "syntax semantics pragmatics",
    "field:philosophy": "philosophy",
    "field:philosophy-of-mind": "philosophy of mind consciousness",
    "field:ethics": "ethics moral philosophy",
    "field:epistemology": "epistemology logic philosophical logic",
    "field:chinese-philosophy": "chinese philosophy confucianism daoism",
    "field:philosophy-of-science": "philosophy of science epistemology",
    "field:geography": "geography spatial analysis",
    "field:human-geography": "human geography urban geography",
    "field:physical-geography": "physical geography geomorphology hydrology",
    "field:gis-spatial": "GIS geographic information systems spatial analysis",
    "field:geopolitics": "geopolitics political geography environmental policy",
    "field:sociology": "sociology social structures",
    "field:history": "history historiography",
    "field:chinese-history": "chinese history east asian studies",
    "field:political-science": "political science international relations",
    "field:education": "education pedagogy educational psychology",
    "field:anthropology": "anthropology archaeology",
    "field:medicine": "clinical medicine healthcare",
    "field:neuroscience": "neuroscience brain neural",
    "field:public-health": "public health epidemiology",
    "field:immunology": "immunology infectious disease immunology",
}


def normalize_category(raw: str) -> str:
    cat = (raw or "").strip()
    if not cat or cat.lower() in ("all", "*", "all:*"):
        return "all"
    return cat


def is_openalex_topic(cat: str) -> bool:
    norm = normalize_category(cat)
    if norm.startswith("field:") or norm.startswith("custom:") or norm.startswith("chinese:"):
        return True
    return not bool(CAT_RE.fullmatch(norm)) and norm != "all"


def get_topic_search_query(cat: str) -> str:
    norm = normalize_category(cat)
    if norm in FIELD_QUERY_MAP:
        return FIELD_QUERY_MAP[norm]
    if norm.startswith("field:"):
        return norm[len("field:"):].replace("-", " ")
    if norm.startswith("custom:"):
        return norm[len("custom:"):].replace("-", " ")
    if norm.startswith("chinese:"):
        return norm[len("chinese:"):].replace("-", " ")
    return norm


def is_valid_category(cat: str) -> bool:
    norm = normalize_category(cat)
    if norm == "all":
        return True
    if bool(CAT_RE.fullmatch(norm)):
        return True
    if bool(FIELD_RE.fullmatch(norm)):
        return True
    return False


def search_query_for(cat: str) -> str:
    if cat == "all":
        return "all:*"
    return f"cat:{cat}"
