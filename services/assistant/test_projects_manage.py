"""Pure helpers for starring / priority / ordering projects."""
import projects as pj


def test_clean_priority():
    assert pj.clean_priority("High") == "high"
    assert pj.clean_priority(" low ") == "low"
    assert pj.clean_priority("urgent") is None
    assert pj.clean_priority(None) is None


def test_clean_order():
    assert pj.clean_order(3) == 3
    assert pj.clean_order("2") == 2
    assert pj.clean_order(-1) is None
    assert pj.clean_order(True) is None
    assert pj.clean_order("x") is None


def test_sort_favorite_then_order_then_name():
    items = [
        {"name": "Zed", "favorite": False, "order": 0},
        {"name": "Beta", "favorite": False, "order": None},
        {"name": "alpha", "favorite": False, "order": None},
        {"name": "Mid", "favorite": True, "order": 5},
        {"name": "Top", "favorite": True, "order": 1},
        {"name": "One", "favorite": False, "order": 1},
    ]
    names = [p["name"] for p in sorted(items, key=pj.project_sort_key)]
    assert names == ["Top", "Mid", "Zed", "One", "alpha", "Beta"]
