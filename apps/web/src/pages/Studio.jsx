import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import FolderUpload from "../components/FolderUpload";
import LayerConfigurations from "../components/LayerConfigurations";
import TraitMatrix from "../components/TraitMatrix";
import RestrictionEditor from "../components/RestrictionEditor";
import PreviewPanel from "../components/PreviewPanel";
import GeneratePanel from "../components/GeneratePanel";
import ProjectSettingsPanel from "../components/ProjectSettingsPanel";

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "layers", label: "Layers" },
  { id: "traits", label: "Traits" },
  { id: "rules", label: "Rules" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
  { id: "generate", label: "Generate" },
];

const TAB_IDS = new Set(TABS.map((t) => t.id));

function tabFromSearchParams(searchParams) {
  const value = searchParams.get("tab");
  return value && TAB_IDS.has(value) ? value : "upload";
}

export default function Studio() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const tab = tabFromSearchParams(searchParams);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  function setActiveTab(nextTab) {
    if (!TAB_IDS.has(nextTab)) return;
    setSearchParams({ tab: nextTab }, { replace: true });
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function loadProject() {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    setProject(data);
    setLoading(false);
  }

  function handleUploadComplete() {
    setRefreshKey((k) => k + 1);
    setActiveTab("traits");
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] mesh-bg pt-28 px-4">
        <div className="max-w-6xl mx-auto animate-pulse h-96 bg-zinc-800/30 rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-[100dvh] mesh-bg pt-28 px-4 text-center">
        <p className="text-zinc-400">Project not found</p>
        <Link to="/dashboard" className="text-emerald-400 text-sm mt-4 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] mesh-bg pt-28 pb-16 px-4">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Projects
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-white">{project.name}</h1>
            <p className="text-sm text-zinc-500 mt-1">{project.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              MultiversX
            </span>
            <button
              onClick={() => setActiveTab("settings")}
              className="text-sm text-zinc-500 hover:text-white transition-colors"
            >
              Edit settings
            </button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto mb-8 pb-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-300 ${
                tab === t.id
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div key={refreshKey}>
          {tab === "upload" && (
            <FolderUpload projectId={projectId} onComplete={handleUploadComplete} />
          )}
          {tab === "layers" && <LayerConfigurations projectId={projectId} />}
          {tab === "traits" && <TraitMatrix projectId={projectId} />}
          {tab === "rules" && <RestrictionEditor projectId={projectId} />}
          {tab === "preview" && <PreviewPanel projectId={projectId} />}
          {tab === "settings" && (
            <ProjectSettingsPanel project={project} onUpdate={loadProject} />
          )}
          {tab === "generate" && (
            <GeneratePanel
              projectId={projectId}
              project={project}
              onUpdate={loadProject}
            />
          )}
        </div>
      </div>
    </div>
  );
}
