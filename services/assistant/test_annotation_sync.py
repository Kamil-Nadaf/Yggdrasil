import sys, json, time, types
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reading


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(reading, "download_pdf", lambda url, dest: False)
    app = FastAPI()
    app.include_router(reading.make_router(lambda: tmp_path, lambda d, h: None))
    try:
        import zotero
    except ImportError:
        zotero = types.ModuleType("zotero"); monkeypatch.setitem(sys.modules, "zotero", zotero)
    monkeypatch.setattr(zotero, "zotero_credentials", lambda: ("1", "k"), raising=False)
    return TestClient(app), tmp_path


class R:
    def __init__(self, data=None, status=200, headers=None): self._d, self.status_code, self.headers, self.text = data, status, headers or {}, ""
    def json(self): return self._d
    def raise_for_status(self): pass


def make_client(remote, calls, reject=False):
    class Fake:
        def __init__(self, **kw): pass
        def get(self, url, params=None):
            start = params["start"] if params else 0
            it = (params or {}).get("itemType")
            if url.endswith("/items") and it == "attachment":
                rows = [{"key": "P1", "version": 1, "data": {"key": "P1", "itemType": "attachment", "parentItem": "I1", "contentType": "application/pdf", "linkMode": "imported_file"}}]
            elif url.endswith("/items") and it == "annotation":
                rows = list(remote.values())
            else:
                raise AssertionError(url)
            return R(rows if start == 0 else [])
        def post(self, url, json=None, headers=None):
            calls.append(("POST", json))
            if reject:
                r = R({"failed": {"0": {"code": 400, "message": "annotation not allowed"}}}); return r
            ok = {}
            for i, d in enumerate(json):
                k = f"N{len(remote) + 1}"
                remote[k] = {"key": k, "version": 20, "data": d}
                ok[str(i)] = {"key": k, "version": 20, "data": d}
            return R({"successful": ok, "failed": {}})
        def patch(self, url, json=None, headers=None):
            calls.append(("PATCH", url.rsplit("/", 1)[1], json))
            k = url.rsplit("/", 1)[1]
            remote[k]["data"].update(json); remote[k]["version"] += 1
            return R(None, 204, {"Last-Modified-Version": str(remote[k]["version"])})
        def delete(self, url, headers=None):
            calls.append(("DELETE", url.rsplit("/", 1)[1]))
            remote.pop(url.rsplit("/", 1)[1], None)
            return R(None, 204)
    return Fake


def run(c):
    assert c.post("/api/reading/sync-annotations").json()["ok"]
    for _ in range(60):
        st = c.get("/api/reading/sync-annotations/status").json()
        if not st["running"] and st["phase"] in ("done", "error"):
            return st
        time.sleep(0.05)
    raise AssertionError(st)


def zann(id="a1", **kw):
    return {"id": id, "kind": "highlight", "page": 1, "rects": [[0.1, 0.1, 0.3, 0.02]], "text": "gamma", "note": "", "color": "#ffd60a", "created": "t",
            "zpos": {"pageIndex": 0, "rects": [[10, 700, 200, 712]], "ph": 800}, **kw}


def test_full_cycle(env, monkeypatch):
    import httpx
    c, root = env
    item = c.post("/api/reading/items", json={"title": "A Long Enough Title Alpha", "fetch_pdf": False, "zotero_key": "I1"}).json()["book"]
    d = root / "15-Books" / item["slug"]
    (d / "annotations.json").write_text(json.dumps({"annotations": [zann(), zann("a2", kind="area")]}))
    remote = {"R1": {"key": "R1", "version": 7, "data": {"itemType": "annotation", "parentItem": "P1", "annotationType": "underline", "annotationText": "from ipad",
              "annotationComment": "nice", "annotationColor": "#ff6666", "annotationPosition": json.dumps({"pageIndex": 2, "rects": [[1, 2, 3, 4]]}), "dateAdded": "d"}}}
    calls = []
    monkeypatch.setattr(httpx, "Client", make_client(remote, calls))
    st = run(c)
    assert st["phase"] == "done" and st["pulled"] == 1 and st["pushed"] == 1 and st["unsupported"] == 1 and st["items"] == 1, st
    anns = {a["id"]: a for a in json.loads((d / "annotations.json").read_text())["annotations"]}
    assert anns["z-R1"]["kind"] == "underline" and anns["z-R1"]["page"] == 3 and anns["z-R1"]["rects"] == [] and anns["a1"]["zkey"].startswith("N")
    assert (d / "zotero-sync.json").exists()
    # idempotent
    calls.clear(); st = run(c)
    assert not calls and st["pulled"] == st["pushed"] == 0
    # edit here → PATCH; edit there → pulled; delete here → DELETE
    doc = json.loads((d / "annotations.json").read_text())
    for a in doc["annotations"]:
        if a["id"] == "a1": a["note"] = "mac note"
    doc["annotations"] = [a for a in doc["annotations"] if a["id"] != "z-R1"]
    (d / "annotations.json").write_text(json.dumps(doc))
    nk = anns["a1"]["zkey"]
    remote["R1"]["version"] = 8  # untouched remotely: still deleted since we dropped it
    calls.clear(); st = run(c)
    assert ("DELETE", "R1") in calls and any(x[0] == "PATCH" and x[1] == nk for x in calls) and st["updated_remote"] == 1 and st["deleted_remote"] == 1, (calls, st)
    remote[nk]["data"]["annotationComment"] = "ipad edit"; remote[nk]["version"] += 5
    calls.clear(); st = run(c)
    assert st["updated_local"] == 1 and not calls
    assert [a for a in json.loads((d / "annotations.json").read_text())["annotations"] if a["id"] == "a1"][0]["note"] == "ipad edit"
    # deleted in Zotero → deleted here
    remote.pop(nk); st = run(c)
    assert st["deleted_local"] == 1 and all(a["id"] != "a1" for a in json.loads((d / "annotations.json").read_text())["annotations"])


def test_rejected_creates_reported(env, monkeypatch):
    import httpx
    c, root = env
    item = c.post("/api/reading/items", json={"title": "Another Long Enough Title", "fetch_pdf": False, "zotero_key": "I1"}).json()["book"]
    (root / "15-Books" / item["slug"] / "annotations.json").write_text(json.dumps({"annotations": [zann()]}))
    monkeypatch.setattr(httpx, "Client", make_client({}, [], reject=True))
    st = run(c)
    assert st["failed"] == 1 and "annotation not allowed" in st["error"] and st["pushed"] == 0
    a = json.loads((root / "15-Books" / item["slug"] / "annotations.json").read_text())["annotations"][0]
    assert "zkey" not in a


def test_unlinked_and_missing_pdf_counted(env, monkeypatch):
    import httpx
    c, root = env
    a = c.post("/api/reading/items", json={"title": "Not In Zotero At All Here", "fetch_pdf": False}).json()["book"]
    b = c.post("/api/reading/items", json={"title": "In Zotero Without A Pdf", "fetch_pdf": False, "zotero_key": "I9"}).json()["book"]
    for it in (a, b):
        (root / "15-Books" / it["slug"] / "annotations.json").write_text(json.dumps({"annotations": [zann()]}))
    monkeypatch.setattr(httpx, "Client", make_client({}, []))
    st = run(c)
    assert st["unlinked"] == 1 and st["no_pdf"] == 1
