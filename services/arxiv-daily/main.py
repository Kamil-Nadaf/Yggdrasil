"""
arxiv-daily/main.py

Fetches new arXiv submissions from astro-ph.HE and writes:
  - A daily Brief Markdown file:  {VAULT}/00-Inbox/Brief-YYYY-MM-DD.md
  - One paper note per result:    {VAULT}/10-Papers/{citekey}.md
    (skips if note already exists)

Runs on a schedule defined by CRON_TIME (default: 06:30 in TZ).
Also runs once at startup.
"""

import logging
import os
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import arxiv
import frontmatter
import schedule

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("arxiv-daily")

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
ARXIV_QUERY = os.environ.get("ARXIV_QUERY", "cat:astro-ph.HE")
KEYWORDS = [k.strip().lower() for k in os.environ.get("KEYWORDS", "GRB,gamma-ray burst").split(",") if k.strip()]
AUTHOR_WATCH = [a.strip().lower() for a in os.environ.get("AUTHOR_WATCH", "").split(",") if a.strip()]
CRON_TIME = os.environ.get("CRON_TIME", "06:30")
MAX_RESULTS = int(os.environ.get("MAX_RESULTS", "40"))


def slugify_citekey(author_last: str, year: int, title: str) -> str:
    """Generate a citekey: authorYEARfirstword (lowercase, alphanumeric)."""
    first_word = re.sub(r"[^a-z0-9]", "", re.split(r"\W+", title.lower())[0])[:12]
    last = re.sub(r"[^a-z]", "", author_last.lower())[:12]
    return f"{last}{year}{first_word}"


def match_paper(title: str, abstract: str, authors: list[str]) -> tuple[bool, bool]:
    """Return (keyword_match, author_watch_match)."""
    text = (title + " " + abstract).lower()
    keyword_match = any(kw in text for kw in KEYWORDS)

    author_match = False
    for author in authors:
        author_lower = author.lower()
        if any(watched in author_lower for watched in AUTHOR_WATCH):
            author_match = True
            break

    return keyword_match, author_match


def paper_frontmatter(result: arxiv.Result) -> dict:
    authors = [str(a) for a in result.authors]
    first_author_last = str(result.authors[0]).split()[-1] if result.authors else "unknown"
    year = result.published.year if result.published else date.today().year
    arxiv_id = result.entry_id.split("/abs/")[-1].split("v")[0]
    citekey = slugify_citekey(first_author_last, year, result.title)
    return {
        "citekey": citekey,
        "arxiv": arxiv_id,
        "title": result.title.replace("\n", " "),
        "authors": authors,
        "year": year,
        "journal": "arXiv",
        "doi": result.doi or "",
        "read": "",
        "tier": 0,
        "confidence": 0,
        "rating": 0,
        "claim": "",
        "evidence": "",
        "reasoning": "",
        "implications": "",
        "context": "",
        "aq_written": False,
        "adversarial_question": "",
        "verdict": "",
        "objects": [],
        "instruments": [],
        "methods": [],
        "concepts": [],
        "tags": [],
    }


def paper_body() -> str:
    return """## Claim

## Evidence

## Reasoning

## Implications

## Context

## Adversarial Question

## Confusions

> [!ai]
> """


def write_paper_note(result: arxiv.Result, fm: dict) -> Path:
    """Write a paper note to 10-Papers/. Skips if already exists."""
    notes_dir = VAULT / "10-Papers"
    notes_dir.mkdir(parents=True, exist_ok=True)
    path = notes_dir / f"{fm['citekey']}.md"
    if path.exists():
        return path

    post = frontmatter.Post(paper_body(), **fm)
    path.write_text(frontmatter.dumps(post))
    log.info(f"  Created note: {path.name}")
    return path


