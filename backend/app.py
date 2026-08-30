import os
import uuid
import json
import time
import urllib.parse
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

# ── Health ──────────────────────────────────────────────
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "cinevo"})

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

    try:
        trigger_github_action(data, job_id)
    except Exception:
        pass

    return jsonify({"job_id": job_id, "clip_id": clip_id, "status": "queued"})

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
    allowed = {k: v for k, v in data.items() if k in ("position", "prompt", "duration_sec", "camera_settings", "status", "video_url")}
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

    try:
        import edge_tts
        import asyncio
        import tempfile

        output_path = os.path.join(tempfile.gettempdir(), f"vo_{uuid.uuid4().hex[:8]}.mp3")

        async def _gen():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(output_path)

        asyncio.run(_gen())

        vo_id = str(uuid.uuid4())
        vo = {
            "id": vo_id,
            "clip_id": clip_id or "",
            "text": text,
            "voice": voice,
            "audio_url": "",
        }
        get_sb().table("voiceovers").insert(vo).execute()

        if os.path.exists(output_path):
            os.remove(output_path)

        return jsonify({"voiceover_id": vo_id, "status": "generated"})
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

# ── Export ──────────────────────────────────────────────
@app.route("/api/export/<project_id>/start", methods=["POST"])
def start_export(project_id):
    export_id = str(uuid.uuid4())
    export = {"id": export_id, "project_id": project_id, "status": "queued"}
    get_sb().table("exports").insert(export).execute()
    return jsonify({"export_id": export_id, "status": "queued"})

@app.route("/api/export/<project_id>/status", methods=["GET"])
def export_status(project_id):
    result = get_sb().table("exports").select("*").eq("project_id", project_id).order("created_at", desc=True).limit(1).execute()
    if not result.data:
        return jsonify({"status": "none"})
    return jsonify(result.data[0])

# ── GitHub Actions Trigger ──────────────────────────────
def trigger_github_action(data, job_id):
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
            "prompt": data.get("prompt", ""),
            "ingredient_ids": data.get("ingredient_ids", []),
            "camera_settings": data.get("camera_settings", {}),
            "duration_sec": data.get("duration_sec", 8),
            "aspect_ratio": data.get("aspect_ratio", "16:9"),
        },
    }
    try:
        httpx.post(
            "https://api.github.com/repos/sanketh-l/cinevo-gpu/dispatches",
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
