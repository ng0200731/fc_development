import sqlite3, os
dbpath = os.path.join("data", "fc.db")
conn = sqlite3.connect(dbpath)
conn.row_factory = sqlite3.Row
print("companies cols:", [r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()])
print("members   cols:", [r[1] for r in conn.execute("PRAGMA table_info(members)").fetchall()])
print("FK enforcement (default):", conn.execute("PRAGMA foreign_keys").fetchone()[0])
r = conn.execute("SELECT * FROM companies LIMIT 1").fetchone()
print("sample keys:", list(dict(r).keys()) if r else "none")
conn.close()
