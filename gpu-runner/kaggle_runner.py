"""Kaggle notebook runner for Cinevo.
Pushes a Wan 2.1 inference notebook to Kaggle, runs it on GPU,
and the notebook uploads the result directly to Supabase."""

import os
import json
import time
import sys
import base64
import requests


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
KAGGLE_USERNAME = os.environ.get("KAGGLE_USERNAME", "")
KAGGLE_KEY = os.environ.get("KAGGLE_KEY", "")


def make_notebook(prompt, clip_id, job_id, reference_image_url=None,
                  width=832, height=480, num_frames=81, duration_sec=8):
    """Build a Kaggle notebook that runs Wan 2.1 inference and uploads to Supabase."""

    source_code = f'''
import torch
import os
import json
import tempfile
import requests

# Receive params from environment
PROMPT = os.environ.get("PROMPT", "{prompt}")
CLIP_ID = os.environ.get("CLIP_ID", "{clip_id}")
JOB_ID = os.environ.get("JOB_ID", "{job_id}")
REF_IMAGE = os.environ.get("REF_IMAGE", "{reference_image_url or ''}")
WIDTH = int(os.environ.get("WIDTH", {width}))
HEIGHT = int(os.environ.get("HEIGHT", {height}))
NUM_FRAMES = int(os.environ.get("NUM_FRAMES", {num_frames}))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "{SUPABASE_URL}")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "{SUPABASE_SERVICE_KEY}")

HEADERS = {{"apikey": SUPABASE_KEY, "Authorization": f"Bearer {{SUPABASE_KEY}}"}}

def update_clip(status, video_url=None):
    payload = {{"status": status}}
    if video_url:
        payload["video_url"] = video_url
    requests.patch(
        f"{{SUPABASE_URL}}/rest/v1/clips?id=eq.{{CLIP_ID}}",
        headers={{**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}},
        json=payload, timeout=30
    )

print(f"CUDA available: {{torch.cuda.is_available()}}")
if torch.cuda.is_available():
    print(f"GPU: {{torch.cuda.get_device_name(0)}}")
    print(f"Memory: {{torch.cuda.get_device_properties(0).total_mem / 1e9:.1f}} GB")

update_clip("generating")

try:
    from diffusers import WanPipeline
    from diffusers.utils import export_to_video
    import imageio
    import numpy as np

    model_id = "Wan-AI/Wan2.1-T2V-14B-FP8"
    print(f"Loading {{model_id}}...")
    pipe = WanPipeline.from_pretrained(model_id, torch_dtype=torch.float16)
    pipe.to("cuda")
    print("Model loaded!")

    output = pipe(
        prompt=PROMPT,
        num_frames=NUM_FRAMES,
        width=WIDTH,
        height=HEIGHT,
        num_inference_steps=50,
        guidance_scale=5.0,
    )

    frames = output.frames[0]
    video_frames = []
    for frame in frames:
        if isinstance(frame, torch.Tensor):
            frame = frame.cpu().numpy()
        if frame.ndim == 3 and frame.shape[0] in [1, 3]:
            frame = np.transpose(frame, (1, 2, 0))
        frame = (frame * 255).astype(np.uint8)
        video_frames.append(frame)

    out_path = "/kaggle/working/output.mp4"
    imageio.mimsave(out_path, video_frames, fps=16)
    print(f"Video saved to {{out_path}}")

    with open(out_path, "rb") as f:
        video_bytes = f.read()

    upload_url = f"{{SUPABASE_URL}}/storage/v1/object/videos/{{JOB_ID}}/video.mp4"
    resp = requests.post(
        upload_url,
        headers={{**HEADERS, "Content-Type": "video/mp4", "x-upsert": "true"}},
        data=video_bytes,
        timeout=120
    )
    resp.raise_for_status()
    public_url = f"{{SUPABASE_URL}}/storage/v1/object/public/videos/{{JOB_ID}}/video.mp4"
    update_clip("ready", video_url=public_url)
    print(f"DONE: {{public_url}}")

except Exception as e:
    print(f"FAILED: {{e}}")
    update_clip("failed")
'''

    cells = [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": ["# Cinevo - Wan 2.1 Video Generation\n", "Auto-generated notebook for video inference."]
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": ["!pip install -q diffusers transformers accelerate safetensors imageio imageio-ffmpeg torch torchvision"]
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [source_code]
        },
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "kaggle": {
                "accelerator": "GPU",
                "dataSources": [],
                "isGpuEnabled": True,
                "isInternetEnabled": True,
                "language": "python",
            },
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {
                "name": "python",
                "version": "3.10.0",
            },
        },
        "nbformat": 4,
        "nbformat_minor": 4,
    }
    return notebook


