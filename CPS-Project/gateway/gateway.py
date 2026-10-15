from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import os

UPSTREAM = os.environ.get("CPS_UPSTREAM_URL", "http://127.0.0.1:8001").rstrip("/")
ALLOWED_PATHS = {"/heartbeat", "/readings"}
MAX_BODY_BYTES = 16384

class Gateway(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ALLOWED_PATHS:
            self.send_error(404, "Not found")
            return

        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            self.send_error(400, "Invalid content length")
            return

        if size < 0 or size > MAX_BODY_BYTES:
            self.send_error(413, "Invalid request size")
            return

        credential = self.headers.get("X-Device-Credential")
        if not credential:
            self.send_error(401, "Device credential required")
            return

        body = self.rfile.read(size)
        request = Request(
            UPSTREAM + self.path,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Device-Credential": credential,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=10) as response:
                status = response.status
                result = response.read(16384)
        except HTTPError as exc:
            status = exc.code
            result = exc.read(16384)
        except URLError:
            self.send_error(502, "CPS backend unavailable")
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def do_GET(self):
        self.send_error(404, "Not found")

    def do_PUT(self):
        self.send_error(405, "Method not allowed")

    def do_PATCH(self):
        self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        self.send_error(405, "Method not allowed")

    def do_OPTIONS(self):
        self.send_error(405, "Method not allowed")

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8013), Gateway)
    print("ESP32 ingestion gateway listening on 127.0.0.1:8013", flush=True)
    server.serve_forever()
