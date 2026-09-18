"""Build first, then run with Python 3.9+: python3 tests/manual/local_zip_roundtrip.py.

Uses only a generated ZIP and a loopback HTTP server; no external game resources.
"""

import hashlib
import json
import random
import subprocess
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    downloader_root = Path(__file__).resolve().parents[2]
    module = downloader_root / 'dist/tools/DirectDownloader.js'
    if not module.is_file():
        raise SystemExit('Run npm run build in downloader/ first.')

    files = {
        'sample/README.txt': b'SearchGal local download regression fixture.\n',
        'sample/data.bin': random.Random(20260907).randbytes(256 * 1024),
    }
    with tempfile.TemporaryDirectory(prefix='searchgal-zip-check-') as temporary:
        root = Path(temporary)
        source = root / 'source.zip'
        output = root / 'downloaded'
        output.mkdir()
        with zipfile.ZipFile(source, 'w') as archive:
            for name, data in files.items():
                info = zipfile.ZipInfo(name, date_time=(2026, 9, 7, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        content = source.read_bytes()
        checksum = hashlib.sha256(content).hexdigest()
        etag = f'"{checksum}"'
        ranges = []

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_args):
                pass

            def do_HEAD(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('ETag', etag)
                self.end_headers()

            def do_GET(self):
                requested = self.headers.get('Range')
                start = int(requested.removeprefix('bytes=').removesuffix('-')) if requested else 0
                if start and self.headers.get('If-Range') != etag:
                    self.send_error(412, 'Missing or incorrect If-Range')
                    return
                if not 0 <= start < len(content):
                    self.send_error(416)
                    return
                end = min(start + 16 * 1024, len(content))
                ranges.append((start, end))
                self.send_response(206)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Length', str(end - start))
                self.send_header('Content-Range', f'bytes {start}-{end - 1}/{len(content)}')
                self.send_header('ETag', etag)
                self.end_headers()
                self.wfile.write(content[start:end])

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            javascript = '''
const [moduleUrl, url, outputDir, size] = process.argv.slice(1);
const { DirectDownloader } = await import(moduleUrl);
const result = await new DirectDownloader({ aria2c: false }).download(
  { kind: 'http', url, filename: 'game.zip', size: Number(size) },
  { outputDir },
);
if (!result.success) throw new Error(result.error);
'''
            result = subprocess.run([
                'node', '--input-type=module', '-e', javascript, module.as_uri(),
                f'http://127.0.0.1:{server.server_port}/game.zip', str(output), str(len(content)),
            ], capture_output=True, text=True, timeout=60)
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

        downloaded = output / 'game.zip'
        assert hashlib.sha256(downloaded.read_bytes()).hexdigest() == checksum, 'Downloaded bytes differ'
        assert not list(output.glob('*.part*')), 'Unexpected partial files after success'
        assert len(ranges) > 5, 'Fixture must exercise continuation beyond five responses'
        assert ranges[0][0] == 0 and ranges[-1][1] == len(content)
        assert all(previous[1] == current[0] for previous, current in zip(ranges, ranges[1:]))
        with zipfile.ZipFile(downloaded) as archive:
            assert archive.testzip() is None, 'ZIP CRC verification failed'
            archive.extractall(root / 'extracted')
        for name, expected in files.items():
            assert (root / 'extracted' / name).read_bytes() == expected, f'Extracted bytes differ: {name}'
        print(json.dumps({
            'scope': 'generated local ZIP',
            'archive_bytes': len(content),
            'range_responses': len(ranges),
            'sha256': checksum,
            'crc_check': 'passed',
            'extracted_files': len(files),
            'extracted_bytes_match': True,
        }, indent=2))


if __name__ == '__main__':
    main()
