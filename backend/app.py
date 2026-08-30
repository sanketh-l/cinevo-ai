import os
import uuid
import json
import time
import urllib.parse
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client
import httpx

app = Flask(__name__)
CORS(app, origins=["*"])

@app.errorhandler(Exception)
def handle_error(error):
    message = str(error)
    return jsonify({"error": message or "Internal server error"}), 500

_sb = None

def get_sb():
    global _sb
    if _sb is None:
        _sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    return _sb

def get_user_id():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            user = get_sb().auth.get_user(auth.replace("Bearer ", ""))
            if user and user.user:
                return user.user.id
        except Exception:
            pass
    return "anonymous"

def storage_upload(bucket, file_name, content, content_type):
    safe_name = file_name.replace("\\", "/").lstrip("/")
    response = httpx.post(
        f"{os.environ['SUPABASE_URL'].rstrip('/')}/storage/v1/object/{bucket}/{safe_name}",
        headers={
            "apikey": os.environ["SUPABASE_SERVICE_KEY"],
            "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=content,
        timeout=60,
    )
    response.raise_for_status()
    return f"{os.environ['SUPABASE_URL'].rstrip('/')}/storage/v1/object/public/{bucket}/{safe_name}"

# ── Health ──────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "cinevo"})

@app.route("/api/debug/kaggle")
def debug_kaggle():
    """Test Kaggle API connection and return details."""
    result = {
        "username": kaggle.username[:4] + "..." if kaggle.username else "NOT SET",
        "key_present": bool(kaggle.key),
        "available": kaggle.available,
        "username_full_length": len(kaggle.username) if kaggle.username else 0,
        "key_length": len(kaggle.key) if kaggle.key else 0,
    }
    if kaggle.available:
        try:
            # Test list
            resp = httpx.get(
                "https://www.kaggle.com/api/v1/kernels/list",
                auth=kaggle._auth(),
                timeout=15,
            )
            result["list_status"] = resp.status_code

            # Test push with minimal notebook
            import tempfile
            test_nb = json.dumps({
                "cells": [{"cell_type": "code", "source": ["print('test')"], "metadata": {}, "outputs": []}],
                "metadata": {},
                "nbformat": 4, "nbformat_minor": 4,
            })
            push_resp = httpx.post(
                "https://www.kaggle.com/api/v1/kernels/push",
                json={
                    "slug": f"{kaggle.username}/cinevo-health-check",
                    "newTitle": "Cinevo Health Check",
                    "text": test_nb,
                    "language": "python",
                    "kernelType": "notebook",
                    "enableGpu": False,
                    "enableInternet": False,
                    "isPrivate": True,
                },
                auth=kaggle._auth(),
                timeout=30,
            )
            result["push_status"] = push_resp.status_code
            push_data = push_resp.json()
            result["push_error"] = push_data.get("error", "")
            result["push_has_error"] = push_data.get("hasError", False)
            if not push_data.get("hasError"):
                result["push_kernel_id"] = push_data.get("kernelId")
        except Exception as e:
            result["error"] = str(e)
    return jsonify(result)

@app.route("/api/accounts/status")
def account_status():
    kaggle_accounts = len([k for k in ("KAGGLE_ACCOUNT_1_KEY", "KAGGLE_ACCOUNT_2_KEY") if os.environ.get(k)])
    return jsonify({
        "supabase": {"connected": bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"))},
        "github_actions": {"connected": bool(os.environ.get("GITHUB_TOKEN")), "workflow": "generate-video.yml"},
        "kaggle": {
            "connected_accounts": kaggle_accounts,
            "available": kaggle.available,
            "mode": "wan_2_1_14b_real_inference" if kaggle.available else "pending_credentials",
        },
        "huggingface": {"connected": bool(os.environ.get("HF_TOKEN")), "mode": "pending_zerogpu_space"},
        "storage": {"video_bucket": "videos", "image_bucket": "images", "audio_bucket": "audio"},
    })

# ── Projects ────────────────────────────────────────────
@app.route("/api/projects", methods=["GET"])
def list_projects():
    uid = get_user_id()
    result = get_sb().table("projects").select("*").eq("user_id", uid).order("created_at", desc=True).execute()
    return jsonify(result.data)

@app.route("/api/projects", methods=["POST"])
def create_project():
    uid = get_user_id()
    data = request.json or {}
    project = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "name": data.get("name", "Untitled Project")[:100],
        "aspect_ratio": data.get("aspect_ratio", "16:9"),
        "status": "draft",
    }
    result = get_sb().table("projects").insert(project).execute()
    return jsonify(result.data[0] if result.data else project)

@app.route("/api/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    result = get_sb().table("projects").select("*").eq("id", project_id).execute()
    if not result.data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(result.data[0])

@app.route("/api/projects/<project_id>", methods=["PUT"])
def update_project(project_id):
    data = request.json or {}
    allowed = {k: v for k, v in data.items() if k in ("name", "aspect_ratio", "status")}
    if allowed:
        get_sb().table("projects").update(allowed).eq("id", project_id).execute()
    return jsonify({"status": "updated"})

@app.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id):
    get_sb().table("clips").delete().eq("project_id", project_id).execute()
    get_sb().table("ingredients").delete().eq("project_id", project_id).execute()
    get_sb().table("projects").delete().eq("id", project_id).execute()
    return jsonify({"status": "deleted"})

# ── Ingredients ─────────────────────────────────────────
@app.route("/api/ingredients", methods=["GET"])
def list_ingredients():
    uid = get_user_id()
    project_id = request.args.get("project_id")
    query = get_sb().table("ingredients").select("*").eq("user_id", uid)
    if project_id:
        query = query.eq("project_id", project_id)
    result = query.order("created_at", desc=True).execute()
    return jsonify(result.data)

@app.route("/api/ingredients", methods=["POST"])
def create_ingredient():
    uid = get_user_id()
    data = request.json or {}
    ingredient = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "name": data.get("name", "Untitled")[:100],
        "type": data.get("type", "character"),
        "image_url": data.get("image_url", ""),
        "prompt": data.get("prompt", ""),
        "locked": data.get("locked", False),
        "project_id": data.get("project_id"),
        "collection_id": data.get("collection_id"),
    }
    result = get_sb().table("ingredients").insert(ingredient).execute()
    return jsonify(result.data[0] if result.data else ingredient)

