import { create } from "zustand";
import type { Project, Ingredient, Clip, Collection } from "./api";

interface AppState {
  projects: Project[];
  currentProject: Project | null;
  ingredients: Ingredient[];
  clips: Clip[];
  collections: Collection[];
  selectedIngredients: string[];
  prompt: string;
  generating: boolean;
  generatingImage: boolean;
  activeTab: "generate" | "timeline";
  previewClip: Clip | null;
  sidebarTab: "ingredients" | "library" | "collections";

  setProjects: (p: Project[]) => void;
  setCurrentProject: (p: Project | null) => void;
  setIngredients: (i: Ingredient[]) => void;
  addIngredient: (i: Ingredient) => void;
  removeIngredient: (id: string) => void;
  setClips: (c: Clip[]) => void;
  addClip: (c: Clip) => void;
  updateClip: (id: string, data: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  setCollections: (c: Collection[]) => void;
  addCollection: (c: Collection) => void;
  toggleIngredient: (id: string) => void;
  setSelectedIngredients: (ids: string[]) => void;
  setPrompt: (p: string) => void;
  setGenerating: (g: boolean) => void;
  setGeneratingImage: (g: boolean) => void;
  setActiveTab: (t: "generate" | "timeline") => void;
  setPreviewClip: (c: Clip | null) => void;
  setSidebarTab: (t: "ingredients" | "library" | "collections") => void;
}

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  currentProject: null,
  ingredients: [],
  clips: [],
  collections: [],
  selectedIngredients: [],
  prompt: "",
  generating: false,
  generatingImage: false,
  activeTab: "generate",
  previewClip: null,
  sidebarTab: "ingredients",

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setIngredients: (ingredients) => set({ ingredients }),
  addIngredient: (i) => set((s) => ({ ingredients: [i, ...s.ingredients] })),
  removeIngredient: (id) => set((s) => ({ ingredients: s.ingredients.filter((i) => i.id !== id) })),
  setClips: (clips) => set({ clips }),
  addClip: (c) => set((s) => ({ clips: [c, ...s.clips] })),
  updateClip: (id, data) => set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...data } : c)) })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  setCollections: (collections) => set({ collections }),
  addCollection: (c) => set((s) => ({ collections: [...s.collections, c] })),
  toggleIngredient: (id) =>
    set((s) => ({
      selectedIngredients: s.selectedIngredients.includes(id)
        ? s.selectedIngredients.filter((i) => i !== id)
        : s.selectedIngredients.length < 3
        ? [...s.selectedIngredients, id]
        : s.selectedIngredients,
    })),
  setSelectedIngredients: (selectedIngredients) => set({ selectedIngredients }),
  setPrompt: (prompt) => set({ prompt }),
  setGenerating: (generating) => set({ generating }),
  setGeneratingImage: (generatingImage) => set({ generatingImage }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setPreviewClip: (previewClip) => set({ previewClip }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}));
