import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import cite_resolve as cr


def test_parse_entry_variants():
    p = cr.parse_entry("Yuan, W., Zhang, C., Chen, Y., & Ling, Z. 2022, in Handbook, 86, doi: 10.1007/978-981-16-4544-0 151-1")
    assert p["doi"] == "10.1007/978-981-16-4544-0_151-1" and p["year"] == "2022" and p["surname"] == "Yuan"
    p = cr.parse_entry("Spada, M., Ghisellini, G., Lazzati, D., & Celotti, A. 2001, MNRAS, 325, 1559")
    assert (p["year"], p["volume"], p["page"], p["surname"]) == ("2001", "325", "1559", "Spada")
    assert cr.parse_entry("1. Petroff, E. et al. Astron. Astrophys. Rev. 27, 4 (2019).")["surname"] == "Petroff"
    assert cr.parse_entry("x", "cite.2024arXiv240710156Y")["arxiv"] == "2407.10156"
    assert cr.parse_entry("Foo 2020, arXiv e-prints, arXiv:2001.01234")["arxiv"] == "2001.01234"


def _openalex(routes):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            for prefix, body in routes.items():
                if self.path.startswith(prefix):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(body).encode())
                    return
            self.send_response(404)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


WORK = {"title": "A paper", "doi": "https://doi.org/10.1234/x", "authorships": [{"author": {"display_name": "Wang Yuan"}}],
        "best_oa_location": {"pdf_url": "https://oa.example/p.pdf", "landing_page_url": "https://oa.example/p"},
        "locations": [{"landing_page_url": "https://arxiv.org/abs/2201.00001v2", "pdf_url": None}]}


def test_resolve_by_doi_prefers_arxiv(monkeypatch):
    srv = _openalex({"/works/doi:10.1234/x": WORK})
    monkeypatch.setattr(cr, "OPENALEX", f"http://127.0.0.1:{srv.server_port}")
    r = asyncio.run(cr.resolve("Wang, Y. 2022, J, 1, 2, doi: 10.1234/x"))
    assert r["ok"] and r["pdf_url"] == "https://arxiv.org/pdf/2201.00001" and r["title"] == "A paper"


def test_resolve_by_volume_and_page(monkeypatch):
    srv = _openalex({"/works?": {"results": [{**WORK, "authorships": [{"author": {"display_name": "Someone Else"}}]}, WORK]}})
    monkeypatch.setattr(cr, "OPENALEX", f"http://127.0.0.1:{srv.server_port}")
    r = asyncio.run(cr.resolve("Yuan, W. 2022, ApJ, 944, 191"))
    assert r["ok"] and r["source"] == "journal" and r["pdf_url"].endswith("2201.00001")


def test_resolve_offline_keeps_doi_link(monkeypatch):
    monkeypatch.setattr(cr, "OPENALEX", "http://127.0.0.1:1")
    r = asyncio.run(cr.resolve("Yuan, W. 2022, doi: 10.1234/x"))
    assert r["ok"] and r["landing_url"] == "https://doi.org/10.1234/x" and r["pdf_url"] == ""
