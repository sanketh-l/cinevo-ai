# Cinevo Status

## Verified Working

- Unified deployed site: https://cinevo-nu.vercel.app
- Same-origin API routing: `/api/*`
- Supabase database connection
- Supabase Storage buckets: `images`, `videos`
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

## Not Real Yet

- Wan 2.1 14B inference is not connected yet.
- Kaggle account keys are configured, but Kaggle notebook execution is not wired into the live job path.
- HuggingFace token is configured, but no ZeroGPU Space is deployed/called yet.
- Google Drive storage is not wired; Supabase Storage is currently used.
- Export stitches ready MP4 clips only; voiceover/audio mixing is still pending.
- Browser automation via Playwright MCP times out on this machine, so UI click verification is manual/API-level only.

## Current Video Behavior

The video button now completes a real end-to-end job, but it uses the free FFmpeg fallback pipeline:

1. Create queued clip in Supabase.
2. Dispatch GitHub Actions.
3. Use selected reference image if present, otherwise generate a frame with Pollinations.
4. Animate the image into an MP4 with FFmpeg zoom/pan.
5. Upload MP4 to Supabase Storage.
6. Mark clip `ready`.
