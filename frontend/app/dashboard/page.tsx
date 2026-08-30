"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { projectsApi, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Film, Plus, Trash2, Clock, Clapperboard } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await projectsApi.list();
      setProjects(res.data);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await projectsApi.create({ name: newName, aspect_ratio: aspectRatio });
      setProjects([res.data, ...projects]);
      setNewName("");
      setDialogOpen(false);
      router.push(`/project/${res.data.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
    }
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await projectsApi.delete(id);
      setProjects(projects.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">Cinevo</span>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button className="bg-white text-black hover:bg-white/90 rounded-full px-4 h-9 text-sm font-medium" />}>
            <Plus className="w-4 h-4 mr-1.5" />
            New Project
          </DialogTrigger>
          <DialogContent className="bg-[#161616] border-white/10 rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-white text-lg">Create Project</DialogTitle>
            </DialogHeader>
            <form onSubmit={createProject} className="space-y-4 mt-2">
              <Input
                placeholder="Project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-11 rounded-xl"
                autoFocus
              />
              <div className="flex gap-2">
                {["16:9", "9:16", "1:1"].map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    onClick={() => setAspectRatio(ar)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      aspectRatio === ar
                        ? "bg-white text-black"
                        : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {ar}
                  </button>
                ))}
              </div>
              <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 h-11 rounded-xl font-medium">
                Create
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
              <Film className="w-8 h-8 text-white/20" />
            </div>
            <h3 className="text-white/60 text-lg font-medium mb-1">No projects yet</h3>
            <p className="text-white/30 text-sm">Create your first project to start generating videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => router.push(`/project/${project.id}`)}
                className="group relative bg-[#161616] rounded-2xl border border-white/5 p-5 cursor-pointer transition-all hover:border-white/15 hover:bg-[#1a1a1a]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                    <Film className="w-5 h-5 text-violet-400" />
                  </div>
                  <button
                    onClick={(e) => deleteProject(project.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/10 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white/40" />
                  </button>
                </div>
                <h3 className="text-white font-medium mb-1 truncate">{project.name}</h3>
                <div className="flex items-center gap-3 text-xs text-white/30">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(project.created_at).toLocaleDateString()}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-white/5">{project.aspect_ratio}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
