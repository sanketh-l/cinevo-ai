import os
import subprocess
import urllib.parse
from pathlib import Path

import requests


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
CLIP_ID = os.environ["DISPATCH_CLIP_ID"]
JOB_ID = os.environ["DISPATCH_JOB_ID"]
PROMPT = os.environ.get("DISPATCH_PROMPT", "cinematic scene")
DURATION = max(1, int(float(os.environ.get("DISPATCH_DURATION", "8"))))
ASPECT_RATIO = os.environ.get("DISPATCH_ASPECT_RATIO", "16:9")


def update_clip(status, video_url=None, thumbnail_url=None):
    payload = {"status": status}
    if video_url:
        payload["video_url"] = video_url
    if thumbnail_url:
        payload["thumbnail_url"] = thumbnail_url
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/clips?id=eq.{CLIP_ID}",
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json=payload,
        timeout=30,
    )
    response.raise_for_status()


def upload(path, content_type):
    name = f"{JOB_ID}/{Path(path).name}"
    with open(path, "rb") as file:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/videos/{name}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=file,
            timeout=120,
        )
    response.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/videos/{name}"


def main():
    update_clip("generating")

    width, height = (720, 1280) if ASPECT_RATIO == "9:16" else (1024, 1024) if ASPECT_RATIO == "1:1" else (1280, 720)
    encoded = urllib.parse.quote(PROMPT)
    image_url = f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&model=flux&nologo=true&seed={abs(hash(JOB_ID)) % 1000000}"

    image_path = "frame.jpg"
    video_path = "video.mp4"
    thumb_path = "thumb.jpg"

    image = requests.get(image_url, timeout=120)
    image.raise_for_status()
    Path(image_path).write_bytes(image.content)

    fps = 24
    frames = DURATION * fps
    vf = f"scale={width * 2}:{height * 2},zoompan=z='min(zoom+0.0015,1.18)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps={fps},format=yuv420p"
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", image_path,
        "-vf", vf, "-t", str(DURATION), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", video_path,
    ], check=True)
    subprocess.run(["ffmpeg", "-y", "-i", video_path, "-frames:v", "1", thumb_path], check=True)

    video_url = upload(video_path, "video/mp4")
    thumbnail_url = upload(thumb_path, "image/jpeg")
    update_clip("ready", video_url=video_url, thumbnail_url=thumbnail_url)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            update_clip("failed")
        finally:
            raise
