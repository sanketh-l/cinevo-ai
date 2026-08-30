import os
import subprocess
from pathlib import Path

import requests


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
PROJECT_ID = os.environ["DISPATCH_PROJECT_ID"]
EXPORT_ID = os.environ["DISPATCH_EXPORT_ID"]


HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
}


def patch_export(status, final_video_url=None):
    payload = {"status": status}
    if final_video_url:
        payload["final_video_url"] = final_video_url
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/exports?id=eq.{EXPORT_ID}",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()


def fetch_clips():
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/clips?project_id=eq.{PROJECT_ID}&status=eq.ready&order=position.asc",
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    return [clip for clip in response.json() if clip.get("video_url")]


def download(url, path):
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    Path(path).write_bytes(response.content)


def upload(path):
    name = f"{EXPORT_ID}/final.mp4"
    with open(path, "rb") as file:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/videos/{name}",
            headers={**HEADERS, "Content-Type": "video/mp4", "x-upsert": "true"},
            data=file,
            timeout=120,
        )
    response.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/videos/{name}"


def main():
    patch_export("stitching")
    clips = fetch_clips()
    if not clips:
        raise RuntimeError("No ready clips with video_url found for export")

    normalized = []
    for index, clip in enumerate(clips):
        raw = f"raw_{index}.mp4"
        norm = f"clip_{index}.mp4"
        download(clip["video_url"], raw)
        subprocess.run([
            "ffmpeg", "-y", "-i", raw,
            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-an", norm,
        ], check=True)
        normalized.append(norm)

    Path("concat.txt").write_text("".join(f"file '{Path(path).resolve()}'\n" for path in normalized))
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt",
        "-c", "copy", "final.mp4",
    ], check=True)

    final_url = upload("final.mp4")
    patch_export("done", final_video_url=final_url)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            patch_export("failed")
        finally:
            raise
