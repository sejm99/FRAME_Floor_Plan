from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import gdstk
import io
import os

app = Flask(__name__)
CORS(app)

# --- Paths ---
current_dir = os.path.dirname(os.path.abspath(__file__))
dist_path   = os.path.join(os.path.dirname(current_dir), "frontend", "dist")

# ── API ──────────────────────────────────────────────────────────────────────

@app.route("/api/export/gds", methods=["POST"])
def export_gds():
    try:
        data = request.get_json(force=True)

        field_width  = float(data["field_width"])
        field_height = float(data["field_height"])
        chips        = data.get("chips", [])

        lib  = gdstk.Library("FLOORPLAN_LIB")
        cell = lib.new_cell("TOP")
        cell.add(gdstk.rectangle((0, 0), (field_width, field_height), layer=0))

        for c in chips:
            is_rot = int(c.get("rotation", 0)) == 90
            cw = float(c["height"] if is_rot else c["width"])
            ch = float(c["width"]  if is_rot else c["height"])
            x, y = float(c["x"]), float(c["y"])
            cell.add(gdstk.rectangle((x, y), (x + cw, y + ch), layer=1))
            cell.add(gdstk.Label(c["name"], (x + cw/2, y + ch/2), layer=1, anchor="o"))

        # Write to a temp file then read back into memory
        import tempfile, os as _os
        with tempfile.NamedTemporaryFile(suffix=".gds", delete=False) as tmp:
            tmp_path = tmp.name
        lib.write_gds(tmp_path)
        with open(tmp_path, "rb") as f:
            buf = io.BytesIO(f.read())
        _os.unlink(tmp_path)
        buf.seek(0)

        return send_file(
            buf,
            as_attachment=True,
            download_name="mask_floorplan.gds",
            mimetype="application/octet-stream"
        )
    except Exception as e:
        return jsonify(error=str(e)), 500

# ── Static / SPA ─────────────────────────────────────────────────────────────

@app.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(os.path.join(dist_path, "assets"), filename)

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    # never catch real API calls
    if path.startswith("api/"):
        return jsonify(error="not found"), 404

    # serve real file if it exists (favicon.ico etc.)
    file_path = os.path.join(dist_path, path)
    if path and os.path.isfile(file_path):
        return send_from_directory(dist_path, path)

    # fall back to index.html for React Router
    index = os.path.join(dist_path, "index.html")
    if os.path.isfile(index):
        return send_from_directory(dist_path, "index.html")

    return f"index.html not found at {index}", 404

# ── Entry point (local dev) ───────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001, debug=True)
