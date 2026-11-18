import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import zotero


def _server(status, body):
    seen = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setattr(zotero, "zotero_credentials", lambda: ("123", "key"))


def _add(srv, monkeypatch, collection="COLL"):
    monkeypatch.setattr(zotero, "ZOTERO_API", f"http://127.0.0.1:{srv.server_port}")
    return zotero.add_paper_to_zotero("2401.00001", "T", ["Doe, Jane"], "", collection)


def test_add_ok(creds, monkeypatch):
    srv, seen = _server(200, {"successful": {"0": {"key": "K"}}, "failed": {}})
    assert _add(srv, monkeypatch)["arxiv_id"] == "2401.00001"
    assert seen[0][0]["collections"] == ["COLL"]


def test_add_forbidden_is_readable(creds, monkeypatch):
    srv, _ = _server(403, {})
    with pytest.raises(RuntimeError, match="write access"):
        _add(srv, monkeypatch)


def test_add_stale_collection_is_readable(creds, monkeypatch):
    srv, _ = _server(200, {"successful": {}, "failed": {"0": {"code": 409, "message": "Collection COLL not found"}}})
    with pytest.raises(RuntimeError, match="no longer exists"):
        _add(srv, monkeypatch)


def test_add_unreachable_is_readable(creds, monkeypatch):
    monkeypatch.setattr(zotero, "ZOTERO_API", "http://127.0.0.1:1")
    with pytest.raises(RuntimeError, match="reach Zotero"):
        zotero.add_paper_to_zotero("2401.00001", "T", [], "", "")
