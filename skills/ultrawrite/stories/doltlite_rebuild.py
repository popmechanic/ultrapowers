#!/usr/bin/env python3
"""Rebuild the stories export as a DoltLite history: one branch per story,
one commit per step, each commit's message naming the plan and the date it
was signed. DoltLite is the story record, never the app's live data (#998).

    doltlite_rebuild.py <steps.jsonl> <out.db>"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import steps as steps_mod  # noqa: E402


def _write_content(cur, content):
    tables, values = content
    cur.execute("DELETE FROM cells")
    cur.execute("DELETE FROM vals")
    for t, rows in tables.items():
        for r, cells in rows.items():
            for c, v in cells.items():
                cur.execute("INSERT INTO cells VALUES (?, ?, ?, ?)", (t, r, c, json.dumps(v)))
    for k, v in values.items():
        cur.execute("INSERT INTO vals VALUES (?, ?)", (k, json.dumps(v)))


def rebuild(rows, db_path):
    import doltlite
    conn = doltlite.connect(db_path)
    cur = conn.cursor()
    cur.execute("CREATE TABLE cells (tbl TEXT, row TEXT, cell TEXT, value TEXT, PRIMARY KEY (tbl, row, cell))")
    cur.execute("CREATE TABLE vals (name TEXT PRIMARY KEY, value TEXT)")
    cur.execute("SELECT dolt_add('-A')")
    cur.execute("SELECT dolt_commit('-m', 'the empty app')")
    commits = 0
    for story, srows in steps_mod.stories_of(rows).items():
        cur.execute("SELECT dolt_checkout('main')")
        cur.execute("SELECT dolt_branch(?)", (story,))
        cur.execute("SELECT dolt_checkout(?)", (story,))
        for r in srows:
            _write_content(cur, r["after"])
            cur.execute("SELECT dolt_add('-A')")
            cur.execute("SELECT dolt_commit('--allow-empty', '-m', ?)",
                        ("%s.%d %s plan=%s signed=%s" % (story, r["step"], r["tool"],
                                                         r.get("plan", "?"), r.get("signed", "?")),))
            commits += 1
    conn.commit()
    conn.close()
    return commits


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: doltlite_rebuild.py <steps.jsonl> <out.db>")
    print("%d commit(s)" % rebuild(steps_mod.load_steps(sys.argv[1]), sys.argv[2]))
