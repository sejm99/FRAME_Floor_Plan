from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import gdstk
import pandas as pd
import io
import os
import uuid

from a2wsgi import ASGIMiddleware

app = FastAPI()
# This is for PythonAnywhere WSGI compatibility
wsgi_app = ASGIMiddleware(app)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Chip(BaseModel):
    id: str
    name: str
    width: float
    height: float
    x: float
    y: float
    rotation: int = 0

class FloorplanRequest(BaseModel):
    chips: List[Chip]
    field_width: float
    field_height: float

# --- API Endpoints ---
@app.post("/api/export/gds")
async def export_gds(req: FloorplanRequest):
    lib = gdstk.Library("FLOORPLAN_LIB")
    cell = lib.new_cell("TOP")
    rect = gdstk.rectangle((0, 0), (req.field_width, req.field_height), layer=0, datatype=0)
    cell.add(rect)
    for c in req.chips:
        is_rot = (c.rotation == 90)
        cw, ch = (c.width, c.height) if not is_rot else (c.height, c.width)
        chip_rect = gdstk.rectangle((c.x, c.y), (c.x + cw, c.y + ch), layer=1, datatype=0)
        cell.add(chip_rect)
        label = gdstk.Label(c.name, (c.x + cw/2, c.y + ch/2), layer=1, texttype=0, anchor="o")
        cell.add(label)
    
    temp_filename = f"export_{uuid.uuid4().hex}.gds"
    try:
        lib.write_gds(temp_filename)
        return FileResponse(temp_filename, media_type="application/octet-stream", filename="mask_floorplan.gds")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Static File Serving ---
# Find the absolute path to the frontend 'dist' folder
current_dir = os.path.dirname(os.path.abspath(__file__))
dist_path = os.path.join(os.path.dirname(current_dir), "frontend", "dist")

if os.path.exists(dist_path):
    # Serve assets folder
    if os.path.exists(os.path.join(dist_path, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(dist_path, "assets")), name="assets")

    # Serve index.html for all other non-API routes (SPA support)
    @app.get("/{full_path:path}")
    async def serve_frontend(request: Request, full_path: str):
        # Ignore API paths
        if full_path.startswith("api/"):
             raise HTTPException(status_code=404)
        
        # Check if file exists in dist (e.g. favicon.ico)
        file_path = os.path.join(dist_path, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
            
        # Fallback to index.html for React routing
        index_file = os.path.join(dist_path, "index.html")
        return FileResponse(index_file)
else:
    @app.get("/")
    async def root():
        return {"message": "Floorplan API is running (Static files not found, run 'npm run build' first)"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
