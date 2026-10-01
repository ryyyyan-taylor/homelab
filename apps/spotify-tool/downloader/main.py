import asyncio
import re
import shutil
import time
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

TMP_DIR = Path("/tmp")
CLEANUP_AGE_SECONDS = 60 * 60  # delete finished downloads after 1 hour, same as before

# In-memory progress state, keyed by Spotify playlist ID. One replica only —
# same tradeoff the original Node implementation made (progress state is
# lost on restart, which is fine given downloads are short-lived).
progress: dict[str, dict] = {}


class StartDownloadRequest(BaseModel):
    playlistUrl: str
    playlistName: str


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s\-_]", "", name)
    cleaned = re.sub(r"\s+", "-", cleaned.strip())
    return cleaned[:100]


async def spotdl_available() -> bool:
    return shutil.which("spotdl") is not None


async def run_download(playlist_id: str, playlist_url: str, playlist_name: str):
    safe_name = sanitize_filename(playlist_name)
    download_dir = TMP_DIR / f"playlist-{playlist_id}-{int(time.time() * 1000)}"
    download_dir.mkdir(parents=True, exist_ok=True)

    progress[playlist_id] = {
        "status": "downloading",
        "progress": 0,
        "message": "Starting download...",
    }

    try:
        proc = await asyncio.create_subprocess_exec(
            "spotdl", "download", playlist_url,
            "--output", str(download_dir),
            "--format", "mp3",
            "--bitrate", "320k",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        track_count = 0
        completed_tracks = 0
        stderr_lines: list[str] = []

        async def read_stdout():
            nonlocal track_count, completed_tracks
            assert proc.stdout
            async for raw_line in proc.stdout:
                line = raw_line.decode(errors="replace")
                if "Downloaded" in line:
                    completed_tracks += 1
                    if track_count > 0:
                        pct = round((completed_tracks / track_count) * 100)
                        progress[playlist_id] = {
                            "status": "downloading",
                            "progress": pct,
                            "message": f"Downloaded {completed_tracks} of {track_count} tracks",
                        }
                else:
                    match = re.search(r"(\d+)\s+tracks?", line)
                    if match:
                        track_count = int(match.group(1))

        async def read_stderr():
            assert proc.stderr
            async for raw_line in proc.stderr:
                stderr_lines.append(raw_line.decode(errors="replace"))

        await asyncio.gather(read_stdout(), read_stderr())
        return_code = await proc.wait()

        if return_code != 0:
            raise RuntimeError(f"spotdl exited with code {return_code}: {''.join(stderr_lines)}")

        files = list(download_dir.iterdir())
        if not files:
            raise RuntimeError("No tracks were downloaded")

        progress[playlist_id] = {
            "status": "zipping",
            "progress": 95,
            "message": "Creating archive...",
        }

        zip_path = TMP_DIR / f"{safe_name}-{int(time.time() * 1000)}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in files:
                zf.write(file, arcname=file.name)

        shutil.rmtree(download_dir, ignore_errors=True)

        progress[playlist_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Download complete",
            "zipPath": str(zip_path),
            "zipName": f"{safe_name}.zip",
        }
    except Exception as exc:
        shutil.rmtree(download_dir, ignore_errors=True)
        progress[playlist_id] = {
            "status": "error",
            "progress": 0,
            "message": "Download failed",
            "error": str(exc),
        }


def cleanup_stale_files():
    now = time.time()
    for entry in TMP_DIR.iterdir():
        if not entry.name.startswith("playlist-") and not (
            entry.is_file() and entry.suffix == ".zip"
        ):
            continue
        try:
            age = now - entry.stat().st_mtime
            if age > CLEANUP_AGE_SECONDS:
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                else:
                    entry.unlink(missing_ok=True)
        except FileNotFoundError:
            pass


async def periodic_cleanup():
    while True:
        cleanup_stale_files()
        await asyncio.sleep(CLEANUP_AGE_SECONDS)


@app.on_event("startup")
async def on_startup():
    cleanup_stale_files()
    asyncio.create_task(periodic_cleanup())


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/status")
async def status():
    if not await spotdl_available():
        return {"available": False, "message": "spotdl is not installed"}
    proc = await asyncio.create_subprocess_exec(
        "spotdl", "--version",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    return {"available": True, "version": stdout.decode().strip()}


@app.post("/download/{playlist_id}")
async def start_download(playlist_id: str, body: StartDownloadRequest):
    if not await spotdl_available():
        raise HTTPException(status_code=503, detail="spotdl not installed")

    existing = progress.get(playlist_id)
    if existing and existing["status"] in ("downloading", "zipping"):
        return {"success": True, "message": "Download already in progress", "status": existing["status"]}

    asyncio.create_task(run_download(playlist_id, body.playlistUrl, body.playlistName))
    return {"success": True, "message": "Download started", "playlistId": playlist_id}


@app.get("/download/{playlist_id}/progress")
async def get_progress(playlist_id: str):
    return progress.get(playlist_id, {"status": "not_started", "progress": 0, "message": "Download not started"})


@app.get("/download/{playlist_id}/file")
async def get_file(playlist_id: str):
    entry = progress.get(playlist_id)
    if not entry or entry["status"] != "complete":
        raise HTTPException(status_code=404, detail="Download not found or not complete")

    zip_path = Path(entry["zipPath"])
    if not zip_path.exists():
        del progress[playlist_id]
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(zip_path, media_type="application/zip", filename=entry["zipName"])


@app.post("/clean-cache")
async def clean_cache():
    deleted_count = 0
    freed_bytes = 0

    for entry in TMP_DIR.iterdir():
        if entry.is_dir() and entry.name.startswith("playlist-"):
            freed_bytes += sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
            shutil.rmtree(entry, ignore_errors=True)
            deleted_count += 1
        elif entry.is_file() and entry.suffix == ".zip":
            freed_bytes += entry.stat().st_size
            entry.unlink(missing_ok=True)
            deleted_count += 1

    return {
        "deletedCount": deleted_count,
        "freedBytes": freed_bytes,
        "freedMB": f"{freed_bytes / (1024 * 1024):.2f}",
    }
