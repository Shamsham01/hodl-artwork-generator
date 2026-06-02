import { supabase } from "./supabase";
import { deleteProjectClient, syncTraitsToProject } from "./projectActions.js";

export const api = {
  deleteProject: async (projectId) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    return deleteProjectClient(projectId, user.id);
  },

  syncTraits: (projectId, traits) => syncTraitsToProject(projectId, traits),
};