@app.route("/api/ingredients/<ingredient_id>", methods=["PUT"])
def update_ingredient(ingredient_id):
    data = request.json or {}
    allowed = {k: v for k, v in data.items() if k in ("name", "type", "locked", "collection_id")}
    if allowed:
        get_sb().table("ingredients").update(allowed).eq("id", ingredient_id).execute()
    return jsonify({"status": "updated"})

@app.route("/api/ingredients/<ingredient_id>", methods=["DELETE"])
def delete_ingredient(ingredient_id):
    get_sb().table("ingredients").delete().eq("id", ingredient_id).execute()
    return jsonify({"status": "deleted"})

@app.route("/api/ingredients/generate", methods=["POST"])
def generate_ingredient():
    data = request.json or {}
    prompt = data.get("prompt", "")
    w = data.get("width", 1024)
    h = data.get("height", 1024)
    seed = data.get("seed", int(time.time()))
    encoded_prompt = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&model=flux&nologo=true&seed={seed}"
    return jsonify({"image_url": url, "prompt": prompt})

@app.route("/api/ingredients/upload", methods=["POST"])
def upload_ingredient_image():
    if "file" not in request.files:
        return jsonify({"error": "file is required"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "filename is required"}), 400

    suffix = Path(file.filename).suffix.lower() or ".jpg"
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        return jsonify({"error": "Only jpg, png, and webp are supported"}), 400

    content = file.read()
    if len(content) > 8 * 1024 * 1024:
        return jsonify({"error": "Max upload size is 8MB"}), 400

    content_type = file.content_type or "application/octet-stream"
    name = f"ingredients/{uuid.uuid4().hex}{suffix}"
    url = storage_upload("images", name, content, content_type)
    return jsonify({"image_url": url})

# ── Collections ─────────────────────────────────────────
@app.route("/api/collections", methods=["GET"])
def list_collections():
    uid = get_user_id()
    result = get_sb().table("collections").select("*").eq("user_id", uid).execute()
    return jsonify(result.data)

@app.route("/api/collections", methods=["POST"])
def create_collection():
    uid = get_user_id()
    data = request.json or {}
    collection = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "name": data.get("name", "Untitled Collection")[:100],
        "description": data.get("description", ""),
    }
    result = get_sb().table("collections").insert(collection).execute()
    return jsonify(result.data[0] if result.data else collection)

@app.route("/api/collections/<collection_id>", methods=["DELETE"])
def delete_collection(collection_id):
    get_sb().table("collections").delete().eq("id", collection_id).execute()
    return jsonify({"status": "deleted"})

