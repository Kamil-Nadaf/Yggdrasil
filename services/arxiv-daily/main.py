"""
arxiv-daily/main.py

Fetches new arXiv submissions from astro-ph.HE, writes:
  - A daily Brief Markdown file:  {VAULT}/00-Inbox/Brief-YYYY-MM-DD.md
  - One paper note per result:    {VAULT}/10-Papers/{citekey}.md
    (skips if note already exists)

Runs on a schedule defined by CRON_TIME (default: 06:30 in TZ).
Also runs once at startup.
"""

import os
import re
import time
import logging
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


def flag_paper(title: str, abstract: str, authors: list[str]) -> bool:
    """True if paper matches any keyword or watched author."""
    text = (title + " " + abstract).lower()
    for kw in KEYWORDS:
        if kw in text:
            return True
    for author in authors:
        for watched in AUTHOR_WATCH:
            if watched in author.lower():
                return True
    return False


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


def write_paper_note(result: arxiv.Result, fm: dict) -> Path:
    """Write a paper note to 10-Papers/. Skips if already exists."""
    notes_dir = VAULT / "10-Papers"
    notes_dir.mkdir(parents=True, exist_ok=True)
    path = notes_dir / f"{fm['citekey']}.md"
    if path.exists():
        return path

    # Build initial body — abstract only (user fills CERIC slots)
    body = f"## Abstract\n\n{result.summary}\n\n## Notes\n\n"

    post = frontmatter.Post(body, **fm)
    path.write_text(frontmatter.dumps(post))
    log.info(f"  Created note: {path.name}")
    return path


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

    # Filter to last 24h (arXiv can return older papers)
    cutoff = datetime.utcnow() - timedelta(hours=36)
    fresh = [r for r in results if r.published and r.published.replace(tzinfo=None) >= cutoff]
    log.info(f"  Fresh (last 36h): {len(fresh)}")

    flagged = []
    all_papers = []

    for result in fresh:
        authors = [str(a) for a in result.authors]
        fm = paper_frontmatter(result)
        note_path = write_paper_note(result, fm)
        is_flagged = flag_paper(result.title, result.summary, authors)

        entry = {
            "citekey": fm["citekey"],
            "arxiv": fm["arxiv"],
            "title": result.title.replace("\n", " "),
            "authors": authors[:3],
            "flagged": is_flagged,
        }
        all_papers.append(entry)
        if is_flagged:
            flagged.append(entry)

    # Write Brief
    brief_dir = VAULT / "00-Inbox"
    brief_dir.mkdir(parents=True, exist_ok=True)
    brief_path = brief_dir / f"Brief-{today_str}.md"

    lines = [
        f"# Daily Brief — {today_str}",
        f"",
        f"Query: `{ARXIV_QUERY}` · {len(fresh)} new papers · {len(flagged)} flagged",
        f"",
    ]

    if flagged:
        lines += ["## ⚑ Flagged Papers", ""]
        for p in flagged:
            authors_str = ", ".join(p["authors"]) + (" et al." if len(p["authors"]) >= 3 else "")
            lines.append(f"- [[{p['citekey']}]] — {p['title']}")
            lines.append(f"  {authors_str} · arXiv:{p['arxiv']}")
            lines.append("")

    lines += ["## All Papers", ""]
    for p in all_papers:
        flag = "⚑ " if p["flagged"] else ""
        lines.append(f"- {flag}[[{p['citekey']}]] — {p['title']}")

    brief_path.write_text("\n".join(lines))
    log.info(f"  Brief written: {brief_path}")


def main():
    log.info(f"arxiv-daily starting. Schedule: {CRON_TIME} ({os.environ.get('TZ', 'UTC')})")
    fetch_and_write()
    schedule.every().day.at(CRON_TIME).do(fetch_and_write)
    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    main()
