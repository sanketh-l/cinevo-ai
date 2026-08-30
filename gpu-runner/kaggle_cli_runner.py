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
        f"{SUPABASE_URL}/rest/v1/clips?id=eq.{CLIP_ID}&select=status,video_url",
        headers=HEADERS, timeout=30
    )
    if r.status_code == 200 and r.json():
        return r.json()[0]
    return None


def build_notebook():
    code = f'''
import torch, os, requests, traceback, json
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
        requests.patch(f"{{SUPABASE_URL}}/rest/v1/clips?id=eq.{{CLIP_ID}}",
            headers={{**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}},
            json=data, timeout=30)
    except:
        pass

def update_clip(status, url=None, error=None):
    p = {{"status": status}}
    if url: p["video_url"] = url
    if error: p["camera_settings"] = {{"error": str(error)[:500]}}
    safe_patch(p)

# Always try to report errors even if main logic crashes
try:
    print(f"CUDA: {{torch.cuda.is_available()}}")
    if torch.cuda.is_available():
        print(f"GPU: {{torch.cuda.get_device_name(0)}}")
        print(f"VRAM: {{torch.cuda.get_device_properties(0).total_mem / 1e9:.1f}}GB")
    update_clip("generating")
    from diffusers import WanPipeline
    import imageio, numpy as np
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
    pth = "/kaggle/working/output.mp4"
    imageio.mimsave(pth, vf, fps=16)
    with open(pth,"rb") as fh: data = fh.read()
    print(f"Uploading {{len(data)}} bytes to Supabase...")
    requests.post(f"{{SUPABASE_URL}}/storage/v1/object/videos/{{JOB_ID}}/video.mp4",
        headers={{**HEADERS, "Content-Type": "video/mp4", "x-upsert": "true"}},
        data=data, timeout=120)
    url = f"{{SUPABASE_URL}}/storage/v1/object/public/videos/{{JOB_ID}}/video.mp4"
    update_clip("ready", url)
    print(f"DONE: {{url}}")
except BaseException as e:
    tb = traceback.format_exc()
    print(f"FAILED: {{e}}")
    print(f"TRACEBACK: {{tb}}")
    # Upload full traceback as file
    try:
        requests.post(f"{{SUPABASE_URL}}/storage/v1/object/audio/{{JOB_ID}}_error.txt",
            headers={{**HEADERS, "Content-Type": "text/plain", "x-upsert": "true"}},
            data=tb.encode()[:2000], timeout=30)
    except:
        pass
    update_clip("failed", error=tb[-500:])
'''
    return {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Cinevo Wan 2.1 Inference"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
             "source": ["!pip install -q diffusers transformers accelerate safetensors imageio imageio-ffmpeg torch torchvision"]},
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
        "is_private": "true",
        "enable_gpu": "true",
        "enable_internet": "true",
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
                print("Notebook reported failure")
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
