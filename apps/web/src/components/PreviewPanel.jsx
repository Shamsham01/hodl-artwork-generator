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

function TraitTags({ attributes, keyPrefix = "" }) {
  if (!attributes?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1 mt-2">
      {attributes.map((a) => (
        <li key={`${keyPrefix}${a.trait_type}-${a.value}`}>
          <span className="text-[10px] leading-tight px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-500">
            <span className="text-zinc-600">{a.trait_type}:</span> {a.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function PreviewPanel({ projectId }) {
  const { user } = useAuth();
  const [layers, setLayers] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [activeConfigId, setActiveConfigId] = useState(null);
  const [selections, setSelections] = useState({});
  const [randomPreviews, setRandomPreviews] = useState([]);
  const [singlePreview, setSinglePreview] = useState(null);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [randomError, setRandomError] = useState(null);
  const [singleError, setSingleError] = useState(null);
  const randomInFlight = useRef(false);
  const singleInFlight = useRef(false);

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
    setRandomPreviews([]);
    setSinglePreview(null);
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
    setRandomPreviews([]);
    setSinglePreview(null);
    setRandomError(null);
    setSingleError(null);
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

  async function generateRandomPreviews() {
    if (randomInFlight.current || !user?.id) return;
    randomInFlight.current = true;
    setLoadingRandom(true);
    setRandomError(null);
    setRandomPreviews([]);

    try {
      const { project, jobConfig, jobLayers, jobTraits } = await resolveJobConfig();
      const traitsByLayer = await buildTraitsByLayerForCompositor(
        jobLayers,
        jobTraits,
        {
          canvasWidth: project.canvas_width,
          canvasHeight: project.canvas_height,
        }
      );

      const results = [];
      for (let i = 0; i < PREVIEW_COUNT; i++) {
        const result = await renderSingle(jobConfig, {
          traitsByLayer,
          edition: i + 1,
        });
        results.push({
          image: await blobToDataUrl(result.blob),
          attributes: result.attributes,
        });
      }
      setRandomPreviews(results);
    } catch (err) {
      setRandomError(err.message || "Random preview failed");
    }

    randomInFlight.current = false;
    setLoadingRandom(false);
  }

  async function generateSinglePreview() {
    if (singleInFlight.current || !user?.id) return;
    singleInFlight.current = true;
    setLoadingSingle(true);
    setSingleError(null);

    try {
      const { project, jobConfig, jobLayers, jobTraits } = await resolveJobConfig();
      const traitsByLayer = await buildTraitsByLayerForPreview(
        jobLayers,
        jobTraits,
        selections,
        project
      );

      const result = await renderSingle(jobConfig, {
        traitsByLayer,
        selectedTraits: selections,
        edition: 1,
      });

      setSinglePreview({
        image: await blobToDataUrl(result.blob),
        attributes: result.attributes,
      });
    } catch (err) {
      setSingleError(err.message || "Preview failed");
    }

    singleInFlight.current = false;
    setLoadingSingle(false);
  }

  if (!layers.length) {
    return (
      <p className="text-sm text-zinc-500 text-center py-8">
        Upload layers to preview
      </p>
    );
  }

  const characterSelect = configs.length > 0 && (
    <div className="w-full sm:max-w-xs">
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
    </div>
  );

  return (
    <div className="space-y-10 w-full">
      {/* —— Random collection review —— */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Collection preview</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Random editions with your restriction rules — quick visual QA before
            generating the full collection.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          {characterSelect}
          <button
            onClick={generateRandomPreviews}
            disabled={loadingRandom || visibleLayers.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Eye size={18} weight="bold" />
            {loadingRandom
              ? "Rendering..."
              : `Preview ${PREVIEW_COUNT} random editions`}
          </button>
        </div>

        {randomError && <p className="text-sm text-red-400">{randomError}</p>}

        {randomPreviews.length === 0 ? (
          <div className="bezel-outer">
            <div className="bezel-inner aspect-[2/1] min-h-[180px] flex items-center justify-center">
              <p className="text-sm text-zinc-600 text-center px-6">
                Generate {PREVIEW_COUNT} random samples to review how the collection
                might look.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            {randomPreviews.map((preview, index) => (
              <div key={index} className="space-y-1.5 min-w-0">
                <div className="bezel-outer">
                  <div className="bezel-inner aspect-square flex items-center justify-center overflow-hidden">
                    <img
                      src={preview.image}
                      alt={`Random preview ${index + 1}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
                <TraitTags attributes={preview.attributes} keyPrefix={`r${index}-`} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* —— Targeted single preview —— */}
      <section className="bezel-outer">
        <div className="bezel-inner p-6 lg:p-8">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-white">Targeted preview</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Pick exact traits to test a combination — useful when building rules on
              the Filters tab.
            </p>
          </div>

          {visibleLayers.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No layers selected for this character. Add layers on the Layers tab.
            </p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                {visibleLayers.map((layer) => (
                  <div key={layer.id}>
                    <label className="text-xs text-zinc-500 block mb-1">
                      {layer.name}
                    </label>
                    <select
                      value={selections[layer.name] || ""}
                      onChange={(e) =>
                        setSelections((prev) => ({
                          ...prev,
                          [layer.name]: e.target.value,
                        }))
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
                ))}

                <button
                  onClick={generateSinglePreview}
                  disabled={loadingSingle}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Eye size={18} weight="bold" />
                  {loadingSingle ? "Rendering..." : "Preview"}
                </button>

                {singleError && (
                  <p className="text-sm text-red-400">{singleError}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="bezel-outer">
                  <div className="bezel-inner aspect-square flex items-center justify-center overflow-hidden">
                    {singlePreview?.image ? (
                      <img
                        src={singlePreview.image}
                        alt="Targeted preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <p className="text-sm text-zinc-600 text-center px-6">
                        Choose traits and click Preview to render one edition.
                      </p>
                    )}
                  </div>
                </div>
                {singlePreview?.attributes && (
                  <TraitTags attributes={singlePreview.attributes} keyPrefix="s-" />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
