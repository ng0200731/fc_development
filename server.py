#!/usr/bin/env python3
"""
FC backend: SQLite database + REST API, also serves the static frontend.

Endpoints
---------
POST   /api/companies         body: {name, email_suffix}            -> create company
GET    /api/companies         -> [{id, name, email_suffix, created_at}]
GET    /api/companies/<id>    -> {id, name, email_suffix, members:[...]}
PUT    /api/companies/<id>    body: {name, email_suffix}            -> edit company
POST   /api/companies/<id>/members   body: {name, email_prefix, title, tel} -> add member
PUT    /api/members/<id>      body: {name, email_prefix, title, tel}-> edit member
DELETE /api/members/<id>      -> remove member
GET    /api/customers         -> flat list (company + its members) for the View page

Run:  python server.py   (default port 8088)
"""

import json
import os
import sqlite3
import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "fc.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
PORT = int(os.environ.get("PORT", "8088"))


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS companies (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email_suffix  TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS members (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            name          TEXT NOT NULL,
            email_prefix  TEXT NOT NULL,
            title         TEXT NOT NULL,
            tel           TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def json_response(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0) or 0)
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# --- API handlers ---------------------------------------------------------

def api_create_company(handler):
    data = read_json_body(handler)
    name = (data.get("name") or "").strip()
    suffix = (data.get("email_suffix") or "").strip().lstrip("@")
    if not name or not suffix:
        return json_response(handler, {"error": "name and email_suffix are required"}, 400)
    conn = db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO companies (name, email_suffix, created_at) VALUES (?, ?, ?)",
        (name, suffix, now_iso()),
    )
    cid = cur.lastrowid
    conn.commit()
    conn.close()
    return json_response(handler, {"id": cid, "name": name, "email_suffix": suffix}, 201)


def api_list_companies(handler):
    conn = db()
    rows = conn.execute("SELECT * FROM companies ORDER BY id DESC").fetchall()
    conn.close()
    return json_response(handler, [dict(r) for r in rows])


def api_get_company(handler, cid):
    conn = db()
    comp = conn.execute("SELECT * FROM companies WHERE id = ?", (cid,)).fetchone()
    if not comp:
        conn.close()
        return json_response(handler, {"error": "not found"}, 404)
    members = conn.execute(
        "SELECT * FROM members WHERE company_id = ? ORDER BY id", (cid,)
    ).fetchall()
    conn.close()
    out = dict(comp)
    out["members"] = [dict(m) for m in members]
    return json_response(handler, out)


def api_add_member(handler, cid):
    conn = db()
    comp = conn.execute("SELECT * FROM companies WHERE id = ?", (cid,)).fetchone()
    if not comp:
        conn.close()
        return json_response(handler, {"error": "company not found"}, 404)
    data = read_json_body(handler)
    name = (data.get("name") or "").strip()
    prefix = (data.get("email_prefix") or "").strip()
    title = (data.get("title") or "").strip()
    tel = (data.get("tel") or "").strip()
    if not (name and prefix and title and tel):
        conn.close()
        return json_response(handler, {"error": "name, email_prefix, title, tel are required"}, 400)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO members (company_id, name, email_prefix, title, tel, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (cid, name, prefix, title, tel, now_iso()),
    )
    mid = cur.lastrowid
    conn.commit()
    conn.close()
    return json_response(
        handler,
        {"id": mid, "company_id": cid, "name": name, "email_prefix": prefix,
         "title": title, "tel": tel},
        201,
    )


def api_update_company(handler, cid):
    conn = db()
    comp = conn.execute("SELECT * FROM companies WHERE id = ?", (cid,)).fetchone()
    if not comp:
        conn.close()
        return json_response(handler, {"error": "company not found"}, 404)
    data = read_json_body(handler)
    name = (data.get("name") or "").strip()
    suffix = (data.get("email_suffix") or "").strip().lstrip("@")
    if not name or not suffix:
        conn.close()
        return json_response(handler, {"error": "name and email_suffix are required"}, 400)
    conn.execute(
        "UPDATE companies SET name = ?, email_suffix = ? WHERE id = ?",
        (name, suffix, cid),
    )
    conn.commit()
    conn.close()
    return json_response(handler, {"id": cid, "name": name, "email_suffix": suffix}, 200)


