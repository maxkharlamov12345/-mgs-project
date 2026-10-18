"""Тестовый сервер «как GitHub Pages»: Range-запросы, Cache-Control max-age=600, ETag/Last-Modified.
Видео .mp4 отдаются из VP9-копий (в тестовом Chromium нет H.264), остальное — из репозитория."""
import http.server, os, sys, re, email.utils, mimetypes
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
VP9 = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vp9')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8799

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_HEAD(self): self.handle_get(head=True)
    def do_GET(self): self.handle_get()
    def handle_get(self, head=False):
        from urllib.parse import unquote, urlsplit
        path = unquote(urlsplit(self.path).path)
        if path.endswith('/'): path += 'index.html'
        rel = path.lstrip('/')
        fp = os.path.join(ROOT, rel)
        if rel.startswith('assets/') and rel.endswith('.mp4') and '/' not in rel[7:]:
            alt = os.path.join(VP9, rel[7:])
            if os.path.exists(alt): fp = alt
        if not os.path.isfile(fp):
            self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
        st = os.stat(fp); size = st.st_size
        etag = '"%x-%x"' % (int(st.st_mtime), size)
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304); self.send_header('ETag', etag); self.send_header('Cache-Control', 'max-age=600'); self.end_headers(); return
        ctype = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
        if fp.endswith('.webp'): ctype = 'image/webp'
        if fp.endswith('.woff2'): ctype = 'font/woff2'
        rng = self.headers.get('Range'); start, end = 0, size - 1; code = 200
        m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1): start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
            else: start = size - int(m.group(2))
            end = min(end, size - 1); code = 206
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'max-age=600')
        self.send_header('ETag', etag)
        self.send_header('Last-Modified', email.utils.formatdate(st.st_mtime, usegmt=True))
        if code == 206: self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        if head: return
        with open(fp, 'rb') as f:
            f.seek(start); left = end - start + 1
            try:
                while left > 0:
                    b = f.read(min(65536, left))
                    if not b: break
                    self.wfile.write(b); left -= len(b)
            except (BrokenPipeError, ConnectionResetError): pass

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