# ── Generate Video ──────────────────────────────────────
@app.route("/api/generate/video", methods=["POST"])
def generate_video():
    uid = get_user_id()
    data = request.json or {}
    clip_id = str(uuid.uuid4())
    job_id = f"job_{clip_id[:8]}"
    clip = {
        "id": clip_id,
        "project_id": data.get("project_id", ""),
        "position": data.get("position", 0),
        "prompt": data.get("prompt", ""),
        "ingredients_used": data.get("ingredient_ids", []),
        "camera_settings": data.get("camera_settings", {}),
        "duration_sec": data.get("duration_sec", 8),
        "status": "queued",
        "job_id": job_id,
    }
    get_sb().table("clips").insert(clip).execute()

    reference_images = []
    ingredient_ids = data.get("ingredient_ids", []) or []
    if ingredient_ids:
        refs = get_sb().table("ingredients").select("id,image_url,name").in_("id", ingredient_ids[:3]).execute()
        reference_images = refs.data or []

    # Try Kaggle first (real Wan 2.1), fall back to GitHub Actions (FFmpeg fallback)
    runner_used = "github_actions"
    print(f"[kaggle] available={kaggle.available}, username={repr(kaggle.username[:4] if kaggle.username else '')}")
    if kaggle.available:
        try:
            ref_url = reference_images[0]["image_url"] if reference_images else None
            # Resolve resolution from aspect ratio
            ar = data.get("aspect_ratio", "16:9")
            if ar == "9:16":
                w, h = 480, 832
            elif ar == "1:1":
                w, h = 640, 640
            else:
                w, h = 832, 480
            num_frames = max(1, int(data.get("duration_sec", 8) * 16))

            # Dispatch Kaggle workflow via GitHub Actions
            token = os.environ.get("GITHUB_TOKEN", "")
            if token:
                dispatch_payload = {
                    "clip_id": clip_id,
                    "job_id": job_id,
                    "prompt": data.get("prompt", ""),
                    "duration_sec": str(data.get("duration_sec", 8)),
                    "width": str(w),
                    "height": str(h),
                    "num_frames": str(num_frames),
                }
                gh_resp = httpx.post(
                    "https://api.github.com/repos/sanketh-l/cinevo-ai/dispatches",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json"},
                    json={"event_type": "kaggle_generate_video", "client_payload": dispatch_payload},
                    timeout=10,
                )
                print(f"[kaggle] dispatch: {gh_resp.status_code}")
                if gh_resp.status_code in (200, 204):
                    runner_used = "kaggle"
                else:
                    print(f"[kaggle] dispatch failed: {gh_resp.text[:200]}")
        except Exception as e:
            print(f"[kaggle] Failed, falling back to GH Actions: {e}")
            runner_used = "github_actions_fallback"

    if runner_used != "kaggle":
        try:
            trigger_github_action(data, job_id, clip_id, reference_images)
        except Exception:
            pass

    return jsonify({"job_id": job_id, "clip_id": clip_id, "status": "queued", "runner": runner_used})

@app.route("/api/generate/image", methods=["POST"])
def generate_image():
    data = request.json or {}
    prompt = data.get("prompt", "")
    w = data.get("width", 1280)
    h = data.get("height", 720)
    seed = data.get("seed", int(time.time()))
    encoded_prompt = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&model=flux&nologo=true&seed={seed}"

    project_id = data.get("project_id")
    if project_id:
        clip_id = str(uuid.uuid4())
        clip = {
            "id": clip_id,
            "project_id": project_id,
            "position": data.get("position", 0),
            "prompt": prompt,
            "ingredients_used": data.get("ingredient_ids", []),
            "camera_settings": data.get("camera_settings", {}),
            "video_url": url,
            "thumbnail_url": url,
            "duration_sec": 0,
            "status": "ready",
            "job_id": None,
        }
        result = get_sb().table("clips").insert(clip).execute()
        return jsonify({"image_url": url, "clip": result.data[0] if result.data else clip})

    return jsonify({"image_url": url})

@app.route("/api/generate/<job_id>/status", methods=["GET"])
def job_status(job_id):
    result = get_sb().table("clips").select("*").eq("job_id", job_id).execute()
    if not result.data:
        return jsonify({"error": "Job not found"}), 404
    clip = result.data[0]
    return jsonify({"status": clip["status"], "video_url": clip.get("video_url"), "clip_id": clip["id"]})

