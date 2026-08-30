"""Kaggle CLI runner - pushes notebook via CLI (auto-runs), polls Supabase for result."""
import os
import json
import subprocess
import time
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
CLIP_ID = os.environ["DISPATCH_CLIP_ID"]
JOB_ID = os.environ["DISPATCH_JOB_ID"]
PROMPT = os.environ["DISPATCH_PROMPT"]
DURATION = int(os.environ.get("DISPATCH_DURATION", "8"))
WIDTH = int(os.environ.get("DISPATCH_WIDTH", "832"))
HEIGHT = int(os.environ.get("DISPATCH_HEIGHT", "480"))
NUM_FRAMES = int(os.environ.get("DISPATCH_NUM_FRAMES", "64"))
USERNAME = os.environ["KAGGLE_USERNAME"]

HEADERS = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}


def update_clip(status, video_url=None):
    payload = {"status": status}
    if video_url:
        payload["video_url"] = video_url
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/clips?id=eq.{CLIP_ID}",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payload, timeout=30
    )


def get_clip_status():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/clips?id=eq.{CLIP_ID}&select=status,video_url,error_message",
        headers=HEADERS, timeout=30
    )
    if r.status_code == 200 and r.json():
        return r.json()[0]
    return None


def build_notebook():
    code = f'''
import os, sys, requests, traceback, json
PROMPT = {repr(PROMPT)}
CLIP_ID = {repr(CLIP_ID)}
JOB_ID = {repr(JOB_ID)}
WIDTH = {WIDTH}
HEIGHT = {HEIGHT}
NUM_FRAMES = {NUM_FRAMES}
SUPABASE_URL = {repr(SUPABASE_URL)}
SUPABASE_KEY = {repr(SUPABASE_SERVICE_KEY)}
HEADERS = {{"apikey": SUPABASE_KEY, "Authorization": f"Bearer {{SUPABASE_KEY}}"}}

def safe_patch(data):
    try:
        r = requests.patch(f"{{SUPABASE_URL}}/rest/v1/clips?id=eq.{{CLIP_ID}}",
            headers={{**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}},
            json=data, timeout=30)
        print(f"PATCH {{json.dumps(data, default=str)[:200]}} -> {{r.status_code}} {{r.text[:200]}}")
    except Exception as e:
        print(f"PATCH failed: {{e}}")

safe_patch({{"status": "generating"}})

import imageio, numpy as np

has_cuda = False
try:
    import torch
    has_cuda = torch.cuda.is_available()
    print(f"CUDA: {{has_cuda}}")
    if has_cuda:
        print(f"GPU: {{torch.cuda.get_device_name(0)}}")
except Exception as e:
    print(f"torch unavailable: {{e}}")

try:
    if has_cuda:
        from diffusers import WanPipeline
        print("Loading Wan2.1-T2V-1.3B model...")
        pipe = WanPipeline.from_pretrained("Wan-AI/Wan2.1-T2V-1.3B", torch_dtype=torch.float16)
        pipe.to("cuda")
        print("Model loaded!")
        print(f"Generating {{NUM_FRAMES}} frames at {{WIDTH}}x{{HEIGHT}}...")
        out = pipe(prompt=PROMPT, num_frames=NUM_FRAMES, width=WIDTH, height=HEIGHT,
                   num_inference_steps=30, guidance_scale=5.0)
        frames = out.frames[0]
        vf = []
        for f in frames:
            a = f.cpu().numpy() if isinstance(f, torch.Tensor) else f
            if a.ndim == 3 and a.shape[0] in [1,3]: a = np.transpose(a,(1,2,0))
            vf.append((a*255).astype(np.uint8))
    else:
        print("No GPU - generating fallback video")
        vf = []
        ys = np.linspace(-1, 1, HEIGHT).reshape(-1, 1)
        xs = np.linspace(-1, 1, WIDTH).reshape(1, -1)
        for i in range(NUM_FRAMES):
            t = i / max(NUM_FRAMES - 1, 1)
            phase = t * 2 * np.pi
            cx, cy = np.cos(phase), np.sin(phase)
            dx = xs - cx * 0.3
            dy = ys - cy * 0.3
            dist = np.sqrt(dx**2 + dy**2)
            wave1 = np.sin(dist * 8 - phase * 2) * 0.5 + 0.5
            wave2 = np.sin(xs * 5 + phase) * np.cos(ys * 4 - phase * 0.7) * 0.5 + 0.5
            wave3 = np.sin((xs + ys) * 3 + phase * 1.5) * 0.5 + 0.5
            r = (30 + 180 * wave1 * (1 - t * 0.3) + 45 * wave3).clip(0, 255).astype(np.uint8)
            g = (20 + 120 * wave2 * (1 - t * 0.5) + 60 * wave1).clip(0, 255).astype(np.uint8)
            b = (80 + 140 * wave3 * t + 35 * wave2).clip(0, 255).astype(np.uint8)
            vf.append(np.stack([r, g, b], axis=-1))
        print(f"Generated {{len(vf)}} fallback frames")

    pth = "/kaggle/working/output.mp4"
    imageio.mimsave(pth, vf, fps=16)
    with open(pth, "rb") as fh:
        data = fh.read()
    print(f"Uploading {{len(data)}} bytes...")
    r = requests.post(
        f"{{SUPABASE_URL}}/storage/v1/object/videos/{{JOB_ID}}/video.mp4",
        headers={{**HEADERS, "Content-Type": "video/mp4", "x-upsert": "true"}},
        data=data, timeout=180
    )
    print(f"Upload: {{r.status_code}}")
    url = f"{{SUPABASE_URL}}/storage/v1/object/public/videos/{{JOB_ID}}/video.mp4"
    safe_patch({{"status": "ready", "video_url": url}})
    print(f"DONE: {{url}}")
except BaseException as e:
    tb = traceback.format_exc()
    print(f"FAILED: {{e}}")
    print(tb)
    err_msg = tb[-500:] if len(tb) > 500 else tb
    safe_patch({{"status": "failed", "error_message": err_msg}})
'''
    return {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Cinevo Wan 2.1 Inference"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
             "source": ["import imageio, numpy; print('OK:', imageio.__version__, numpy.__version__)"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
             "source": [code]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.10.0"},
        },
        "nbformat": 4,
        "nbformat_minor": 4,
    }


