import json, re, secrets, time, hashlib
import httpx, pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

U = "123"


class FakeZotero:
    def __init__(self):
        self.version = 10
        self.cols = {}      # key -> data
        self.items = {}     # key -> data
        self.files = {}     # attachment key -> bytes
        self.created_items = 0
        self.uploads = 0
        self.pending_upload = {}

    def bump(self):
        self.version += 1
        return self.version

    def add_col(self, name, parent=False):
        k = secrets.token_hex(4).upper()
        self.cols[k] = {"key": k, "name": name, "parentCollection": parent, "version": self.bump()}
        return k

    def add_item(self, **data):
        k = data.pop("key", secrets.token_hex(4).upper())
        d = {"key": k, "itemType": "journalArticle", "collections": [], "version": self.bump(), **data}
        self.items[k] = d
        return k

    def handler(self, req: httpx.Request) -> httpx.Response:
        path, q = req.url.path, dict(req.url.params)
        h = {"Last-Modified-Version": str(self.version)}
        def js(obj, status=200):
            return httpx.Response(status, json=obj, headers=h)
        if path == "/items/new":
            t = q["itemType"]
            base = {"itemType": t, "title": "", "creators": [], "abstractNote": "", "date": "", "url": "", "extra": "", "tags": [], "collections": [], "relations": {}}
            if t == "journalArticle":
                base.update(publicationTitle="", volume="", issue="", pages="", DOI="")
            if t == "preprint":
                base.update(repository="", archiveID="", DOI="")
            if t == "book":
                base.update(publisher="")
            return js(base)
        assert path.startswith(f"/users/{U}/"), path
        sub = path[len(f"/users/{U}/"):]
        if req.headers.get("Zotero-API-Key") != "KEY":
            return httpx.Response(403)
        if sub == "collections" and req.method == "GET":
            return js([{"key": k, "data": d} for k, d in self.cols.items()])
        if sub == "collections" and req.method == "POST":
            o = json.loads(req.content)[0]
            k = self.add_col(o["name"], o.get("parentCollection") or False)
            return js({"successful": {"0": {"key": k, "version": self.version}}, "failed": {}})
        if sub == "items/top" and req.method == "GET":
            iv = req.headers.get("If-Modified-Since-Version")
            if iv and int(iv) >= self.version:
                return httpx.Response(304, headers=h)
            rows = [{"key": k, "data": d} for k, d in self.items.items() if d["itemType"] not in ("attachment", "note") and not d.get("parentItem")]
            if "q" in q:
                needle = q["q"].lower()
                rows = [r for r in rows if needle in json.dumps(r["data"]).lower()]
            start, limit = int(q.get("start", 0)), int(q.get("limit", 100))
            return js(rows[start:start + limit])
        if sub == "items" and req.method == "GET":  # notes + attachments listing
            rows = [{"key": k, "data": d} for k, d in self.items.items() if d["itemType"] in ("attachment", "note")]
            return js(rows)
        if sub == "items" and req.method == "POST":
            o = json.loads(req.content)[0]
            self.created_items += 1
            k = self.add_item(**o)
            return js({"successful": {"0": {"key": k, "version": self.version}}, "failed": {}})
        m = re.fullmatch(r"items/(\w+)/children", sub)
        if m:
            return js([{"key": k, "data": d} for k, d in self.items.items() if d.get("parentItem") == m.group(1)])
        m = re.fullmatch(r"items/(\w+)/file", sub)
        if m and req.method == "POST":
            k = m.group(1)
            body = req.content.decode()
            if body.startswith("upload="):
                self.files[k] = self.pending_upload.pop(k)
                self.uploads += 1
                self.bump()
                return httpx.Response(204, headers=h)
            return js({"url": f"https://upload.fake/{k}", "contentType": "multipart/form-data; boundary=x", "prefix": "--x\r\n\r\n", "suffix": "\r\n--x--", "uploadKey": "UP" + k})
        m = re.fullmatch(r"items/(\w+)", sub)
        if m and req.method == "GET":
            d = self.items[m.group(1)]
            return js({"key": d["key"], "version": d["version"], "data": d})
        if m and req.method == "PATCH":
            d = self.items[m.group(1)]
            assert req.headers["If-Unmodified-Since-Version"] == str(d["version"])
            d.update(json.loads(req.content)); d["version"] = self.bump()
            return httpx.Response(204, headers=h)
        raise AssertionError(f"unhandled {req.method} {req.url}")

    def upload_handler(self, req):
        k = req.url.path.rsplit("/", 1)[1]
        self.pending_upload[k] = req.content
        return httpx.Response(201)