# ── Clips ───────────────────────────────────────────────
@app.route("/api/projects/<project_id>/clips", methods=["GET"])
def list_clips(project_id):
    result = get_sb().table("clips").select("*").eq("project_id", project_id).order("position").execute()
    return jsonify(result.data)

@app.route("/api/projects/<project_id>/clips/reorder", methods=["POST"])
def reorder_clips(project_id):
    data = request.json or {}
    for i, clip_id in enumerate(data.get("clip_ids", [])):
        get_sb().table("clips").update({"position": i}).eq("id", clip_id).execute()
    return jsonify({"status": "reordered"})

@app.route("/api/projects/<project_id>/clips/<clip_id>", methods=["PUT"])
def update_clip(project_id, clip_id):
    data = request.json or {}
    allowed = {k: v for k, v in data.items() if k in ("position", "prompt", "duration_sec", "camera_settings", "status", "video_url", "thumbnail_url")}
    if "camera_settings" in allowed and isinstance(allowed["camera_settings"], dict):
        allowed["camera_settings"] = json.dumps(allowed["camera_settings"])
    if allowed:
        get_sb().table("clips").update(allowed).eq("id", clip_id).execute()
    return jsonify({"status": "updated"})

@app.route("/api/projects/<project_id>/clips/<clip_id>", methods=["DELETE"])
def delete_clip(project_id, clip_id):
    get_sb().table("voiceovers").delete().eq("clip_id", clip_id).execute()
    get_sb().table("clips").delete().eq("id", clip_id).execute()
    return jsonify({"status": "deleted"})