def api_update_member(handler, mid):
    conn = db()
    mem = conn.execute("SELECT * FROM members WHERE id = ?", (mid,)).fetchone()
    if not mem:
        conn.close()
        return json_response(handler, {"error": "member not found"}, 404)
    data = read_json_body(handler)
    name = (data.get("name") or "").strip()
    prefix = (data.get("email_prefix") or "").strip()
    title = (data.get("title") or "").strip()
    tel = (data.get("tel") or "").strip()
    if not (name and prefix and title and tel):
        conn.close()
        return json_response(handler, {"error": "name, email_prefix, title, tel are required"}, 400)
    conn.execute(
        "UPDATE members SET name = ?, email_prefix = ?, title = ?, tel = ? WHERE id = ?",
        (name, prefix, title, tel, mid),
    )
    conn.commit()
    conn.close()
    return json_response(
        handler,
        {"id": mid, "name": name, "email_prefix": prefix, "title": title, "tel": tel},
        200,
    )


def api_delete_company(handler, cid):
    conn = db()
    comp = conn.execute("SELECT * FROM companies WHERE id = ?", (cid,)).fetchone()
    if not comp:
        conn.close()
        return json_response(handler, {"error": "company not found"}, 404)
    conn.execute("DELETE FROM companies WHERE id = ?", (cid,))
    conn.commit()
    conn.close()
    return json_response(handler, {"ok": True, "id": cid}, 200)


def api_delete_member(handler, mid):
    conn = db()
    mem = conn.execute("SELECT * FROM members WHERE id = ?", (mid,)).fetchone()
    if not mem:
        conn.close()
        return json_response(handler, {"error": "member not found"}, 404)
    conn.execute("DELETE FROM members WHERE id = ?", (mid,))
    conn.commit()
    conn.close()
    return json_response(handler, {"ok": True, "id": mid}, 200)


def api_list_customers(handler):
    """Flat join for the View page: one row per (company) with members nested."""
    conn = db()
    companies = conn.execute("SELECT * FROM companies ORDER BY id DESC").fetchall()
    out = []
    for c in companies:
        members = conn.execute(
            "SELECT * FROM members WHERE company_id = ? ORDER BY id", (c["id"],)
        ).fetchall()
        item = dict(c)
        item["members"] = [dict(m) for m in members]
        out.append(item)
    conn.close()
    return json_response(handler, out)


# --- Router ---------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path
        method = self.command

        if method == "OPTIONS":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return True

        if path == "/api/companies" and method == "POST":
            api_create_company(self); return True
        if path == "/api/companies" and method == "GET":
            api_list_companies(self); return True
        if path == "/api/customers" and method == "GET":
            api_list_customers(self); return True
        if path.startswith("/api/members/"):
            rest = path[len("/api/members/"):]
            if rest.isdigit():
                mid = int(rest)
                if method == "PUT":
                    api_update_member(self, mid); return True
                if method == "DELETE":
                    api_delete_member(self, mid); return True
            return False

        if path.startswith("/api/companies/"):
            rest = path[len("/api/companies/"):]
            if rest.isdigit():
                cid = int(rest)
                if method == "GET":
                    api_get_company(self, cid); return True
                if method == "PUT":
                    api_update_company(self, cid); return True
                if method == "DELETE":
                    api_delete_company(self, cid); return True
            else:
                # /api/companies/<id>/members
                parts = rest.split("/")
                if len(parts) == 2 and parts[0].isdigit() and parts[1] == "members":
                    if method == "POST":
                        api_add_member(self, int(parts[0])); return True

        return False

    def do_GET(self):
        if self._route():
            return
        super().do_GET()

    def do_POST(self):
        if self._route():
            return
        super().do_POST()

    def do_PUT(self):
        if self._route():
            return
        super().do_PUT()

    def do_DELETE(self):
        if self._route():
            return
        super().do_DELETE()

    def do_OPTIONS(self):
        if self._route():
            return
        super().do_OPTIONS()

    def log_message(self, fmt, *args):
        pass  # quiet


def main():
    init_db()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"FC server on http://localhost:{PORT}  (LAN: http://{os.environ.get('COMPUTERNAME','localhost')}:{PORT})")
    print(f"DB: {DB_PATH}")
    print("CTRL+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
