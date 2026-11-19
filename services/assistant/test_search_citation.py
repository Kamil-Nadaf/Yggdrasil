"""Citation-style search ("Mészáros & Rees 2000") goes to author+year queries, with OpenAlex mocked."""
import asyncio

import main


def test_citation_query_uses_author_year_search(monkeypatch):
    seen = {}

    async def fake_arxiv(params):
        seen["arxiv"] = params["search_query"]
        return [{"id": "arxiv:astro-ph/9908126", "title": "Steep Slopes", "categories": [], "authors": ["P. Meszaros"], "abstract": "x"}], 1

    async def fake_oa(pq, start=0, max_results=50):
        seen["oa"] = main.openalex_author_filter(pq)
        return [{"id": "oa:1", "title": "Steep Slopes and Preferred Breaks", "categories": [], "authors": ["P. Meszaros", "M. J. Rees"], "abstract": "y"}], 1

    async def noop(papers, limit=8):
        return None

    monkeypatch.setattr(main, "_fetch_arxiv", fake_arxiv)
    monkeypatch.setattr(main, "_fetch_openalex_citation", fake_oa)
    monkeypatch.setattr(main, "_backfill_missing_abstracts", noop)
    r = asyncio.run(main.arxiv_search("M ́esz ́aros & Rees 2000", "all", "all", 0, 50, ""))
    assert seen["oa"] == "raw_author_name.search:Meszaros,raw_author_name.search:Rees,publication_year:1999-2001"
    assert seen["arxiv"].startswith("au:Meszaros AND au:Rees AND submittedDate:[199901010000")
    assert [p["title"] for p in r["papers"]][0].startswith("Steep Slopes and")  # OpenAlex first
    assert len(r["papers"]) == 2


def test_plain_query_is_accent_folded(monkeypatch):
    seen = {}

    async def fake_arxiv(params):
        seen["q"] = params["search_query"]
        return [], 0

    async def fake_oa(q, field="all", start=0, max_results=50):
        seen["oa"] = q
        return [], 0

    async def noop(papers, limit=8):
        return None

    monkeypatch.setattr(main, "_fetch_arxiv", fake_arxiv)
    monkeypatch.setattr(main, "_fetch_openalex_search", fake_oa)
    monkeypatch.setattr(main, "_backfill_missing_abstracts", noop)
    asyncio.run(main.arxiv_search("M ́esz ́aros", "author", "all", 0, 50, ""))
    assert seen["oa"] == "Meszaros"