# ── Voiceover ───────────────────────────────────────────
@app.route("/api/generate/voiceover", methods=["POST"])
def generate_voiceover():
    data = request.json or {}
    text = data.get("text", "")
    voice = data.get("voice", "en-US-AriaNeural")
    clip_id = data.get("clip_id")

    if not text.strip():
        return jsonify({"error": "text is required"}), 400
    if not clip_id:
        return jsonify({"error": "clip_id is required"}), 400

    try:
        from gtts import gTTS
        import tempfile

        output_path = os.path.join(tempfile.gettempdir(), f"vo_{uuid.uuid4().hex[:8]}.mp3")

        # Map voice selection to gTTS language codes
        lang_map = {
            "en-US-AriaNeural": "en", "en-US-GuyNeural": "en", "en-US-JennyNeural": "en",
            "en-GB-SoniaNeural": "en-gb", "en-GB-RyanNeural": "en-gb",
            "en-IN-NeerjaNeural": "en", "en-IN-PrabhatNeural": "en",
            "ja-JP-NanamiNeural": "ja", "ko-KR-SunHiNeural": "ko",
            "zh-CN-XiaoxiaoNeural": "zh-cn", "es-ES-ElviraNeural": "es",
            "fr-FR-DeniseNeural": "fr", "de-DE-KatjaNeural": "de",
            "pt-BR-FranciscaNeural": "pt-br", "ar-SA-ZariyahNeural": "ar",
        }
        lang = lang_map.get(voice, "en")
        tts = gTTS(text=text, lang=lang)
        tts.save(output_path)

        with open(output_path, "rb") as audio_file:
            audio_url = storage_upload("audio", f"voiceovers/{clip_id}/{uuid.uuid4().hex}.mp3", audio_file.read(), "audio/mpeg")

        vo_id = str(uuid.uuid4())
        vo = {
            "id": vo_id,
            "clip_id": clip_id,
            "text": text,
            "voice": voice,
            "audio_url": audio_url,
        }
        get_sb().table("voiceovers").insert(vo).execute()

        if os.path.exists(output_path):
            os.remove(output_path)

        return jsonify({"voiceover_id": vo_id, "audio_url": audio_url, "status": "generated"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/generate/voices", methods=["GET"])
def list_voices():
    voices = [
        {"id": "en-US-AriaNeural", "name": "Aria (Female, US)", "language": "en-US"},
        {"id": "en-US-GuyNeural", "name": "Guy (Male, US)", "language": "en-US"},
        {"id": "en-US-JennyNeural", "name": "Jenny (Female, US)", "language": "en-US"},
        {"id": "en-GB-SoniaNeural", "name": "Sonia (Female, UK)", "language": "en-GB"},
        {"id": "en-GB-RyanNeural", "name": "Ryan (Male, UK)", "language": "en-GB"},
        {"id": "en-IN-NeerjaNeural", "name": "Neerja (Female, IN)", "language": "en-IN"},
        {"id": "en-IN-PrabhatNeural", "name": "Prabhat (Male, IN)", "language": "en-IN"},
        {"id": "ja-JP-NanamiNeural", "name": "Nanami (Female, JP)", "language": "ja-JP"},
        {"id": "ko-KR-SunHiNeural", "name": "SunHi (Female, KR)", "language": "ko-KR"},
        {"id": "zh-CN-XiaoxiaoNeural", "name": "Xiaoxiao (Female, CN)", "language": "zh-CN"},
        {"id": "es-ES-ElviraNeural", "name": "Elvira (Female, ES)", "language": "es-ES"},
        {"id": "fr-FR-DeniseNeural", "name": "Denise (Female, FR)", "language": "fr-FR"},
        {"id": "de-DE-KatjaNeural", "name": "Katja (Female, DE)", "language": "de-DE"},
        {"id": "pt-BR-FranciscaNeural", "name": "Francisca (Female, BR)", "language": "pt-BR"},
        {"id": "ar-SA-ZariyahNeural", "name": "Zariyah (Female, SA)", "language": "ar-SA"},
    ]
    return jsonify(voices)

@app.route("/api/clips/<clip_id>/voiceovers", methods=["GET"])
def list_clip_voiceovers(clip_id):
    result = get_sb().table("voiceovers").select("*").eq("clip_id", clip_id).order("created_at", desc=True).execute()
    return jsonify(result.data)

# ── Export ──────────────────────────────────────────────
@app.route("/api/export/<project_id>/start", methods=["POST"])
def start_export(project_id):
    export_id = str(uuid.uuid4())
    export = {"id": export_id, "project_id": project_id, "status": "queued"}
    get_sb().table("exports").insert(export).execute()
    try:
        trigger_export_action(project_id, export_id)
    except Exception:
        pass
    return jsonify({"export_id": export_id, "status": "queued"})

@app.route("/api/export/<project_id>/status", methods=["GET"])
def export_status(project_id):
    result = get_sb().table("exports").select("*").eq("project_id", project_id).order("created_at", desc=True).limit(1).execute()
    if not result.data:
        return jsonify({"status": "none"})
    return jsonify(result.data[0])

# ── Kaggle Service ─────────────────────────────────────
class KaggleRunner:
    def __init__(self):
        self.username = os.environ.get("KAGGLE_ACCOUNT_1_USERNAME", "")
        self.key = os.environ.get("KAGGLE_ACCOUNT_1_KEY", "")
        self.username2 = os.environ.get("KAGGLE_ACCOUNT_2_USERNAME", "")
        self.key2 = os.environ.get("KAGGLE_ACCOUNT_2_KEY", "")

    @property
    def available(self):
        return bool(self.username and self.key)

    def _auth(self, which=1):
        if which == 2 and self.username2 and self.key2:
            return (self.username2, self.key2)
        return (self.username, self.key)

    def push_and_run(self, prompt, clip_id, job_id, reference_image_url=None,
                     width=832, height=480, num_frames=81):
        """Push a Wan inference notebook to Kaggle and start it."""
        notebook_source = self._build_notebook(prompt, clip_id, job_id,
                                                reference_image_url, width, height, num_frames)
        kernel_slug = f"{self.username}/cinevo-{job_id}"

        payload = {
            "slug": kernel_slug,
            "newTitle": f"Cinevo - {prompt[:40]}",
            "text": notebook_source,
            "language": "python",
            "kernelType": "notebook",
            "enableGpu": True,
            "enableInternet": True,
            "isPrivate": True,
        }
        resp = httpx.post(
            "https://www.kaggle.com/api/v1/kernels/push",
            json=payload,
            auth=self._auth(),
            timeout=60,
        )
        print(f"[kaggle] push response: {resp.status_code} {resp.text[:300]}")
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Kaggle push: {resp.status_code} {resp.text[:200]}")

        resp_data = resp.json()
        if resp_data.get("hasError"):
            raise RuntimeError(f"Kaggle push error: {resp_data.get('error')}")

        return {"kernel_slug": kernel_slug, "kernel_id": resp_data.get("kernelId"), "status": "triggered"}

    def check_status(self, kernel_slug):
        resp = httpx.get(
            f"https://www.kaggle.com/api/v1/kernels/status/{kernel_slug}",
            auth=self._auth(),
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.json()
        return {"status": "unknown"}

    def _build_notebook(self, prompt, clip_id, job_id, ref_image_url, width, height, num_frames):
        sb_url = os.environ["SUPABASE_URL"].rstrip("/")
        sb_key = os.environ["SUPABASE_SERVICE_KEY"]
        code = f'''
import torch, os, json, requests
PROMPT = {repr(prompt)}
CLIP_ID = {repr(clip_id)}
JOB_ID = {repr(job_id)}
REF_IMAGE = {repr(ref_image_url or "")}
WIDTH = {width}
HEIGHT = {height}
NUM_FRAMES = {num_frames}
SUPABASE_URL = {repr(sb_url)}
SUPABASE_KEY = {repr(sb_key)}
HEADERS = {{"apikey": SUPABASE_KEY, "Authorization": f"Bearer {{SUPABASE_KEY}}"}}

def update_clip(status, url=None):
    p = {{"status": status}}
    if url: p["video_url"] = url
    requests.patch(f"{{SUPABASE_URL}}/rest/v1/clips?id=eq.{{CLIP_ID}}",
        headers={{**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"}},
        json=p, timeout=30)

print(f"CUDA: {{torch.cuda.is_available()}}")
update_clip("generating")
try:
    from diffusers import WanPipeline
    from diffusers.utils import export_to_video
    import imageio, numpy as np
    pipe = WanPipeline.from_pretrained("Wan-AI/Wan2.1-T2V-14B-FP8", torch_dtype=torch.float16)
    pipe.to("cuda")
    print("Model loaded!")
    out = pipe(prompt=PROMPT, num_frames=NUM_FRAMES, width=WIDTH, height=HEIGHT,
               num_inference_steps=50, guidance_scale=5.0)
    frames = out.frames[0]
    vf = []
    for f in frames:
        a = f.cpu().numpy() if isinstance(f, torch.Tensor) else f
        if a.ndim == 3 and a.shape[0] in [1,3]: a = np.transpose(a,(1,2,0))
        vf.append((a*255).astype(np.uint8))
    pth = "/kaggle/working/output.mp4"
    imageio.mimsave(pth, vf, fps=16)
    with open(pth,"rb") as fh: data = fh.read()
    requests.post(f"{{SUPABASE_URL}}/storage/v1/object/videos/{{JOB_ID}}/video.mp4",
        headers={{**HEADERS, "Content-Type": "video/mp4", "x-upsert": "true"}},
        data=data, timeout=120)
    url = f"{{SUPABASE_URL}}/storage/v1/object/public/videos/{{JOB_ID}}/video.mp4"
    update_clip("ready", url)
    print(f"DONE: {{url}}")
except Exception as e:
    print(f"FAILED: {{e}}")
    update_clip("failed")
'''
        notebook = {
            "cells": [
                {"cell_type": "markdown", "metadata": {}, "source": ["# Cinevo Wan 2.1 Inference"]},
                {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
                 "source": ["!pip install -q diffusers transformers accelerate safetensors imageio imageio-ffmpeg torch torchvision"]},
                {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
                 "source": [code]},
            ],
            "metadata": {
                "kaggle": {"accelerator": "GPU", "dataSources": [], "isGpuEnabled": True, "isInternetEnabled": True, "language": "python"},
                "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                "language_info": {"name": "python", "version": "3.10.0"},
            },
            "nbformat": 4,
            "nbformat_minor": 4,
        }
        return json.dumps(notebook)


kaggle = KaggleRunner()

# ── GitHub Actions Trigger ──────────────────────────────
def trigger_github_action(data, job_id, clip_id, reference_images=None):
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    payload = {
        "event_type": "generate_video",
        "client_payload": {
            "job_id": job_id,
            "clip_id": clip_id,
            "prompt": data.get("prompt", ""),
            "ingredient_ids": data.get("ingredient_ids", []),
            "reference_images": reference_images or [],
            "camera_settings": data.get("camera_settings", {}),
            "duration_sec": data.get("duration_sec", 8),
            "aspect_ratio": data.get("aspect_ratio", "16:9"),
        },
    }
    try:
        httpx.post(
            "https://api.github.com/repos/sanketh-l/cinevo-ai/dispatches",
            headers=headers,
            json=payload,
            timeout=10,
        )
    except Exception:
        pass

def trigger_export_action(project_id, export_id):
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    payload = {
        "event_type": "export_video",
        "client_payload": {"project_id": project_id, "export_id": export_id},
    }
    try:
        httpx.post(
            "https://api.github.com/repos/sanketh-l/cinevo-ai/dispatches",
            headers=headers,
            json=payload,
            timeout=10,
        )
    except Exception:
        pass

# ── Vercel Entry ────────────────────────────────────────
application = app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
