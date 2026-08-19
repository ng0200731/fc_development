import os, sys, threading, time, sqlite3, urllib.request

DB_PATH = os.path.join("data", "fc_test.db")
# Temporarily point the server at our test DB before importing.
import server
server.DB_PATH = DB_PATH
# Re-init on test DB
from http.server import HTTPServer

PORT = 8123
srv = None
def start():
    global srv
    server.PORT = PORT
    server.init_db()
    srv = HTTPServer(("127.0.0.1", PORT), server.Handler)
    srv.serve_forever()

t = threading.Thread(target=start, daemon=True)
t.start()
time.sleep(0.6)

url = f"http://127.0.0.1:{PORT}"
# seed a company
req = urllib.request.Request(url + "/api/companies", method="POST",
    data=b'{"name":"ZTest Co","email_suffix":"ztest.com"}',
    headers={"Content-Type":"application/json"})
r = urllib.request.urlopen(req); print("POST:", r.status, r.read().decode())
cid = r.read()

# re-fetch to get id
r = urllib.request.urlopen(url + "/api/companies"); data = __import__("json").load(r)
zid = [c for c in data if c["name"] == "ZTest Co"][-1]["id"]
print("created company id:", zid)

# DELETE it
req2 = urllib.request.Request(url + f"/api/companies/{zid}", method="DELETE")
try:
    r2 = urllib.request.urlopen(req2); print("DELETE:", r2.status, r2.read().decode())
except urllib.error.HTTPError as e:
    print("DELETE HTTPError:", e.code, e.read().decode())
except Exception as e:
    print("DELETE ERR:", type(e).__name__, e)

# confirm gone
r3 = urllib.request.urlopen(url + "/api/companies"); data3 = __import__("json").load(r3)
still = [c for c in data3 if c["id"] == zid]
print("still present after delete:", bool(still))
srv.shutdown()
