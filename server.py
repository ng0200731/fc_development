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
import re
import uuid
import sqlite3
import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "fc.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "data", "uploads")
PORT = int(os.environ.get("PORT", "8088"))

os.makedirs(UPLOADS_DIR, exist_ok=True)

# Directory scanned for sample images used by the Development / Create "Dummy"
# button and the image pool. Kept outside the project so the repo stays clean.
SAMPLE_IMAGES_DIR = r"C:\Users\ng\Desktop\canvas_source"
_sample_images_cache = None  # module-level cache for the scanned pool


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
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS developments (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id    INTEGER,
            company_name  TEXT NOT NULL,
            member_id     INTEGER,
            member_name   TEXT,
            item_name     TEXT NOT NULL,
            product_type  TEXT NOT NULL,
            height        REAL,
            width         REAL,
            raised_height REAL,
            no_of_color   INTEGER,
            pantones      TEXT,
            image_names   TEXT,
            doc_names     TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )
        """
    )
    # Migrations: add any columns introduced after the initial schema so that
    # an existing database (already created without them) keeps working.
    _ensure_dev_columns(conn)
    conn.commit()
    conn.close()


# Columns added to `developments` after the table was first created. Each entry
# is { column_name: SQL type }. init_db() adds any that are missing.
_DEV_MISSING_COLUMNS = {
    "doc_names": "TEXT",
}


def _ensure_dev_columns(conn):
    cur = conn.cursor()
    existing = {r[1] for r in cur.execute("PRAGMA table_info(developments)").fetchall()}
    for col, ctype in _DEV_MISSING_COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE developments ADD COLUMN {col} {ctype}")


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


# --- Sample images (for Development / Create Dummy + image pool) -------------

IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def list_sample_images():
    """Scan SAMPLE_IMAGES_DIR once and return a {dir, files:[rel paths]} dict."""
    global _sample_images_cache
    if _sample_images_cache is not None:
        return _sample_images_cache
    files = []
    base = SAMPLE_IMAGES_DIR
    if os.path.isdir(base):
        for root, _dirs, names in os.walk(base):
            for n in names:
                if n.lower().endswith(IMG_EXTS):
                    full = os.path.join(root, n)
                    rel = os.path.relpath(full, base).replace(os.sep, "/")
                    files.append(rel)
    _sample_images_cache = {"dir": base, "files": files}
    return _sample_images_cache


def safe_sample_path(rel):
    """Resolve a relative image path under SAMPLE_IMAGES_DIR, guarding traversal."""
    base = os.path.abspath(SAMPLE_IMAGES_DIR)
    target = os.path.abspath(os.path.join(base, rel))
    if target != base and not target.startswith(base + os.sep):
        return None
    if not os.path.isfile(target):
        return None
    return target


def serve_sample_image(handler, rel):
    path = safe_sample_path(rel)
    if not path:
        handler.send_response(404)
        handler.end_headers()
        return
    ext = os.path.splitext(path)[1].lower()
    ctype = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
    }.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public, max-age=3600")
    handler.end_headers()
    handler.wfile.write(data)


# --- Uploaded files (user-dropped images + documents) -----------------------

EXT_CTYPE = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}


def safe_upload_path(rel):
    """Resolve a relative path under UPLOADS_DIR, guarding traversal."""
    base = os.path.abspath(UPLOADS_DIR)
    target = os.path.abspath(os.path.join(base, rel))
    if target != base and not target.startswith(base + os.sep):
        return None
    if not os.path.isfile(target):
        return None
    return target


def serve_upload(handler, rel):
    path = safe_upload_path(rel)
    if not path:
        handler.send_response(404)
        handler.end_headers()
        return
    ext = os.path.splitext(path)[1].lower()
    ctype = EXT_CTYPE.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public, max-age=3600")
    handler.end_headers()
    handler.wfile.write(data)


def _sanitize_filename(name):
    """Keep only the basename and strip path separators / parent dirs."""
    name = os.path.basename(name or "file")
    name = re.sub(r"[\/\\]", "_", name)
    name = name.replace("..", "_")
    return name or "file"


def api_upload_file(handler):
    """Accept multipart/form-data with a single 'file' field, persist it
    under data/uploads/<uuid>__<sanitized-original>, and return its path."""
    import cgi
    ctype = handler.headers.get("Content-Type", "")
    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": ctype},
    )
    if "file" not in form:
        return json_response(handler, {"error": "no file field"}, 400)
    item = form["file"]
    if not hasattr(item, "filename") or not item.filename:
        return json_response(handler, {"error": "empty file"}, 400)
    orig = _sanitize_filename(item.filename)
    stored = uuid.uuid4().hex + "__" + orig
    with open(os.path.join(UPLOADS_DIR, stored), "wb") as f:
        f.write(item.file.read())
    rel = "uploads/" + stored          # served at GET /uploads/<rest>
    return json_response(handler, {"path": rel, "name": orig, "url": "/" + rel}, 201)


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
    # delete members first (FK enforcement may be off in older SQLite sessions),
    # then the company row itself.
    conn.execute("DELETE FROM members WHERE company_id = ?", (cid,))
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


# --- Development handlers --------------------------------------------------

def _dev_row_to_payload(row):
    out = dict(row)
    for k in ("pantones", "image_names", "doc_names"):
        if out.get(k):
            try:
                out[k] = json.loads(out[k])
            except (json.JSONDecodeError, TypeError):
                out[k] = []
        else:
            out[k] = []
    return out


def api_list_developments(handler):
    conn = db()
    rows = conn.execute("SELECT * FROM developments ORDER BY id DESC").fetchall()
    conn.close()
    return json_response(handler, [_dev_row_to_payload(r) for r in rows])


def api_get_development(handler, did):
    conn = db()
    row = conn.execute("SELECT * FROM developments WHERE id = ?", (did,)).fetchone()
    conn.close()
    if not row:
        return json_response(handler, {"error": "not found"}, 404)
    return json_response(handler, _dev_row_to_payload(row))


def _dev_validate(data):
    return (data.get("company_name") or "").strip() and \
           (data.get("item_name") or "").strip() and \
           (data.get("product_type") or "").strip()


def _dev_insert_or_update(conn, did, data):
    company_name = (data.get("company_name") or "").strip()
    item_name = (data.get("item_name") or "").strip()
    product_type = (data.get("product_type") or "").strip()
    pantones = data.get("pantones")
    image_names = data.get("image_names")
    if isinstance(pantones, (list, dict)):
        pantones = json.dumps(pantones, ensure_ascii=False)
    if isinstance(image_names, (list, dict)):
        image_names = json.dumps(image_names, ensure_ascii=False)
    doc_names = data.get("doc_names")
    if isinstance(doc_names, (list, dict)):
        doc_names = json.dumps(doc_names, ensure_ascii=False)
    vals = (
        data.get("company_id") if did is None else (data.get("company_id") if data.get("company_id") is not None else None),
        company_name,
        data.get("member_id") if data.get("member_id") is not None else None,
        (data.get("member_name") or "").strip() or None,
        item_name,
        product_type,
        _to_float(data.get("height")),
        _to_float(data.get("width")),
        _to_float(data.get("raised_height")),
        _to_int(data.get("no_of_color")),
        pantones,
        image_names,
        doc_names,
    )
    if did is None:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO developments "
            "(company_id, company_name, member_id, member_name, item_name, "
            "product_type, height, width, raised_height, no_of_color, pantones, "
            "image_names, doc_names, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            vals + (now_iso(), now_iso()),
        )
        return cur.lastrowid
    conn.execute(
        "UPDATE developments SET "
        "company_id=?, company_name=?, member_id=?, member_name=?, item_name=?, "
        "product_type=?, height=?, width=?, raised_height=?, no_of_color=?, "
        "pantones=?, image_names=?, doc_names=?, updated_at=? WHERE id=?",
        vals + (now_iso(), did),
    )
    return did


def _to_float(v):
    try:
        if v in (None, ""):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v):
    try:
        if v in (None, ""):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def api_create_development(handler):
    data = read_json_body(handler)
    if not _dev_validate(data):
        return json_response(handler, {"error": "company_name, item_name, product_type are required"}, 400)
    conn = db()
    did = _dev_insert_or_update(conn, None, data)
    conn.commit()
    conn.close()
    return json_response(handler, {"id": did}, 201)


def api_update_development(handler, did):
    conn = db()
    row = conn.execute("SELECT * FROM developments WHERE id = ?", (did,)).fetchone()
    if not row:
        conn.close()
        return json_response(handler, {"error": "not found"}, 404)
    data = read_json_body(handler)
    if not _dev_validate(data):
        conn.close()
        return json_response(handler, {"error": "company_name, item_name, product_type are required"}, 400)
    _dev_insert_or_update(conn, did, data)
    conn.commit()
    conn.close()
    return json_response(handler, {"id": did}, 200)


def api_delete_development(handler, did):
    conn = db()
    row = conn.execute("SELECT * FROM developments WHERE id = ?", (did,)).fetchone()
    if not row:
        conn.close()
        return json_response(handler, {"error": "not found"}, 404)
    conn.execute("DELETE FROM developments WHERE id = ?", (did,))
    conn.commit()
    conn.close()
    return json_response(handler, {"ok": True, "id": did}, 200)


# --- Router ---------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _serve_sample_list(self):
        return json_response(self, list_sample_images())

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
        if path == "/api/sample-images" and method == "GET":
            return self._serve_sample_list()
        if path == "/api/uploads" and method == "POST":
            api_upload_file(self); return True
        if path == "/api/developments" and method == "POST":
            api_create_development(self); return True
        if path == "/api/developments" and method == "GET":
            api_list_developments(self); return True
        if path.startswith("/sample-images/"):
            serve_sample_image(self, path[len("/sample-images/"):]); return True
        if path.startswith("/uploads/"):
            serve_upload(self, path[len("/uploads/"):]); return True
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

        if path.startswith("/api/developments/"):
            rest = path[len("/api/developments/"):]
            if rest.isdigit():
                did = int(rest)
                if method == "GET":
                    api_get_development(self, did); return True
                if method == "PUT":
                    api_update_development(self, did); return True
                if method == "DELETE":
                    api_delete_development(self, did); return True

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