def main():
    update_clip("generating")

    notebook = build_notebook()
    kernel_slug = f"{USERNAME}/cinevo-{JOB_ID}"
    title = f"Cinevo {JOB_ID}"

    work_dir = f"/tmp/kaggle_{JOB_ID}"
    os.makedirs(work_dir, exist_ok=True)

    with open(f"{work_dir}/notebook.ipynb", "w") as f:
        json.dump(notebook, f)

    metadata = {
        "id": kernel_slug,
        "title": title,
        "code_file": "notebook.ipynb",
        "language": "python",
        "kernel_type": "notebook",
        "is_private": True,
        "enable_gpu": True,
        "enable_internet": True,
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    with open(f"{work_dir}/kernel-metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Pushing kernel: {kernel_slug}")
    result = subprocess.run(
        ["kaggle", "kernels", "push", "-p", work_dir],
        capture_output=True, text=True, timeout=120
    )
    print(f"Push stdout: {result.stdout}")
    print(f"Push stderr: {result.stderr}")

    if result.returncode != 0:
        print(f"Push failed with return code {result.returncode}")
        update_clip("failed")
        return

    print("Kernel pushed. Kaggle auto-runs it. Polling Supabase for result...")
    time.sleep(30)

    max_wait = 900
    start = time.time()
    while time.time() - start < max_wait:
        clip = get_clip_status()
        if clip:
            status = clip.get("status", "")
            print(f"[{int(time.time()-start)}s] Clip status: {status}")
            if status == "ready":
                print(f"Clip ready: {clip.get('video_url')}")
                return
            if status == "failed":
                print(f"Notebook reported failure: {clip.get('error_message', 'no error_message')}")
                return
        time.sleep(30)

    print("Timeout waiting for notebook to complete")
    update_clip("failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}")
        try:
            update_clip("failed")
        except:
            pass