@pytest.fixture
def env(tmp_path, monkeypatch):
    z = FakeZotero()
    def route(req):
        return z.upload_handler(req) if req.url.host == "upload.fake" else z.handler(req)
    real = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda *a, **k: real(*a, **{**k, "transport": httpx.MockTransport(route)}))
    monkeypatch.setenv("ZOTERO_USER_ID", U)
    monkeypatch.setenv("ZOTERO_API_KEY", "KEY")
    monkeypatch.setenv("YGG_CONFIG_PATH", str(tmp_path / "cfg" / "config.json"))
    import reading
    reading.__dict__  # noqa
    import zotero_push; zotero_push._template_cache.clear()
    router = reading.make_router(lambda: tmp_path / "vault", lambda d, h: None)
    app = FastAPI(); app.include_router(router)
    return z, TestClient(app), router, tmp_path / "vault"


def wait_sync(c):
    for _ in range(100):
        s = c.get("/api/reading/zotero-sync/status").json()
        if not s["running"] and s["last_ts"]:
            return s
        time.sleep(0.05)
    raise AssertionError("sync did not finish")


def cols(c):
    return c.get("/api/reading/collections").json()["collections"]


def test_pull_new_collection_and_items(env):
    z, c, router, vault = env
    nju = z.add_col("NJU"); bbz = z.add_col("BBZ Papers", nju)
    z.add_item(title="Comprehensive analysis of Fermi GRB data II Ep evolution", DOI="10.1088/0004-637X/756/2/112", collections=[bbz], date="2012")
    assert c.post("/api/reading/zotero-sync").json()["ok"]
    s = wait_sync(c)
    assert s["ok"], s
    cs = {x["name"]: x for x in cols(c)}
    assert set(cs) == {"NJU", "BBZ Papers"}
    assert cs["BBZ Papers"]["parent"] == cs["NJU"]["id"] and cs["BBZ Papers"]["zotero_key"] == bbz
    assert len(cs["BBZ Papers"]["slugs"]) == 1


def test_rename_and_membership_removal_pull(env):
    z, c, router, vault = env
    a = z.add_col("A"); k = z.add_item(title="A long enough title for matching", collections=[a])
    c.post("/api/reading/zotero-sync"); wait_sync(c)
    assert len(cols(c)[0]["slugs"]) == 1
    z.cols[a]["name"] = "A renamed"; z.cols[a]["version"] = z.bump()
    z.items[k]["collections"] = []; z.items[k]["version"] = z.bump()
    c.post("/api/reading/zotero-sync"); wait_sync(c)
    x = cols(c)[0]
    assert x["name"] == "A renamed" and x["slugs"] == []


def test_unchanged_library_is_not_pulled_again(env):
    z, c, router, vault = env
    z.add_item(title="Some paper with a long title here")
    c.post("/api/reading/zotero-sync"); s = wait_sync(c); assert s["pulled"]
    router.zotero_auto_tick  # exists
    from reading import _json_read  # noqa
    import reading
    # auto tick right after: not due (no dirty flag, <5 min) -> nothing happens
    t0 = s["last_ts"]; router.zotero_auto_tick(); assert c.get("/api/reading/zotero-sync/status").json()["last_ts"] == t0


