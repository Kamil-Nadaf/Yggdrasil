import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import canvas

IMG = "data:image/png;base64,iVBORw0KGgo="


def chat(text):
    return {"choices": [{"message": {"role": "assistant", "content": text}}]}


def make_client(tmp_path, handler):
    def factory():
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    app = FastAPI()
    app.include_router(canvas.make_router(lambda: tmp_path, lambda u: u, factory))
    return TestClient(app)


def eng(label, url="http://a/v1", key="", model="m"):
    return {"id": label, "label": label, "base_url": url, "api_key": key, "model": model}


def test_clean_latex_strips_wrappers():
    assert canvas.clean_latex("```latex\nE = mc^2\n```") == "E = mc^2"
    assert canvas.clean_latex("$$\nx^2\n$$") == "x^2"
    assert canvas.clean_latex("\\[ y \\]") == "y"
    assert canvas.clean_latex("<think>hm</think>a+b") == "a+b"
    assert canvas.clean_latex("\\documentclass{article}\\begin{document}\nz\n\\end{document}") == "z"
    assert canvas.clean_latex("$a$ and $b$") == "$a$ and $b$"


def test_validate_latex():
    assert canvas.validate_latex("\\frac{a}{b}") == []
    assert canvas.validate_latex("\\frac{a}{b") == ["Unbalanced braces"]
    assert canvas.validate_latex("\\{ a \\}") == []
    assert canvas.validate_latex("\\begin{align*} a \\end{align*}") == []
    assert "Missing \\end{align*}" in canvas.validate_latex("\\begin{align*} a")
    assert any("Mismatched" in w for w in canvas.validate_latex("\\begin{a} \\end{b}"))
    assert canvas.validate_latex("\\left( x") == ["\\left / \\right do not pair up"]
    assert canvas.validate_latex("\\leftarrow \\rightarrow") == []
    assert canvas.validate_latex("a $ b") == ["Odd number of $ signs"]
    assert canvas.validate_latex("   ") == ["Empty result"]
    assert canvas.validate_latex("x % { comment") == []


def test_recognize_first_engine_wins_and_sends_image(tmp_path):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=chat("```latex\nE = mc^2\n```"))

    c = make_client(tmp_path, handler)
    r = c.post("/api/canvas/recognize", json={"image": IMG, "engines": [eng("lm"), eng("gem", key="k")]})
    assert r.status_code == 200
    j = r.json()
    assert j["latex"] == "E = mc^2" and j["engine"] == "lm" and j["warnings"] == []
    assert len(seen) == 1 and str(seen[0].url) == "http://a/v1/chat/completions"
    assert "authorization" not in seen[0].headers
    body = httpx.Response(200, content=seen[0].content).json()
    assert body["model"] == "m"
    assert body["messages"][0]["content"][1]["image_url"]["url"] == IMG


def test_recognize_falls_back_on_http_error_and_bad_latex(tmp_path):
    def handler(req):
        host = req.url.host
        if host == "one":
            return httpx.Response(500, json={"error": {"message": "model not loaded"}})
        if host == "two":
            return httpx.Response(200, json=chat("\\frac{a}{b"))
        return httpx.Response(200, json=chat("\\frac{a}{b}"))

    c = make_client(tmp_path, handler)
    engines = [eng("one", "http://one/v1"), eng("two", "http://two/v1"), eng("three", "http://three/v1", key="sk")]
    j = c.post("/api/canvas/recognize", json={"image": IMG, "engines": engines}).json()
    assert j["engine"] == "three" and j["latex"] == "\\frac{a}{b}"
    assert [a["ok"] for a in j["attempts"]] == [False, False, True]
    assert "model not loaded" in j["attempts"][0]["error"]


def test_recognize_returns_best_effort_when_all_have_warnings(tmp_path):
    c = make_client(tmp_path, lambda req: httpx.Response(200, json=chat("\\frac{a}{b")))
    j = c.post("/api/canvas/recognize", json={"image": IMG, "engines": [eng("x")]}).json()
    assert j["latex"] == "\\frac{a}{b" and j["warnings"] == ["Unbalanced braces"]


def test_recognize_all_fail_is_502_and_validates_input(tmp_path):
    c = make_client(tmp_path, lambda req: httpx.Response(401, json={"error": "bad key"}))
    r = c.post("/api/canvas/recognize", json={"image": IMG, "engines": [eng("x")]})
    assert r.status_code == 502 and "bad key" in r.json()["detail"]
    assert c.post("/api/canvas/recognize", json={"image": "nope", "engines": [eng("x")]}).status_code == 400
    assert c.post("/api/canvas/recognize", json={"image": IMG, "engines": []}).status_code == 400


def test_models_list(tmp_path):
    def handler(req):
        assert str(req.url) == "http://a/v1/models" and req.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={"data": [{"id": "models/b"}, {"id": "a"}]})

    c = make_client(tmp_path, handler)
    assert c.post("/api/canvas/models", json={"base_url": "http://a/v1", "api_key": "k"}).json() == {"models": ["a", "b"]}


def test_pages_roundtrip_and_name_safety(tmp_path):
    c = make_client(tmp_path, lambda req: httpx.Response(200))
    assert c.get("/api/canvas/pages").json() == {"pages": []}
    assert c.put("/api/canvas/pages/grb fit", json={"strokes": [{"id": 1}], "blocks": []}).json()["ok"]
    assert (tmp_path / "90-Canvas" / "grb fit.ink.json").is_file()
    assert c.get("/api/canvas/pages/grb fit").json()["strokes"] == [{"id": 1}]
    assert [p["name"] for p in c.get("/api/canvas/pages").json()["pages"]] == ["grb fit"]
    assert c.put("/api/canvas/pages/x", json={"strokes": "no"}).status_code == 400
    assert c.get("/api/canvas/pages/missing").status_code == 404
    for bad in ("..%2Fescape", ".hidden", "a%2Fb"):
        assert c.put(f"/api/canvas/pages/{bad}", json={"strokes": []}).status_code in (400, 404, 405)
    assert not list(tmp_path.glob("*escape*"))
    assert c.delete("/api/canvas/pages/grb fit").json()["ok"]
    assert c.get("/api/canvas/pages/grb fit").status_code == 404
