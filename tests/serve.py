"""Local-only GitHub Pages subpath server. No files or user data are modified."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=8766)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(root),**kwargs)
    def do_GET(self):
        if self.path.startswith('/knowledge-studio/'):
            self.path=self.path[len('/knowledge-studio'):]
        elif self.path=='/knowledge-studio':
            self.send_response(301);self.send_header('Location','/knowledge-studio/');self.end_headers();return
        super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
