import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "",
  headers: { "Content-Type": "application/json" },
});

export interface Project {
  id: string;
  user_id: string;
  name: string;
  aspect_ratio: string;
  status: string;
  created_at: string;
}

export interface Ingredient {
  id: string;
  user_id: string;
  project_id: string | null;
  collection_id: string | null;
  name: string;
  type: string;
  image_url: string;
  prompt: string;
  locked: boolean;
  created_at: string;
}

export interface Clip {
  id: string;
  project_id: string;
  position: number;
  prompt: string;
  ingredients_used: string[];
  camera_settings: Record<string, number>;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_sec: number;
  status: string;
  job_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
}

export interface Voiceover {
  id: string;
  clip_id: string;
  text: string;
  voice: string;
  audio_url: string | null;
  created_at: string;
}

export interface AccountStatus {
  supabase: { connected: boolean };
  github_actions: { connected: boolean; workflow: string };
  kaggle: { connected_accounts: number; mode: string };
  huggingface: { connected: boolean; mode: string };
  storage: { video_bucket: string; image_bucket: string };
}

export const projectsApi = {
  list: () => api.get<Project[]>("/api/projects"),
  create: (data: { name: string; aspect_ratio?: string }) => api.post<Project>("/api/projects", data),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`),
  update: (id: string, data: Partial<Project>) => api.put(`/api/projects/${id}`, data),
  delete: (id: string) => api.delete(`/api/projects/${id}`),
};

export const ingredientsApi = {
  list: (projectId?: string) => api.get<Ingredient[]>("/api/ingredients", { params: { project_id: projectId } }),
  create: (data: Partial<Ingredient>) => api.post<Ingredient>("/api/ingredients", data),
  update: (id: string, data: Partial<Ingredient>) => api.put(`/api/ingredients/${id}`, data),
  delete: (id: string) => api.delete(`/api/ingredients/${id}`),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api.post<{ image_url: string }>("/api/ingredients/upload", body, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  generate: (data: { prompt: string; width?: number; height?: number; seed?: number }) =>
    api.post<{ image_url: string; prompt: string }>("/api/ingredients/generate", data),
};

export const accountsApi = {
  status: () => api.get<AccountStatus>("/api/accounts/status"),
};

export const collectionsApi = {
  list: () => api.get<Collection[]>("/api/collections"),
  create: (data: { name: string; description?: string }) => api.post<Collection>("/api/collections", data),
  delete: (id: string) => api.delete(`/api/collections/${id}`),
};

export const clipsApi = {
  list: (projectId: string) => api.get<Clip[]>(`/api/projects/${projectId}/clips`),
  reorder: (projectId: string, clipIds: string[]) => api.post(`/api/projects/${projectId}/clips/reorder`, { clip_ids: clipIds }),
  update: (projectId: string, clipId: string, data: Partial<Clip>) => api.put(`/api/projects/${projectId}/clips/${clipId}`, data),
  delete: (projectId: string, clipId: string) => api.delete(`/api/projects/${projectId}/clips/${clipId}`),
};

export const generateApi = {
  video: (data: {
    project_id: string;
    prompt: string;
    ingredient_ids?: string[];
    camera_settings?: Record<string, number>;
    duration_sec?: number;
    aspect_ratio?: string;
    position?: number;
  }) => api.post<{ job_id: string; clip_id: string; status: string }>("/api/generate/video", data),
  image: (data: { prompt: string; project_id?: string; ingredient_ids?: string[]; width?: number; height?: number; seed?: number; position?: number }) =>
    api.post<{ image_url: string; clip?: Clip }>("/api/generate/image", data),
  status: (jobId: string) => api.get<{ status: string; video_url: string | null; clip_id: string }>(`/api/generate/${jobId}/status`),
  voices: () => api.get<Voice[]>("/api/generate/voices"),
  voiceover: (data: { text: string; voice?: string; clip_id?: string }) =>
    api.post<{ voiceover_id: string; audio_url: string; status: string }>("/api/generate/voiceover", data),
};

export const voiceoversApi = {
  list: (clipId: string) => api.get<Voiceover[]>(`/api/clips/${clipId}/voiceovers`),
};

export const exportApi = {
  start: (projectId: string) => api.post<{ export_id: string; status: string }>(`/api/export/${projectId}/start`),
  status: (projectId: string) => api.get(`/api/export/${projectId}/status`),
};
