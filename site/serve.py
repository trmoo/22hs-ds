#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
빌드된 웹 교과서를 로컬에서 여는 스크립트.

학교 전산실·USB 배포용이다. 파이썬만 있으면 되고 Node 는 필요 없다.
정적 파일이라 인터넷 없이도 본문·차트·퀴즈·검색이 모두 동작한다.
(파이썬 코드 실행기만 인터넷이 필요하며, 없으면 예상 출력을 보여 준다.)

  python serve.py            # dist/ 를 열고 브라우저 실행
  python serve.py --port 8080
  python serve.py --no-open
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # 수업 중 콘텐츠를 고쳐도 바로 반영되게 캐시를 끈다
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 콘솔을 조용하게 둔다


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(ROOT):
        print("dist/ 가 없다. 먼저 빌드해야 한다:", file=sys.stderr)
        print("  cd site && npm install && npm run build", file=sys.stderr)
        sys.exit(1)

    socketserver.TCPServer.allow_reuse_address = True
    for port in range(args.port, args.port + 20):
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    else:
        print(f"{args.port}~{args.port + 19} 사이에 빈 포트가 없다.", file=sys.stderr)
        sys.exit(1)

    url = f"http://127.0.0.1:{port}/"
    print(f"데이터 과학 웹교과서: {url}")
    print("종료: Ctrl+C")
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
        httpd.shutdown()


if __name__ == "__main__":
    main()
