import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, FolderOpen, Trash, Warning } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const statusColors = {
  draft: "bg-zinc-500/20 text-zinc-400",
  ready: "bg-emerald-500/20 text-emerald-400",
  generating: "bg-amber-500/20 text-amber-400",
  complete: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    if (user) loadProjects();
  }, [user]);

  async function loadProjects() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });
    setProjects(data || []);
    setLoading(false);
  }

  async function createProject() {
    setCreating(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: user.id,
        name: `Collection ${projects.length + 1}`,
        description: "My NFT collection",
        name_prefix: "Collection",
        network: "mvx",
      })
      .select()
      .single();

    if (!error && data) {
      setProjects((prev) => [data, ...prev]);
    }
    setCreating(false);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProject(confirmDelete.id);
      setProjects((prev) => prev.filter((p) => p.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(err.message);
    }
    setDeleting(false);
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] mesh-bg pt-28 px-4">
        <div className="max-w-5xl mx-auto animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-48" />
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 bg-zinc-800/50 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] mesh-bg pt-28 pb-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Your projects</h1>
            <p className="mt-1 text-sm text-zinc-400">Manage collections and generate artwork</p>
          </div>
          <button
            onClick={createProject}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 active:scale-[0.98] disabled:opacity-50"
          >
            <Plus size={18} weight="bold" />
            New project
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="bezel-outer">
            <div className="bezel-inner p-16 text-center">
              <FolderOpen size={48} weight="light" className="mx-auto text-zinc-600 mb-4" />
              <p className="text-zinc-400">No projects yet. Create one to get started.</p>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="relative bezel-outer hover:border-emerald-500/20 transition-colors duration-300"
              >
                <Link to={`/studio/${project.id}`} className="block">
                  <div className="bezel-inner p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-semibold text-white">{project.name}</h2>
                      <span className={`text-xs px-2.5 py-1 rounded-full ${statusColors[project.status] || statusColors.draft}`}>
                        {project.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-500 line-clamp-2">{project.description}</p>
                    <p className="mt-4 text-xs text-zinc-600">
                      {project.edition_size} editions ·{" "}
                      {project.network === "mvx"
                        ? "MultiversX"
                        : (project.network || "").toUpperCase()}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteError(null);
                    setConfirmDelete(project);
                  }}
                  title="Delete collection"
                  className="absolute bottom-4 right-4 z-10 inline-flex items-center justify-center h-8 w-8 rounded-full text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="bezel-outer max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bezel-inner p-7 space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-red-500/10 text-red-400">
                  <Warning size={20} weight="fill" />
                </span>
                <h3 className="text-lg font-semibold text-white">Delete collection</h3>
              </div>
              <p className="text-sm text-zinc-400">
                This permanently deletes{" "}
                <span className="text-white font-medium">{confirmDelete.name}</span>{" "}
                — all uploaded layers, traits, rules, generated editions and
                downloads. This cannot be undone.
              </p>
              {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-medium text-white hover:bg-red-400 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Trash size={16} weight="bold" />
                  {deleting ? "Deleting..." : "Delete forever"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
