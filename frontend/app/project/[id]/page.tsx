"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  projectsApi, ingredientsApi, clipsApi, collectionsApi, generateApi, exportApi, accountsApi,
  type Project, type Ingredient, type Clip, type Collection,
  type AccountStatus,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Film, Lock, Unlock, Trash2, Play, Loader2, Download,
  Image as ImageIcon, Video, GripVertical, Camera, Search, X, Check,
  Sparkles, Clock, Menu, PanelRightClose, UploadCloud, Server,
} from "lucide-react";

const STYLE_PRESETS = ["Cinematic", "Film Noir", "Anime", "Realistic", "Dreamy"];
const DURATIONS = [4, 6, 8, 10];
const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const {
    ingredients, clips, collections, selectedIngredients, prompt,
    generating, generatingImage, previewClip, sidebarTab,
    setIngredients, addIngredient, removeIngredient,
    setClips, addClip, updateClip, removeClip,
    setCollections, addCollection,
    toggleIngredient, setSelectedIngredients, setPrompt, setGenerating, setGeneratingImage,
    setPreviewClip, setCurrentProject, setSidebarTab,
  } = useAppStore();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [ingredientPrompt, setIngredientPrompt] = useState("");
  const [ingredientFile, setIngredientFile] = useState<File | null>(null);
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
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
  const [mobilePanel, setMobilePanel] = useState<"left" | "center" | "right">("center");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Load Data
  const loadData = useCallback(async () => {
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
      accountsApi.status().then((res) => setAccountStatus(res.data)).catch(() => setAccountStatus(null));
    } catch (err) {
      console.error("Load failed:", err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Polling
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
        } catch { /* retry next tick */ }
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollingJobs, updateClip]);

  // Generate Ingredient
  const handleGenerateIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingredientPrompt.trim() && !ingredientFile) return;
    setGeneratingImage(true);
    try {
      const imageUrl = ingredientFile
        ? (await ingredientsApi.upload(ingredientFile)).data.image_url
        : (await ingredientsApi.generate({ prompt: ingredientPrompt })).data.image_url;
      const name = ingredientPrompt.trim() || ingredientFile?.name || "Uploaded Reference";
      const newIng = await ingredientsApi.create({
        name: name.slice(0, 50),
        type: "character",
        image_url: imageUrl,
        prompt: ingredientPrompt || `Uploaded reference: ${ingredientFile?.name}`,
        project_id: projectId,
        locked: true,
      });
      addIngredient(newIng.data);
      setIngredientPrompt("");
      setIngredientFile(null);
      setIngredientDialogOpen(false);
    } catch (err) {
      console.error("Generate ingredient failed:", err);
    } finally {
      setGeneratingImage(false);
    }
  };

  // Generate Video/Image
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    const currentPrompt = stylePreset ? `${prompt} [${stylePreset} style]` : prompt;
    try {
      if (mode === "image") {
        const res = await generateApi.image({
          prompt: currentPrompt,
          project_id: projectId,
          ingredient_ids: selectedIngredients,
          position: clips.length,
          width: aspectRatio === "9:16" ? 720 : 1280,
          height: aspectRatio === "9:16" ? 1280 : 720,
        });
        const newClip = res.data.clip ?? {
          id: `img_${Date.now()}`,
          project_id: projectId,
          position: clips.length,
          prompt: currentPrompt,
          ingredients_used: selectedIngredients,
          camera_settings: {},
          video_url: res.data.image_url,
          thumbnail_url: res.data.image_url,
          duration_sec: 0,
          status: "ready",
          job_id: null,
          created_at: new Date().toISOString(),
        } as Clip;
        addClip(newClip);
        setPreviewClip(newClip);
      } else {
        const cameraSettings: Record<string, number> = {};
        if (cameraPan !== 0) cameraSettings.pan = cameraPan;
        if (cameraTilt !== 0) cameraSettings.tilt = cameraTilt;
        if (cameraZoom !== 0) cameraSettings.zoom = cameraZoom;

        const res = await generateApi.video({
          project_id: projectId,
          prompt: currentPrompt,
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
          prompt: currentPrompt,
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

  // Delete Clip
  const handleDeleteClip = async (clipId: string) => {
    try {
      await clipsApi.delete(projectId, clipId);
      removeClip(clipId);
      if (previewClip?.id === clipId) setPreviewClip(null);
    } catch (err) {
      console.error("Delete clip failed:", err);
    }
  };

  // Reorder
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
    const reordered = clipIds.map((id) => clips.find((c) => c.id === id)!).filter(Boolean);
    setClips(reordered);
    setDraggedClip(null);
    try { await clipsApi.reorder(projectId, clipIds); } catch {}
  };

  // Create Collection
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

  // Export
  const handleExport = async () => {
    try {
      setExporting(true);
      setExportUrl(null);
      await exportApi.start(projectId);
      const startedAt = Date.now();
      const poll = setInterval(async () => {
        try {
          const res = await exportApi.status(projectId);
          if (res.data.status === "done" && res.data.final_video_url) {
            setExportUrl(res.data.final_video_url);
            setExporting(false);
            clearInterval(poll);
          }
          if (res.data.status === "failed" || Date.now() - startedAt > 180000) {
            setExporting(false);
            clearInterval(poll);
          }
        } catch {
          setExporting(false);
          clearInterval(poll);
        }
      }, 5000);
    } catch (err) {
      setExporting(false);
      console.error("Export failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#0a0a0a] text-center px-4">
        <Film className="w-12 h-12 text-white/10 mb-4" />
        <h2 className="text-white/60 text-lg font-medium mb-2">Project not found</h2>
        <p className="text-white/30 text-sm mb-4">This project may have been deleted.</p>
        <Button onClick={() => router.push("/dashboard")} className="bg-white text-black hover:bg-white/90 rounded-xl">
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const filteredIngredients = ingredients.filter((i) =>
    i.name.toLowerCase().includes(ingredientSearch.toLowerCase()) ||
    i.prompt?.toLowerCase().includes(ingredientSearch.toLowerCase())
  );
  const filteredClips = clips.filter((c) => {
    if (libraryFilter === "images") return c.duration_sec === 0;
    if (libraryFilter === "videos") return c.duration_sec > 0;
    return true;
  }).filter((c) =>
    c.prompt.toLowerCase().includes(librarySearch.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">

      {/* ─── HEADER ──────────────────────────────── */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onClick={() => router.push("/dashboard")} className="p-1.5 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          {/* Mobile panel toggles */}
          <button onClick={() => setMobilePanel("left")} className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 text-white/50 flex-shrink-0">
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <span className="text-white font-medium text-sm truncate">{project.name}</span>
          </div>
          <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 flex-shrink-0 hidden sm:inline">{aspectRatio}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {accountStatus && (
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-white/5 text-white/35">
              <Server className="w-3 h-3" />
              GH {accountStatus.github_actions.connected ? "on" : "off"} · HF {accountStatus.huggingface.connected ? "on" : "off"} · KG {accountStatus.kaggle.connected_accounts}
            </span>
          )}
          <span className="text-[10px] sm:text-xs text-white/30 hidden sm:inline">{clips.length} clips</span>
          <button onClick={() => setRightOpen(!rightOpen)} className="hidden lg:block p-1.5 rounded-lg hover:bg-white/5 text-white/50">
            {rightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4 opacity-50" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 relative">

        {/* ─── LEFT SIDEBAR ───────────────────────── */}
        <aside className={`${leftOpen ? "w-[260px] xl:w-[280px]" : "w-0"} border-r border-white/5 flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden ${mobilePanel === "left" ? "absolute inset-y-0 left-0 z-30 w-[280px] bg-[#0a0a0a]" : "hidden lg:flex"}`}>
          <div className="flex border-b border-white/5 flex-shrink-0">
            <button onClick={() => setSidebarTab("ingredients")} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "ingredients" ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/60"}`}>
              Ingredients
            </button>
            <button onClick={() => setSidebarTab("collections")} className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "collections" ? "text-white border-b-2 border-white" : "text-white/40 hover:text-white/60"}`}>
              Collections
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 scrollbar-thin">
            {sidebarTab === "ingredients" ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <Input placeholder="Search..." value={ingredientSearch} onChange={(e) => setIngredientSearch(e.target.value)} className="bg-white/5 border-white/5 text-white text-xs h-8 pl-8 placeholder:text-white/20" />
                  </div>
                  <Dialog open={ingredientDialogOpen} onOpenChange={setIngredientDialogOpen}>
                    <DialogTrigger render={<Button size="sm" className="bg-white text-black hover:bg-white/90 h-8 w-8 p-0 rounded-lg" />}>
                        <Plus className="w-3.5 h-3.5" />
                    </DialogTrigger>
                    <DialogContent className="bg-[#161616] border-white/10 rounded-2xl max-w-md mx-4">
                      <DialogHeader>
                        <DialogTitle className="text-white">Generate Ingredient</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleGenerateIngredient} className="space-y-3 mt-2">
                        <Textarea placeholder="A young woman with short black hair, wearing a red leather jacket..." value={ingredientPrompt} onChange={(e) => setIngredientPrompt(e.target.value)} className="bg-white/5 border-white/10 text-white text-sm min-h-[100px] placeholder:text-white/20" rows={4} />
                        <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-3 text-xs text-white/45 hover:text-white/70 cursor-pointer">
                          <UploadCloud className="w-4 h-4" />
                          {ingredientFile ? ingredientFile.name : "Upload reference image"}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setIngredientFile(event.target.files?.[0] ?? null)} />
                        </label>
                        <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 h-10 rounded-xl" disabled={generatingImage}>
                          {generatingImage ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : <><Sparkles className="w-4 h-4 mr-2" /> {ingredientFile ? "Save Reference" : "Generate"}</>}
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
                      <div key={ing.id} onClick={() => toggleIngredient(ing.id)} className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all group ${selectedIngredients.includes(ing.id) ? "border-white ring-1 ring-white/20" : "border-white/5 hover:border-white/15"}`}>
                        <img src={ing.image_url} alt={ing.name} className="w-full aspect-square object-cover" loading="lazy" />
                        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); ingredientsApi.update(ing.id, { locked: !ing.locked }).catch(console.error); setIngredients(ingredients.map((i) => i.id === ing.id ? { ...i, locked: !i.locked } : i)); }} className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center">
                            {ing.locked ? <Lock className="w-2.5 h-2.5 text-white" /> : <Unlock className="w-2.5 h-2.5 text-white/50" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); ingredientsApi.delete(ing.id).then(() => removeIngredient(ing.id)).catch(console.error); }} className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center">
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
                    <DialogContent className="bg-[#161616] border-white/10 rounded-2xl mx-4">
                      <DialogHeader>
                        <DialogTitle className="text-white">New Collection</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreateCollection} className="space-y-3 mt-2">
                        <Input placeholder="Collection name" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} className="bg-white/5 border-white/10 text-white h-10 rounded-xl" autoFocus />
                        <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 h-10 rounded-xl">Create</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
                {collections.length === 0 ? (
                  <div className="text-center py-8"><p className="text-white/20 text-xs">No collections yet</p></div>
                ) : (
                  <div className="space-y-1.5">
                    {collections.map((col) => (
                      <div key={col.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer group">
                        <span className="text-white/70 text-sm">{col.name}</span>
                        <button onClick={() => collectionsApi.delete(col.id).then(() => setCollections(collections.filter((c) => c.id !== col.id))).catch(console.error)} className="opacity-0 group-hover:opacity-100">
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

        {/* Mobile overlay */}
        {mobilePanel === "left" && <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setMobilePanel("center")} />}

        {/* ─── CENTER: Creation + Canvas ─────────── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Creation Panel */}
          <div className="flex-shrink-0 p-3 sm:p-4 border-b border-white/5 max-h-[55%] overflow-y-auto scrollbar-thin">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 mb-3 bg-white/5 rounded-xl p-1 w-fit">
              {(["image", "video"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === m ? "bg-white text-black" : "text-white/50 hover:text-white/70"}`}>
                  {m === "image" ? <ImageIcon className="w-3.5 h-3.5 mr-1 sm:mr-1.5 inline" /> : <Video className="w-3.5 h-3.5 mr-1 sm:mr-1.5 inline" />}
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
                      <img src={ing.image_url} alt={ing.name} className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg object-cover border border-white/20" />
                      <button onClick={() => toggleIngredient(id)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ) : null;
                })}
              </div>
            )}

            {/* Prompt */}
            <Textarea placeholder={`Describe your ${mode} scene...`} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="bg-white/5 border-white/5 text-white text-sm min-h-[70px] sm:min-h-[80px] placeholder:text-white/20 mb-3 resize-none" rows={3} />

            {/* Camera Controls */}
            <div className="flex items-center gap-3 sm:gap-4 mb-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-white/30" />
                <span className="text-[10px] sm:text-xs text-white/30">Camera</span>
              </div>
              {[
                { label: "Pan", value: cameraPan, set: setCameraPan },
                { label: "Tilt", value: cameraTilt, set: setCameraTilt },
                { label: "Zoom", value: cameraZoom, set: setCameraZoom },
              ].map(({ label, value, set }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/30 w-6 sm:w-8">{label}</span>
                  <input type="range" min={-10} max={10} value={value} onChange={(e) => set(Number(e.target.value))} className="w-14 sm:w-16 h-1 accent-white/50" />
                  <span className="text-[10px] text-white/40 w-4 sm:w-5 text-right">{value}</span>
                </div>
              ))}
            </div>

            {/* Settings Row */}
            <div className="flex items-center gap-3 sm:gap-4 mb-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-white/30" />
                <span className="text-[10px] text-white/30">Duration</span>
                <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
                  {DURATIONS.map((d) => (
                    <button key={d} onClick={() => setDuration(d)} className={`px-1.5 sm:px-2 py-1 rounded-md text-[10px] font-medium transition-all ${duration === d ? "bg-white text-black" : "text-white/40 hover:text-white/60"}`}>
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/30">Ratio</span>
                <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
                  {ASPECT_RATIOS.map((ar) => (
                    <button key={ar} onClick={() => setAspectRatio(ar)} className={`px-1.5 sm:px-2 py-1 rounded-md text-[10px] font-medium transition-all ${aspectRatio === ar ? "bg-white text-black" : "text-white/40 hover:text-white/60"}`}>
                      {ar}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Style Presets */}
            <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-thin">
              <span className="text-[10px] text-white/30 mr-1 flex-shrink-0">Style</span>
              {STYLE_PRESETS.map((s) => (
                <button key={s} onClick={() => setStylePreset(stylePreset === s ? null : s)} className={`px-2.5 sm:px-3 py-1 rounded-full text-[10px] font-medium transition-all border flex-shrink-0 ${stylePreset === s ? "bg-white text-black border-white" : "border-white/10 text-white/40 hover:text-white/60 hover:border-white/20"}`}>
                  {s}
                </button>
              ))}
            </div>

            {/* Generate Button */}
            <Button onClick={handleGenerate} className="w-full bg-white text-black hover:bg-white/90 h-10 sm:h-11 rounded-xl font-medium text-sm" disabled={generating || !prompt.trim()}>
              {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate {mode === "image" ? "Image" : "Video"}</>}
            </Button>
          </div>

          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center p-3 sm:p-4 min-h-0">
            {generating ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                <span className="text-white/40 text-xs sm:text-sm">Generating your {mode}...</span>
              </div>
            ) : previewClip ? (
              <div className="relative max-w-full max-h-full flex flex-col items-center">
                {previewClip.video_url ? (
                  previewClip.duration_sec === 0 ? (
                    <img src={previewClip.video_url} alt="Generated" className="max-h-full max-w-full rounded-xl object-contain" />
                  ) : (
                    <video src={previewClip.video_url} controls className="max-h-full max-w-full rounded-xl" />
                  )
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                    <span className="text-white/40 text-xs sm:text-sm">Processing...</span>
                  </div>
                )}
                <p className="text-white/30 text-[10px] sm:text-xs text-center mt-2 max-w-md truncate">{previewClip.prompt}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center px-4">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                  <Film className="w-6 h-6 sm:w-7 sm:h-7 text-white/10" />
                </div>
                <div>
                  <p className="text-white/20 text-xs sm:text-sm">Generate your first {mode}</p>
                  <p className="text-white/10 text-[10px] sm:text-xs mt-1">Write a prompt above and click Generate</p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ─── RIGHT SIDEBAR: Library ────────────── */}
        {rightOpen && (
          <aside className="w-[260px] xl:w-[300px] border-l border-white/5 hidden lg:flex flex-col flex-shrink-0">
            <div className="p-2.5 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <Input placeholder="Search library..." value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} className="bg-white/5 border-white/5 text-white text-xs h-8 pl-8 placeholder:text-white/20" />
              </div>
              <div className="flex gap-1 mt-2">
                {(["all", "images", "videos"] as const).map((f) => (
                  <button key={f} onClick={() => setLibraryFilter(f)} className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${libraryFilter === f ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"}`}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 scrollbar-thin">
              {filteredClips.length === 0 ? (
                <div className="text-center py-8">
                  <Video className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-white/20 text-xs">No assets yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filteredClips.map((clip) => (
                    <div key={clip.id} onClick={() => setPreviewClip(clip)} className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all group ${previewClip?.id === clip.id ? "border-white" : "border-white/5 hover:border-white/15"}`}>
                      <div className="aspect-video bg-white/5">
                        {clip.video_url ? (
                          clip.duration_sec === 0 ? (
                            <img src={clip.video_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <video src={clip.video_url} className="w-full h-full object-cover" muted preload="metadata" />
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
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                        <p className="text-white text-[10px] truncate">{clip.prompt}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[9px] px-1 py-0.5 rounded ${clip.status === "ready" ? "bg-green-500/20 text-green-400" : clip.status === "generating" || clip.status === "queued" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>
                            {clip.status}
                          </span>
                          {clip.duration_sec > 0 && <span className="text-white/30 text-[9px]">{clip.duration_sec}s</span>}
                        </div>
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {clip.video_url && (
                          <a href={clip.video_url} target="_blank" rel="noopener noreferrer" className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center">
                            <Download className="w-2.5 h-2.5 text-white" />
                          </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteClip(clip.id); }} className="w-5 h-5 bg-black/70 rounded-md flex items-center justify-center">
                          <Trash2 className="w-2.5 h-2.5 text-white/50" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ─── BOTTOM: Timeline ────────────────────── */}
      <div className="h-[140px] sm:h-[160px] lg:h-[180px] border-t border-white/5 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 sm:py-2 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] sm:text-xs font-medium text-white/50">Timeline</span>
            <span className="text-[9px] sm:text-[10px] text-white/20">{clips.length} clips</span>
          </div>
          <div className="flex items-center gap-2">
            {exportUrl && (
              <a href={exportUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] sm:text-xs text-green-400 hover:text-green-300">
                Download final
              </a>
            )}
            <Button size="sm" variant="ghost" className="h-6 sm:h-7 text-[10px] sm:text-xs text-white/40 hover:text-white" onClick={handleExport} disabled={exporting || clips.length === 0}>
              {exporting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
              {exporting ? "Exporting" : "Export"}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-2 sm:p-3 scrollbar-thin">
          {clips.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/15 text-[10px] sm:text-xs">Generate clips to build your timeline</p>
            </div>
          ) : (
            <div className="flex gap-1.5 sm:gap-2 h-full">
              {clips.map((clip) => (
                <div key={clip.id} draggable onDragStart={() => handleDragStart(clip.id)} onDragOver={handleDragOver} onDrop={() => handleDrop(clip.id)} onClick={() => setPreviewClip(clip)} className={`relative flex-shrink-0 w-[100px] sm:w-[120px] lg:w-[140px] rounded-xl overflow-hidden border cursor-grab active:cursor-grabbing transition-all ${previewClip?.id === clip.id ? "border-white" : "border-white/5 hover:border-white/15"}`}>
                  <div className="h-[55px] sm:h-[65px] lg:h-[80px] bg-white/5">
                    {clip.video_url ? (
                      clip.duration_sec === 0 ? (
                        <img src={clip.video_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <video src={clip.video_url} className="w-full h-full object-cover" muted preload="metadata" />
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
                  <div className="p-1 sm:p-1.5">
                    <p className="text-[9px] sm:text-[10px] text-white/60 truncate">{clip.prompt}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[8px] sm:text-[9px] text-white/30">{clip.duration_sec}s</span>
                      <GripVertical className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white/15" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
