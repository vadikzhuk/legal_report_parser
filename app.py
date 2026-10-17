"""Small web viewer for legal-review reports.

Run:  python app.py  [--port 5050]  then open http://localhost:5050
"""
import argparse
import datetime as dt
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from report_parser import parse_report

BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "reports"
STATIC_DIR = BASE_DIR / "static"
ALLOWED = {".xlsx", ".csv"}

REPORTS_DIR.mkdir(exist_ok=True)
app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024


def _report_path(report_id):
    path = (REPORTS_DIR / secure_filename(report_id)).resolve()
    if path.parent != REPORTS_DIR.resolve() or not path.is_file():
        abort(404)
    return path


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/reports")
def list_reports():
    items = []
    for path in sorted(REPORTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if path.suffix.lower() not in ALLOWED:
            continue
        try:
            data = parse_report(path)
            items.append({
                "id": path.name,
                "title": data["title"],
                "risk": data["header"].get("Risk level", ""),
                "prepared": data["header"].get("Prepared", ""),
                "ticket": data["header"].get("Linear", ""),
                "uploaded": dt.datetime.fromtimestamp(path.stat().st_mtime).strftime("%d.%m.%Y %H:%M"),
            })
        except Exception as exc:  # keep the list usable if one file is broken
            items.append({"id": path.name, "title": path.name, "error": str(exc)})
    return jsonify(items)


@app.get("/api/reports/<report_id>")
def get_report(report_id):
    path = _report_path(report_id)
    try:
        data = parse_report(path)
    except Exception as exc:
        return jsonify({"error": f"Could not parse {path.name}: {exc}"}), 422
    data["id"] = path.name
    return jsonify(data)


@app.post("/api/reports")
def upload_report():
    files = request.files.getlist("file")
    if not files:
        return jsonify({"error": "No file uploaded"}), 400
    saved, errors = [], []
    for f in files:
        name = secure_filename(f.filename or "")
        if Path(name).suffix.lower() not in ALLOWED:
            errors.append(f"{f.filename}: only .xlsx or .csv are accepted")
            continue
        dest = REPORTS_DIR / name
        f.save(dest)
        try:
            parse_report(dest)
            saved.append(name)
        except Exception as exc:
            dest.unlink(missing_ok=True)
            errors.append(f"{f.filename}: {exc}")
    status = 200 if saved else 422
    return jsonify({"saved": saved, "errors": errors}), status


@app.delete("/api/reports/<report_id>")
def delete_report(report_id):
    _report_path(report_id).unlink()
    return jsonify({"deleted": report_id})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5050)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    app.run(host=args.host, port=args.port, debug=False)