def push_notebook(notebook, kernel_slug):
    """Push notebook to Kaggle via API."""
    source = json.dumps(notebook)
    payload = {
        "id": kernel_slug,
        "source": {
            "type": "notebook",
            "language": "python",
            "source": source,
        },
        "metadata": {
            "enableGpu": True,
            "enableInternet": True,
        },
    }
    resp = requests.put(
        f"https://www.kaggle.com/api/v1/kernels/push",
        json=payload,
        auth=(KAGGLE_USERNAME, KAGGLE_KEY),
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Kaggle push failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def start_run(kernel_slug):
    """Start a notebook run on Kaggle."""
    resp = requests.post(
        f"https://www.kaggle.com/api/v1/kernels/runs",
        json={"kernelSlug": kernel_slug},
        auth=(KAGGLE_USERNAME, KAGGLE_KEY),
        timeout=30,
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Kaggle run start failed: {resp.status_code} {resp.text[:300]}")
    return True


def poll_run(kernel_slug, timeout=600):
    """Poll until notebook finishes. Returns final status."""
    start = time.time()
    while time.time() - start < timeout:
        resp = requests.get(
            f"https://www.kaggle.com/api/v1/kernels/status/{kernel_slug}",
            auth=(KAGGLE_USERNAME, KAGGLE_KEY),
            timeout=30,
        )
        if resp.status_code != 200:
            time.sleep(10)
            continue
        status = resp.json()
        state = status.get("status", "unknown")
        print(f"[kaggle] status={state}")
        if state in ("complete", "error", "cancelled"):
            return state
        time.sleep(15)
    return "timeout"


def run_wan_inference(prompt, clip_id, job_id, reference_image_url=None,
                      width=832, height=480, num_frames=81, duration_sec=8):
    """Full pipeline: build notebook, push, run, wait."""
    kernel_slug = f"{KAGGLE_USERNAME}/cinevo-{job_id}"

    notebook = make_notebook(
        prompt=prompt,
        clip_id=clip_id,
        job_id=job_id,
        reference_image_url=reference_image_url,
        width=width,
        height=height,
        num_frames=num_frames,
        duration_sec=duration_sec,
    )

    # Set env vars for the notebook
    os.environ["PROMPT"] = prompt
    os.environ["CLIP_ID"] = clip_id
    os.environ["JOB_ID"] = job_id
    os.environ["REF_IMAGE"] = reference_image_url or ""
    os.environ["WIDTH"] = str(width)
    os.environ["HEIGHT"] = str(height)
    os.environ["NUM_FRAMES"] = str(num_frames)

    print(f"[kaggle] Pushing notebook: {kernel_slug}")
    push_notebook(notebook, kernel_slug)

    print(f"[kaggle] Starting run...")
    start_run(kernel_slug)

    print(f"[kaggle] Polling for completion...")
    final = poll_run(kernel_slug, timeout=600)

    if final == "complete":
        print(f"[kaggle] Run complete for {job_id}")
        return True
    else:
        print(f"[kaggle] Run ended with status: {final}")
        return False


if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "A cat walking in a garden"
    clip_id = sys.argv[2] if len(sys.argv) > 2 else "test-clip"
    job_id = sys.argv[3] if len(sys.argv) > 3 else "job_test"
    run_wan_inference(prompt, clip_id, job_id)
