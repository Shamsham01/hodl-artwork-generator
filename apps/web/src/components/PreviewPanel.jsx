import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Stack } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { renderSingle } from "@basturds/engine-browser";
import {
  loadProjectConfig,
  filterLayersForJob,
} from "../lib/projectConfig.js";
import {
  buildTraitsByLayerForCompositor,
  buildTraitsByLayerForPreview,
} from "../lib/clientGeneration.js";
import { useAuth } from "../context/AuthContext";

const PREVIEW_COUNT = 4;

function layersForConfig(config, allLayers) {
  const order = Array.isArray(config?.layers_order) ? config.layers_order : [];
  const names = order.map((o) => (typeof o === "string" ? o : o.name));
  return names.map((name) => allLayers.find((l) => l.name === name)).filter(Boolean);
}

function defaultSelections(layerList) {
  const next = {};
  layerList.forEach((l) => {
    if (l.traits.length) next[l.name] = l.traits[0].name;
  });
  return next;
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export default function PreviewPanel({ projectId }) {
  const { user } = useAuth();
  const [layers, setLayers] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [selections, setSelections] = useState({});
  const [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const previewInFlight = useRef(false);

  useEffect(() => {
    loadLayers();
  }, [projectId]);

  async function loadLayers() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    const { data: traitData } = await supabase
      .from("traits")
      .select("*")
      .in("layer_id", (layerData || []).map((l) => l.id));

    const enriched = (layerData || []).map((layer) => ({
      ...layer,
      traits: (traitData || []).filter((t) => t.layer_id === layer.id),
    }));

    const { data: configData } = await supabase
      .from("layer_configurations")
      .select("id, label, layers_order, sort_order")
      .eq("project_id", projectId)
      .order("sort_order");

    setLayers(enriched);
    setConfigs(configData || []);

    const firstConfig = configData?.[0] || null;
    setActiveConfigId(firstConfig?.id ?? null);

    const visible = firstConfig ? layersForConfig(firstConfig, enriched) : enriched;
    setSelections(defaultSelections(visible));
    setPreviews([]);
  }

  const activeConfig = configs.find((c) => c.id === activeConfigId) || null;

  const visibleLayers = useMemo(() => {
    if (activeConfig) return layersForConfig(activeConfig, layers);
    return layers;
  }, [activeConfig, layers]);

  function handleConfigChange(configId) {
    const config = configs.find((c) => c.id === configId);
    setActiveConfigId(configId);
    setSelections(defaultSelections(layersForConfig(config, layers)));
    setPreviews([]);
    setError(null);
  }

  async function resolveJobConfig() {
    const previewLayerNames = visibleLayers.map((l) => l.name);
    const { project, layers: dbLayers, traitsByLayerId, config } =
      await loadProjectConfig(projectId, user.id, { previewLayerNames });

    let jobConfig = config;
    if (activeConfigId) {
      const { data: lc } = await supabase
        .from("layer_configurations")
        .select("layers_order")
        .eq("id", activeConfigId)
        .single();
      if (lc?.layers_order) {
        const order = lc.layers_order
          .map((entry) => {
            const name = typeof entry === "string" ? entry : entry.name;
            const match = dbLayers.find((l) => l.name === name);
            return match ? { name, options: match.options || {} } : null;
          })
          .filter(Boolean);
        jobConfig = {
          ...config,
          layerConfigurations: [{ growEditionSizeTo: 1, layersOrder: order }],
        };
      }
    }

    const { layers: jobLayers, traitsByLayerId: jobTraits } = filterLayersForJob(
      dbLayers,
      traitsByLayerId,
      jobConfig
    );

    return { project, jobConfig, jobLayers, jobTraits };
  }

  async function generatePreviews({ random = true, count = PREVIEW_COUNT } = {}) {
    if (previewInFlight.current || !user?.id) return;
    previewInFlight.current = true;
    setLoading(true);
    setError(null);
    setPreviews([]);

    try {
      const { project, jobConfig, jobLayers, jobTraits } = await resolveJobConfig();

      const traitsByLayer = random
        ? await buildTraitsByLayerForCompositor(jobLayers, jobTraits, {
            canvasWidth: project.canvas_width,
            canvasHeight: project.canvas_height,
          })
        : await buildTraitsByLayerForPreview(
            jobLayers,
            jobTraits,
            selections,
            project
          );

      const results = [];
      for (let i = 0; i < count; i++) {
        const result = await renderSingle(jobConfig, {
          traitsByLayer,
          selectedTraits: random ? undefined : selections,
          edition: i + 1,
        });
        const image = await blobToDataUrl(result.blob);
        results.push({ image, attributes: result.attributes });
      }

      setPreviews(results);
    } catch (err) {
      setError(err.message || "Preview failed");
    }

    previewInFlight.current = false;
    setLoading(false);
  }

  if (!layers.length) {
    return (
      <p className="text-sm text-zinc-500 text-center py-8">
        Upload layers to preview
      </p>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="space-y-4">
        {configs.length > 0 && (
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Character</label>
            <div className="relative">
              <Stack
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <select
                value={activeConfigId || ""}
                onChange={(e) => handleConfigChange(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white"
              >
                {configs.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {c.label || `Character ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Only layers assigned to this character are shown, in back → front order.
            </p>
          </div>
        )}

        {visibleLayers.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No layers selected for this character. Add layers on the Layers tab.
          </p>
        ) : (
          visibleLayers.map((layer) => (
            <div key={layer.id}>
              <label className="text-xs text-zinc-500 block mb-1">{layer.name}</label>
              <select
                value={selections[layer.name] || ""}
                onChange={(e) =>
                  setSelections((prev) => ({ ...prev, [layer.name]: e.target.value }))
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                {layer.traits.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => generatePreviews({ random: true, count: PREVIEW_COUNT })}
            disabled={loading || visibleLayers.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Eye size={18} weight="bold" />
            {loading
              ? "Rendering..."
              : `Preview ${PREVIEW_COUNT} random editions`}
          </button>
          <button
            onClick={() => generatePreviews({ random: false, count: 1 })}
            disabled={loading || visibleLayers.length === 0}
            className="w-full rounded-full border border-zinc-700 px-6 py-2.5 text-sm text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50"
          >
            Preview current selections
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="space-y-4">
        {previews.length === 0 ? (
          <div className="bezel-outer">
            <div className="bezel-inner aspect-square flex items-center justify-center overflow-hidden">
              <p className="text-sm text-zinc-600 text-center px-6">
                Click preview to render {PREVIEW_COUNT} random editions using your
                restriction rules.
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`grid gap-3 ${
              previews.length > 1 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {previews.map((preview, index) => (
              <div key={index} className="bezel-outer">
                <div className="bezel-inner aspect-square flex flex-col overflow-hidden">
                  <img
                    src={preview.image}
                    alt={`Preview ${index + 1}`}
                    className="w-full flex-1 object-contain"
                  />
                  {preview.attributes?.length > 0 && (
                    <div className="p-2 flex flex-wrap gap-1 border-t border-zinc-800">
                      {preview.attributes.map((a) => (
                        <span
                          key={`${index}-${a.trait_type}-${a.value}`}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400"
                        >
                          {a.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
