#!/usr/bin/env python3
"""Static server for the autochess build.

Plain `python3 -m http.server` answers with Last-Modified/304, and the preview
browser then reuses cached ES modules across reloads — edits to src/*.js kept
running the previous build even after a hard navigation. Everything here is
served no-store so a reload always picks up the current file.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # SimpleHTTPRequestHandler answers 304 when the browser sends a
        # conditional request. Dropping the validators forces a full body every
        # time, which is the whole point of this server.
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

    def log_message(self, fmt, *args):
        if "GET" in (args[0] if args else ""):
            return  # keep the console readable during asset loads
        super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=directory)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {directory} on http://127.0.0.1:{port} (no-store)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
