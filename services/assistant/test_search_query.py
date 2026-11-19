from search_query import arxiv_author_query, fold, openalex_author_filter, parse_query


def test_fold_repairs_pdf_accents():
    assert fold("M ́esz ́aros") == "Meszaros"
    assert fold("M´esz´aros") == "Meszaros"
    assert fold("Mészáros") == "Meszaros"
    assert fold("Łukasz Børve") == "Lukasz Borve"


def test_citation_queries():
    for q in ("M ́esz ́aros & Rees 2000", "Mészáros & Rees 2000", "Mészáros and Rees (2000)"):
        p = parse_query(q)
        assert p.citation and p.authors == ["Meszaros", "Rees"] and p.year == 2000, q
    p = parse_query("Band et al. 1993")
    assert p.citation and p.authors == ["Band"] and p.year == 1993
    p = parse_query("Rees, M. J. & Mészáros, P. 1994")
    assert p.authors == ["Rees", "Meszaros"] and p.year == 1994
    assert parse_query("Wu & Li 2019").authors == ["Wu", "Li"]


def test_plain_queries_are_left_alone():
    for q in ("gamma-ray bursts 2000", "GRB 190114C", "neutron star 2020", "Mészáros", "P. Mészáros"):
        assert not parse_query(q).citation, q
    assert parse_query("Mészáros").text == "Meszaros"
    assert not parse_query("Rees 2000", "title").citation


def test_query_builders():
    p = parse_query("Mészáros & Rees 2000")
    assert arxiv_author_query(p) == "au:Meszaros AND au:Rees AND submittedDate:[199901010000 TO 200112312359]"
    assert openalex_author_filter(p) == "raw_author_name.search:Meszaros,raw_author_name.search:Rees,publication_year:1999-2001"
