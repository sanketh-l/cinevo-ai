"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  projectsApi, ingredientsApi, clipsApi, collectionsApi, generateApi,
  type Project, type Ingredient, type Clip, type Collection,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Film, Lock, Unlock, Trash2, Play, Loader2, Download,
  Image as ImageIcon, Video, GripVertical, Camera, Search, X, Check,
  Volume2, Sparkles, ChevronRight, Clock, Send,
} from "lucide-react";

// ─── CONSTANTS ─────────────────────────────────────────
const STYLE_PRESETS = ["Cinematic", "Film Noir", "Anime", "Realistic", "Dreamy"];
const DURATIONS = [4, 6, 8, 10];
const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

// ─── MAIN PAGE ─────────────────────────────────────────
export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const store = useAppStore();
  const {
    ingredients, clips, collections, selectedIngredients, prompt,
    generating, generatingImage, previewClip, activeTab, sidebarTab,
    setIngredients, addIngredient, removeIngredient,
    setClips, addClip, updateClip, removeClip,
    setCollections, addCollection,
    toggleIngredient, setPrompt, setGenerating, setGeneratingImage,
    setPreviewClip, setActiveTab, setSidebarTab, setCurrentProject,
  } = store;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [ingredientPrompt, setIngredientPrompt] = useState("");
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "images" | "videos">("all");
  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [stylePreset, setStylePreset] = useState<string | null>(null);
  const [cameraPan, setCameraPan] = useState(0);
  const [cameraTilt, setCameraTilt] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(0);
  const [mode, setMode] = useState<"image" | "video">("video");
  const [pollingJobs, setPollingJobs] = useState<Set<string>>(new Set());
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Load Data ──
  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    try {
      const [projRes, ingRes, clipRes, colRes] = await Promise.all([
        projectsApi.get(projectId),
        ingredientsApi.list(projectId),
        clipsApi.list(projectId),
        collectionsApi.list(),
      ]);
      setProject(projRes.data);
      setCurrentProject(projRes.data);
      setIngredients(ingRes.data);
      setClips(clipRes.data);
      setCollections(colRes.data);
      if (projRes.data?.aspect_ratio) setAspectRatio(projRes.data.aspect_ratio);
    } catch (err) {
      console.error("Load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Polling ──
  useEffect(() => {
    if (pollingJobs.size === 0) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      for (const jobId of pollingJobs) {
        try {
          const res = await generateApi.status(jobId);
          if (res.data.status === "ready" && res.data.video_url) {
            updateClip(res.data.clip_id, { status: "ready", video_url: res.data.video_url });
            setPollingJobs((prev) => { const n = new Set(prev); n.delete(jobId); return n; });
          } else if (res.data.status === "failed") {
            updateClip(res.data.clip_id, { status: "failed" });
            setPollingJobs((prev) => { const n = new Set(prev); n.delete(jobId); return n; });
          }
        } catch {}
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollingJobs]);

  // ── Generate Ingredient ──
  const handleGenerateIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingredientPrompt.trim()) return;
    setGeneratingImage(true);
    try {
      const imgRes = await ingredientsApi.generate({ prompt: ingredientPrompt });
      const newIng = await ingredientsApi.create({
        name: ingredientPrompt.slice(0, 50),
        type: "character",
        image_url: imgRes.data.image_url,
        prompt: ingredientPrompt,
        project_id: projectId,
      });
      addIngredient(newIng.data);
      setIngredientPrompt("");
      setIngredientDialogOpen(false);
    } catch (err) {
      console.error("Generate ingredient failed:", err);
    } finally {
      setGeneratingImage(false);
    }
  };

  // ── Generate Video/Image ──
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      if (stylePreset) {
        setPrompt(prompt + ` [${stylePreset} style]`);
      }
      if (mode === "image") {
        const res = await generateApi.image({
          prompt,
          width: aspectRatio === "9:16" ? 720 : 1280,
          height: aspectRatio === "9:16" ? 1280 : 720,
        });
        const newClip: Clip = {
          id: `img_${Date.now()}`,
          project_id: projectId,
          position: clips.length,
          prompt,
          ingredients_used: selectedIngredients,
          camera_settings: {},
          video_url: res.data.image_url,
          thumbnail_url: res.data.image_url,
          duration_sec: 0,
          status: "ready",
          job_id: null,
          created_at: new Date().toISOString(),
        };
        await clipsApi.update(projectId, newClip.id, { video_url: res.data.image_url, status: "ready" });
        addClip(newClip);
        setPreviewClip(newClip);
      } else {
        const cameraSettings: Record<string, number> = {};
        if (cameraPan !== 0) cameraSettings.pan = cameraPan;
        if (cameraTilt !== 0) cameraSettings.tilt = cameraTilt;
        if (cameraZoom !== 0) cameraSettings.zoom = cameraZoom;

        const res = await generateApi.video({
          project_id: projectId,
          prompt,
          ingredient_ids: selectedIngredients,
          camera_settings: cameraSettings,
          duration_sec: duration,
          aspect_ratio: aspectRatio,
          position: clips.length,
        });
        const newClip: Clip = {
          id: res.data.clip_id,
          project_id: projectId,
          position: clips.length,
          prompt,
          ingredients_used: selectedIngredients,
          camera_settings: cameraSettings,
          video_url: null,
          thumbnail_url: null,
          duration_sec: duration,
          status: "queued",
          job_id: res.data.job_id,
          created_at: new Date().toISOString(),
        };
        addClip(newClip);
        setPollingJobs((prev) => new Set(prev).add(res.data.job_id));
      }
      setPrompt("");
      setSelectedIngredients([]);
      setStylePreset(null);
      setCameraPan(0);
      setCameraTilt(0);
      setCameraZoom(0);
    } catch (err) {
      console.error("Generate failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  // ── Delete Clip ──
  const handleDeleteClip = async (clipId: string) => {
    try {
      await clipsApi.delete(projectId, clipId);
      removeClip(clipId);
      if (previewClip?.id === clipId) setPreviewClip(null);
    } catch (err) {
      console.error("Delete clip failed:", err);
    }
  };

  // ── Reorder Clips ──
  const [draggedClip, setDraggedClip] = useState<string | null>(null);
  const handleDragStart = (clipId: string) => setDraggedClip(clipId);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (targetId: string) => {
    if (!draggedClip || draggedClip === targetId) return;
    const clipIds = clips.map((c) => c.id);
    const fromIdx = clipIds.indexOf(draggedClip);
    const toIdx = clipIds.indexOf(targetId);
    clipIds.splice(fromIdx, 1);
    clipIds.splice(toIdx, 0, draggedClip);
    const reordered = clipIds.map((id, i) => clips.find((c) => c.id === id)!);
    setClips(reordered);
    setDraggedClip(null);
    try { await clipsApi.reorder(projectId, clipIds); } catch {}
  };

  // ── Create Collection ──
  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    try {
      const res = await collectionsApi.create({ name: newCollectionName });
      addCollection(res.data);
      setNewCollectionName("");
      setCollectionDialogOpen(false);
    } catch (err) {
      console.error("Create collection failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  // ── Filtered data ──
  const filteredIngredients = ingredients.filter((i) =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.prompt?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredClips = clips.filter((c) => {
    if (libraryFilter === "images") return c.duration_sec === 0;
    if (libraryFilter === "videos") return c.duration_sec > 0;
    return true;
  });

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">

      {/* ─── TOP HEADER ──────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="p-1.5 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-violet-400" />
            <span className="text-white font-medium text-sm">{project?.name}</span>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{aspectRatio}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30">{clips.length} clips</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ─── LEFT SIDEBAR: Ingredients + Collections ── */}
        <aside className="w-[280px] border-r border-white/5 flex flex-col flex-shrink-0">
          <div className="flex border-b border-white/5">
            <button
              onClick={() => setSidebarTab("ingredients")}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "ingredients" ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/60"}`}
            >
              Ingredients
            </button>
            <button
              onClick={() => setSidebarTab("collections")}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "collections" ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/60"}`}
            >
              Collections
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {sidebarTab === "ingredients" ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-white/5 border-white/5 text-white text-xs h-8 pl-8 placeholder:text-white/20"
                    />
                  </div>
                  <Dialog open={ingredientDialogOpen} onOpenChange={setIngredientDialogOpen}>
                    <DialogTrigger render={<Button size="sm" className="bg-white text-black hover:bg-white/90 h-8 w-8 p-0 rounded-lg" />}>
                      <Plus className="w-3.5 h-3.5" />
                    </DialogTrigger>
                    <DialogContent className="bg-[#161616] border-white/10 rounded-2xl max-w-md">
                      <DialogHeader>
                        <DialogTitle className="text-white">Generate Ingredient</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleGenerateIngredient} className="space-y-3 mt-2">
                        <Textarea
                          placeholder="A young woman with short black hair, wearing a red leather jacket..."
                          value={ingredientPrompt}
                          onChange={(e) => setIngredientPrompt(e.target.value)}
                          className="bg-white/5 border-white/10 text-white text-sm min-h-[100px] placeholder:text-white/20"
                          rows={4}
                        />
                        <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 h-10 rounded-xl" disabled={generatingImage}>
                          {generatingImage ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                          ) : (
                            <><Sparkles className="w-4 h-4 mr-2" /> Generate</>
                          )}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                {filteredIngredients.length === 0 ? (
                  <div className="text-center py-8">
                    <ImageIcon className="w-8 h-8 text-white/10 mx-auto mb-2" />
                    <p className="text-white/20 text-xs">No ingredients yet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {filteredIngredients.map((ing) => (
                      <div
                        key={ing.id}
                        onClick={() => toggleIngredient(ing.id)}
                        className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all group ${
                          selectedIngredients.includes(ing.id)
                            ? "border-white ring-1 ring-white/20"
                            : "border-white/5 hover:border-white/15"
                        }`}
                      >
                        <img src={ing.image_url} alt={ing.name} className="w-full aspect-square object-cover" />
                        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); ingredientsApi.update(ing.id, { locked: !ing.locked }); setIngredients(ingredients.map((i) => i.id === ing.id ? { ...i, locked: !i.locked } : i)); }}
                            className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center"
                          >
                            {ing.locked ? <Lock className="w-2.5 h-2.5 text-white" /> : <Unlock className="w-2.5 h-2.5 text-white/50" />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteIngredient(ing.id); }}
                            className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center"
                          >
                            <Trash2 className="w-2.5 h-2.5 text-white/50" />
                          </button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                          <p className="text-white text-[10px] truncate">{ing.name}</p>
                        </div>
                        {selectedIngredients.includes(ing.id) && (
                          <div className="absolute top-1.5 left-1.5 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-black" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-white/40">Collections</span>
                  <Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
                    <DialogTrigger render={<Button size="sm" variant="ghost" className="h-7 text-xs text-white/50 hover:text-white" />}>
                      <Plus className="w-3 h-3 mr-1" /> New
                    </DialogTrigger>
                    <DialogContent className="bg-[#161616] border-white/10 rounded-2xl">
                      <DialogHeader>
                        <DialogTitle className="text-white">New Collection</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreateCollection} className="space-y-3 mt-2">
                        <Input
                          placeholder="Collection name"
                          value={newCollectionName}
                          onChange={(e) => setNewCollectionName(e.target.value)}
                          className="bg-white/5 border-white/10 text-white h-10 rounded-xl"
                          autoFocus
                        />
                        <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 h-10 rounded-xl">Create</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
                {collections.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-white/20 text-xs">No collections yet</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {collections.map((col) => (
                      <div key={col.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer group">
                        <span className="text-white/70 text-sm">{col.name}</span>
                        <button onClick={() => collectionsApi.delete(col.id).then(() => setCollections(collections.filter((c) => c.id !== col.id)))} className="opacity-0 group-hover:opacity-100">
                          <Trash2 className="w-3 h-3 text-white/30" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ─── CENTER: Creation Panel + Canvas ───────── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Creation Panel */}
          <div className="flex-shrink-0 p-4 border-b border-white/5 max-h-[55%] overflow-y-auto scrollbar-thin">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 mb-3 bg-white/5 rounded-xl p-1 w-fit">
              {(["image", "video"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    mode === m ? "bg-white text-black" : "text-white/50 hover:text-white/70"
                  }`}
                >
                  {m === "image" ? <ImageIcon className="w-3.5 h-3.5 mr-1.5 inline" /> : <Video className="w-3.5 h-3.5 mr-1.5 inline" />}
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>

            {/* Selected Ingredients */}
            {selectedIngredients.length > 0 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                {selectedIngredients.map((id) => {
                  const ing = ingredients.find((i) => i.id === id);
                  return ing ? (
                    <div key={id} className="relative group">
                      <img src={ing.image_url} alt={ing.name} className="w-10 h-10 rounded-lg object-cover border border-white/20" />
                      <button
                        onClick={() => toggleIngredient(id)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ) : null;
                })}
              </div>
            )}

            {/* Prompt */}
            <Textarea
              placeholder={`Describe your ${mode} scene... Use @ to reference ingredients`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="bg-white/5 border-white/5 text-white text-sm min-h-[80px] placeholder:text-white/20 mb-3 resize-none"
              rows={3}
            />

            {/* Camera Controls */}
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-white/30" />
                <span className="text-xs text-white/30">Camera</span>
              </div>
              {[
                { label: "Pan", value: cameraPan, set: setCameraPan },
                { label: "Tilt", value: cameraTilt, set: setCameraTilt },
                { label: "Zoom", value: cameraZoom, set: setCameraZoom },
              ].map(({ label, value, set }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/30 w-8">{label}</span>
                  <input
                    type="range"
                    min={-10}
                    max={10}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    className="w-16 h-1 accent-white/50"
                  />
                  <span className="text-[10px] text-white/40 w-5 text-right">{value}</span>
                </div>
              ))}
            </div>

            {/* Settings Row */}
            <div className="flex items-center gap-4 mb-3 flex-wrap">
              {/* Duration */}
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-white/30" />
                <span className="text-[10px] text-white/30">Duration</span>
                <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                        duration === d ? "bg-white text-black" : "text-white/40 hover:text-white/60"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/30">Ratio</span>
                <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar}
                      onClick={() => setAspectRatio(ar)}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                        aspectRatio === ar ? "bg-white text-black" : "text-white/40 hover:text-white/60"
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Style Presets */}
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[10px] text-white/30 mr-1">Style</span>
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStylePreset(stylePreset === s ? null : s)}
                  className={`px-3 py-1 rounded-full text-[10px] font-medium transition-all border ${
                    stylePreset === s
                      ? "bg-white text-black border-white"
                      : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              className="w-full bg-white text-black hover:bg-white/90 h-11 rounded-xl font-medium text-sm"
              disabled={generating || !prompt.trim()}
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate {mode === "image" ? "Image" : "Video"}</>
              )}
            </Button>
          </div>

          {/* Canvas / Preview */}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            {generating ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                <span className="text-white/40 text-sm">Generating your {mode}...</span>
              </div>
            ) : previewClip ? (
              <div className="relative max-w-full max-h-full">
                {previewClip.video_url ? (
                  previewClip.duration_sec === 0 ? (
                    <img src={previewClip.video_url} alt="Generated" className="max-h-full max-w-full rounded-xl object-contain" />
                  ) : (
                    <video src={previewClip.video_url} controls className="max-h-full max-w-full rounded-xl" />
                  )
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                    <span className="text-white/40 text-sm">Processing...</span>
                  </div>
                )}
                <p className="text-white/30 text-xs text-center mt-2 max-w-md truncate">{previewClip.prompt}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <Film className="w-7 h-7 text-white/10" />
                </div>
                <div>
                  <p className="text-white/20 text-sm">Generate your first {mode}</p>
                  <p className="text-white/10 text-xs mt-1">Write a prompt above and click Generate</p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ─── RIGHT SIDEBAR: Library ────────────────── */}
        <aside className="w-[300px] border-l border-white/5 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <Input
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white/5 border-white/5 text-white text-xs h-8 pl-8 placeholder:text-white/20"
              />
            </div>
            <div className="flex gap-1 mt-2">
              {(["all", "images", "videos"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLibraryFilter(f)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                    libraryFilter === f ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {filteredClips.length === 0 ? (
              <div className="text-center py-8">
                <Video className="w-8 h-8 text-white/10 mx-auto mb-2" />
                <p className="text-white/20 text-xs">No assets yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredClips.map((clip) => (
                  <div
                    key={clip.id}
                    onClick={() => setPreviewClip(clip)}
                    className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all group ${
                      previewClip?.id === clip.id ? "border-white" : "border-white/5 hover:border-white/15"
                    }`}
                  >
                    <div className="aspect-video bg-white/5">
                      {clip.video_url ? (
                        clip.duration_sec === 0 ? (
                          <img src={clip.video_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={clip.video_url} className="w-full h-full object-cover" muted />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {clip.status === "queued" || clip.status === "generating" ? (
                            <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
                          ) : clip.status === "failed" ? (
                            <span className="text-red-400/50 text-[10px]">Failed</span>
                          ) : (
                            <Play className="w-5 h-5 text-white/20" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-[10px] truncate">{clip.prompt}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[9px] px-1 py-0.5 rounded ${
                          clip.status === "ready" ? "bg-green-500/20 text-green-400" :
                          clip.status === "generating" || clip.status === "queued" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>
                          {clip.status}
                        </span>
                        {clip.duration_sec > 0 && <span className="text-white/30 text-[9px]">{clip.duration_sec}s</span>}
                      </div>
                    </div>
                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {clip.video_url && (
                        <a href={clip.video_url} download className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center">
                          <Download className="w-2.5 h-2.5 text-white" />
                        </a>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteClip(clip.id); }}
                        className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-white/50" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ─── BOTTOM: Timeline ────────────────────────── */}
      <div className="h-[180px] border-t border-white/5 flex-shrink-0 flex">
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-white/50">Timeline</span>
              <span className="text-[10px] text-white/20">{clips.length} clips</span>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-white/40 hover:text-white">
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          </div>
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-3 scrollbar-thin">
            {clips.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-white/15 text-xs">Generate clips to build your timeline</p>
              </div>
            ) : (
              <div className="flex gap-2 h-full">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => handleDragStart(clip.id)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(clip.id)}
                    onClick={() => setPreviewClip(clip)}
                    className={`relative flex-shrink-0 w-[140px] rounded-xl overflow-hidden border cursor-grab active:cursor-grabbing transition-all ${
                      previewClip?.id === clip.id ? "border-white" : "border-white/5 hover:border-white/15"
                    }`}
                  >
                    <div className="h-[80px] bg-white/5">
                      {clip.video_url ? (
                        clip.duration_sec === 0 ? (
                          <img src={clip.video_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={clip.video_url} className="w-full h-full object-cover" muted />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {clip.status === "generating" || clip.status === "queued" ? (
                            <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 text-white/20" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="text-[10px] text-white/60 truncate">{clip.prompt}</p>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[9px] text-white/30">{clip.duration_sec}s</span>
                        <GripVertical className="w-3 h-3 text-white/15" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function handleDeleteIngredient(id: string) {
  ingredientsApi.delete(id).catch(console.error);
}
