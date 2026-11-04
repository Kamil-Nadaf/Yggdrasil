import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import zotero_annotations as za


def zpos(page=0, rects=None, ph=800):
    return {"pageIndex": page, "rects": rects or [[10, 700, 200, 712]], "ph": ph}


def local(id="a1", **kw):
    return {"id": id, "kind": "highlight", "page": 1, "rects": [[0.1, 0.1, 0.3, 0.02]], "text": "hello", "note": "", "color": "#ffd60a", "zpos": zpos(), **kw}


def remote(key="ZK1", version=5, **kw):
    d = {"itemType": "annotation", "annotationType": "highlight", "annotationText": "hi", "annotationComment": "c", "annotationColor": "#5fb236",
         "annotationPosition": json.dumps({"pageIndex": 2, "rects": [[1, 2, 3, 4]]}), "dateAdded": "2026-01-01T00:00:00Z", **kw}
    return {"key": key, "version": version, "data": d}


def test_nearest_color():
    assert za.nearest_color("#ffd60a") == "#ffd400"
    assert za.nearest_color("#4aa8ff") == "#2ea8e5"
    assert za.nearest_color("garbage") == "#ffd400"


def test_to_zotero_shapes():
    z = za.to_zotero(local(), "ATT")
    assert z["annotationType"] == "highlight" and z["parentItem"] == "ATT" and z["annotationColor"] == "#ffd400"
    assert json.loads(z["annotationPosition"]) == {"pageIndex": 0, "rects": [[10, 700, 200, 712]]}
    assert z["annotationSortIndex"] == "00000|000000|00088" and z["annotationPageLabel"] == "1"
    t = za.to_zotero(local(kind="text", text="typed"), "ATT")
    assert t["annotationComment"] == "typed" and json.loads(t["annotationPosition"])["fontSize"] == 12
    ink = za.to_zotero(local(kind="ink", zpos={"pageIndex": 1, "paths": [[1, 2, 3, 4]], "ph": 800}), "ATT")
    assert json.loads(ink["annotationPosition"])["paths"] == [[1, 2, 3, 4]]
    assert za.to_zotero(local(kind="area"), "ATT") is None
    assert za.to_zotero({**local(), "zpos": None}, "ATT") is None


def test_from_zotero():
    a = za.from_zotero(remote()["data"], "ZK1")
    assert a["page"] == 3 and a["zkey"] == "ZK1" and a["rects"] == [] and a["text"] == "hi" and a["note"] == "c"
    t = za.from_zotero(remote(annotationType="text", annotationText="", annotationComment="typed")["data"], "T")
    assert t["kind"] == "text" and t["text"] == "typed"
    assert za.from_zotero(remote(annotationType="image")["data"], "I")["kind"] == "area"
    assert za.from_zotero({"annotationType": "weird"}, "X") is None


def test_pull_and_push_new():
    plan = za.merge([local()], [remote()], {}, "ATT")
    assert plan["stats"]["pulled"] == 1 and len(plan["create"]) == 1 and len(plan["annotations"]) == 2
    assert plan["state"]["ZK1"]["version"] == 5


def test_unsupported_and_needs_open():
    plan = za.merge([local("p", kind="area"), local("q", zpos=None)], [], {}, "ATT")
    assert plan["stats"]["unsupported"] == 1 and plan["stats"]["needs_open"] == 1 and not plan["create"]


def synced(a, key="ZK1", version=5):
    a = {**a, "zkey": key}
    return a, {key: {"version": version, "hash": za.local_hash(a)}}


def test_unchanged_is_noop():
    a, st = synced(local())
    plan = za.merge([a], [remote()], st, "ATT")
    assert not plan["create"] and not plan["update"] and not plan["delete"] and plan["stats"]["updated_local"] == 0
    assert plan["state"] == st


def test_local_edit_pushes():
    a, st = synced(local())
    a["note"] = "edited on mac"
    plan = za.merge([a], [remote()], st, "ATT")
    assert len(plan["update"]) == 1 and plan["update"][0][1] == 5


def test_remote_edit_wins():
    a, st = synced(local())
    plan = za.merge([a], [remote(version=9, annotationComment="from ipad", annotationPosition=json.dumps({"pageIndex": 0, "rects": [[10, 700, 200, 712]]}))], st, "ATT")
    out = plan["annotations"][0]
    assert out["note"] == "from ipad" and out["rects"] == a["rects"] and plan["stats"]["updated_local"] == 1
    assert out["color"] == "#5fb236" and not plan["update"]
    # remote moved the highlight → fractions must be re-derived
    moved = za.merge([a], [remote(version=9)], st, "ATT")["annotations"][0]
    assert moved["rects"] == [] and moved["page"] == 3


def test_custom_color_survives_if_same_zotero_colour():
    a, st = synced(local(color="#ffd60a"))
    out = za.merge([a], [remote(version=9, annotationColor="#ffd400", annotationPosition=json.dumps(a["zpos"]))], st, "ATT")["annotations"][0]
    assert out["color"] == "#ffd60a"


def test_deletions_both_ways():
    a, st = synced(local())
    gone = za.merge([a], [], st, "ATT")
    assert gone["stats"]["deleted_local"] == 1 and gone["annotations"] == []
    st2 = {"ZK1": {"version": 5, "hash": "x"}}
    mine = za.merge([], [remote()], st2, "ATT")
    assert mine["delete"] == [("ZK1", 5)] and mine["stats"]["deleted_remote"] == 1
    # never synced + remote-only = new from Zotero, not a deletion
    assert za.merge([], [remote()], {}, "ATT")["stats"]["pulled"] == 1
