# Cinevo Status

## Verified Working

- Unified deployed site: https://cinevo-nu.vercel.app
- Same-origin API routing: `/api/*`
- Supabase database connection
- Supabase Storage buckets: `images`, `videos`, `audio`
- Create/list/delete projects in no-auth mode
- Generate ingredient image URL with Pollinations
- Upload ingredient reference image to Supabase Storage
- Save/select locked ingredients
- Generate image asset and persist it as a clip
- Queue video job from website/backend
- Trigger GitHub Actions from backend
- GitHub Actions fallback video generation with FFmpeg
- Reference image is passed into the video job and used as the source frame when selected
- Upload generated MP4 to Supabase Storage
- Update clip status to `ready` with public MP4 URL
- Account status endpoint for Supabase, GitHub Actions, Kaggle, HF, and storage
- Export job dispatch through GitHub Actions
- FFmpeg stitching of ready clips into a final MP4
- Final export MP4 upload to Supabase Storage
- **Kaggle Wan 2.1 14B inference wired** - backend tries Kaggle first, falls back to FFmpeg
- **Voiceover generation via gTTS** - stores audio in Supabase `audio` bucket
- **Export mixes voiceover audio** with video clips when present
- **Voiceover UI** in workspace for selected clip

## Not Real Yet

- Kaggle notebook execution is wired but first real Wan run not yet tested end-to-end (needs a GPU available on Kaggle side)
- HuggingFace token is configured, but no ZeroGPU Space is deployed/called yet
- Google Drive storage is not wired; Supabase Storage is currently used
- Browser automation via Playwright MCP times out on this machine, so UI click verification is manual/API-level only

## Current Video Behavior

The video button now completes a real end-to-end job. Backend tries Kaggle Wan 2.1 inference first:

1. Create queued clip in Supabase.
2. If Kaggle credentials are available, push a Wan 2.1 inference notebook to Kaggle and start it on GPU.
3. If Kaggle fails or is unavailable, fall back to GitHub Actions FFmpeg pipeline.
4. Use selected reference image if present, otherwise generate a frame with Pollinations.
5. Upload MP4 to Supabase Storage.
6. Mark clip `ready`.

## Voiceover Pipeline

1. User enters narration text and selects a voice for a ready clip.
2. Backend generates MP3 via gTTS (Google Text-to-Speech).
3. MP3 is uploaded to Supabase Storage `audio` bucket.
4. Voiceover record is saved in the `voiceovers` table.
5. During export, each clip's voiceover audio is mixed with the video using FFmpeg.