def test_push_new_item_collection_and_pdf(env):
    z, c, router, vault = env
    # local collection first (no Zotero involvement yet), then a paper added into it
    r = c.put("/api/reading/collections", json={"collections": [{"id": "c_local1", "name": "Mine", "slugs": []}]}); assert r.status_code == 200
    r = c.post("/api/reading/items", json={"title": "Prompt GRB pulses and internal shocks", "authors": ["Ada Lovelace", "Hubble, Edwin"], "year": 2020,
                                           "doi": "10.1234/abc.1", "venue": "ApJ", "item_type": "article", "collection": "c_local1", "fetch_pdf": False, "tags": ["grb"]})
    slug = r.json()["book"]["slug"]
    (vault / "15-Books" / slug / "book.pdf").write_bytes(b"%PDF-1.4 fake pdf bytes")
    router.zotero_auto_tick.__call__  # callable
    import time as _t; _t.sleep(3.2)   # debounce window
    router.zotero_auto_tick(); s = wait_sync(c)
    assert s["ok"], s
    assert s["pushed_collections"] == 1 and s["pushed_items"] == 1 and s["pushed_files"] == 1, s
    mine = [k for k, d in z.cols.items() if d["name"] == "Mine"]
    assert len(mine) == 1
    item = next(d for d in z.items.values() if d["itemType"] == "journalArticle")
    assert item["title"].startswith("Prompt GRB") and item["DOI"] == "10.1234/abc.1" and item["publicationTitle"] == "ApJ"
    assert item["collections"] == mine and item["date"] == "2020" and item["tags"] == [{"tag": "grb"}]
    assert {"creatorType": "author", "firstName": "Edwin", "lastName": "Hubble"} in item["creators"]
    att = next(d for d in z.items.values() if d["itemType"] == "attachment")
    assert att["parentItem"] == item["key"] and att["contentType"] == "application/pdf"
    assert b"%PDF-1.4 fake pdf bytes" in z.files[att["key"]]
    assert c.get("/api/reading/library").json() is not None
    # local state is linked, and a second pass creates nothing
    local = [b for b in c.get("/api/reading/library").json()["books"] if b["slug"] == slug][0]
    assert local["zotero_key"] == item["key"]
    c.post("/api/reading/zotero-sync"); s2 = wait_sync(c)
    assert s2["pushed_items"] == 0 and s2["pushed_files"] == 0 and z.created_items == 2  # 1 item + 1 attachment


def test_push_links_existing_zotero_item_instead_of_duplicating(env):
    z, c, router, vault = env
    existing = z.add_item(title="Totally different title in Zotero", DOI="10.1234/DUP.7")
    col = z.add_col("Shared")
    c.put("/api/reading/collections", json={"collections": [{"id": "c_s", "name": "Shared", "slugs": []}]})
    c.post("/api/reading/items", json={"title": "Local title", "doi": "https://doi.org/10.1234/dup.7", "collection": "c_s", "fetch_pdf": False})
    c.post("/api/reading/zotero-sync"); s = wait_sync(c)
    assert s["linked_items"] == 1 and s["pushed_items"] == 0 and s["pushed_collections"] == 0, s
    assert z.created_items == 0
    assert z.items[existing]["collections"] == [col]


def test_add_existing_item_to_collection_in_ui_pushes_membership(env):
    z, c, router, vault = env
    col = z.add_col("Target"); k = z.add_item(title="Paper that already lives in Zotero ok")
    c.post("/api/reading/zotero-sync"); wait_sync(c)
    cl = cols(c); cl.append({"id": "c_x", "name": "Fresh", "slugs": []})
    c.put("/api/reading/collections", json={"collections": cl}); c.post("/api/reading/zotero-sync"); wait_sync(c)
    target = next(x for x in cols(c) if x["name"] == "Target")
    slug = c.get("/api/reading/library").json()["books"][0]["slug"]
    target["slugs"].append(slug)
    c.put("/api/reading/collections", json={"collections": cols(c) and [target if x["id"] == target["id"] else x for x in cols(c)]})
    c.post("/api/reading/zotero-sync"); s = wait_sync(c)
    assert s["ok"], s
    assert col in z.items[k]["collections"]
    assert any(d["name"] == "Fresh" for d in z.cols.values())  # the new local collection reached Zotero too


def test_auth_error_is_reported_not_crashing(env, monkeypatch):
    z, c, router, vault = env
    monkeypatch.setenv("ZOTERO_API_KEY", "WRONG")
    r = c.post("/api/reading/zotero-sync"); s = wait_sync(c)
    assert not s["ok"] and "refused" in s["error"].lower()