def write_brief(today_str: str, fresh_results: list[arxiv.Result], keyword_matches: list[dict], author_matches: list[dict]) -> Path:
    brief_dir = VAULT / "00-Inbox"
    brief_dir.mkdir(parents=True, exist_ok=True)
    brief_path = brief_dir / f"Brief-{today_str}.md"

    lines = [
        f"# arXiv Brief — {today_str}",
        "",
    ]

    if not fresh_results:
        lines.append("No new listings today (weekend or holiday).")
    else:
        lines += [
            f"## Keyword matches",
            "",
        ]
        if keyword_matches:
            for paper in keyword_matches:
                authors_str = ", ".join(paper["authors"]) + (" et al." if len(paper["authors"]) >= 3 else "")
                lines.append(f"### [{paper['arxiv']}] {paper['title']}")
                lines.append(f"**Authors:** {authors_str}")
                lines.append(f"**Abstract:** {paper['abstract']}")
                lines.append(f"**arXiv:** https://arxiv.org/abs/{paper['arxiv']}")
                lines.append("")
        else:
            lines.append("No keyword matches today.")
            lines.append("")

        lines += [
            "---",
            "",
            "## Author watch matches",
            "",
        ]
        if author_matches:
            for paper in author_matches:
                authors_str = ", ".join(paper["authors"]) + (" et al." if len(paper["authors"]) >= 3 else "")
                lines.append(f"### [{paper['arxiv']}] {paper['title']}")
                lines.append(f"**Authors:** {authors_str}")
                lines.append(f"**Abstract:** {paper['abstract']}")
                lines.append(f"**arXiv:** https://arxiv.org/abs/{paper['arxiv']}")
                lines.append("")
        else:
            lines.append("No author watch matches today.")
            lines.append("")

        lines += [
            "---",
            "",
            "## All new papers today",
            "",
        ]
        for paper in fresh_results:
            lines.append(f"- [[{paper['citekey']}]] — {paper['title']}")

    body = "\n".join(lines)
    brief_post = frontmatter.Post(
        body,
        date=today_str,
        source="arxiv",
        category="astro-ph.HE",
        count=len(fresh_results),
    )
    brief_path.write_text(frontmatter.dumps(brief_post))
    log.info(f"  Brief written: {brief_path}")
    return brief_path


def fetch_and_write():
    today = date.today()
    today_str = today.strftime("%Y-%m-%d")
    log.info(f"Running arXiv fetch for {today_str}: {ARXIV_QUERY}")

    client = arxiv.Client(page_size=MAX_RESULTS, num_retries=3)
    search = arxiv.Search(
        query=ARXIV_QUERY,
        max_results=MAX_RESULTS,
        sort_by=arxiv.SortCriterion.SubmittedDate,
    )

    results = list(client.results(search))
    log.info(f"  Fetched {len(results)} results")

    cutoff = datetime.utcnow() - timedelta(hours=36)
    fresh = []
    for result in results:
        if result.published is None:
            continue
        if result.published.replace(tzinfo=None) >= cutoff:
            fresh.append(result)

    log.info(f"  Fresh (last 36h): {len(fresh)}")

    keyword_matches = []
    author_matches = []
    fresh_entries = []

    for result in fresh:
        authors = [str(a) for a in result.authors]
        fm = paper_frontmatter(result)
        write_paper_note(result, fm)

        keyword_match, author_match = match_paper(result.title, result.summary, authors)
        entry = {
            "citekey": fm["citekey"],
            "arxiv": fm["arxiv"],
            "title": result.title.replace("\n", " "),
            "authors": authors[:3],
            "abstract": result.summary.replace("\n", " "),
        }
        fresh_entries.append(entry)

        if keyword_match:
            keyword_matches.append(entry)
        if author_match:
            author_matches.append(entry)

    write_brief(today_str, fresh_entries, keyword_matches, author_matches)


def main():
    log.info(f"arxiv-daily starting. Schedule: {CRON_TIME} ({os.environ.get('TZ', 'UTC')})")
    fetch_and_write()
    schedule.every().day.at(CRON_TIME).do(fetch_and_write)
    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    main()
