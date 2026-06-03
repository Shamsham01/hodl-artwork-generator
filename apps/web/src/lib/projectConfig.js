import { supabase } from "./supabase";
import { parseTraitFilename } from "@basturds/engine-core";

function layerNamesFromConfig(config) {
  const names = new Set();
  for (const lc of config.layerConfigurations || []) {
    for (const lo of lc.layersOrder || []) {
      names.add(typeof lo === "string" ? lo : lo.name);
    }
  }
  return names;
}

export function filterLayersForJob(layers, traitsByLayerId, config) {
  const names = layerNamesFromConfig(config);
  if (!names.size) return { layers, traitsByLayerId };
  const jobLayers = layers.filter((l) => names.has(l.name));
  const jobTraits = {};
  for (const l of jobLayers) {
    jobTraits[l.id] = traitsByLayerId[l.id] || [];
  }
  return { layers: jobLayers, traitsByLayerId: jobTraits };
}

export async function loadProjectConfig(projectId, userId, options = {}) {
  const { previewLayerNames = null } = options;

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .single();

  if (error || !project) throw new Error("Project not found");

  const { data: layers } = await supabase
    .from("project_layers")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order");

  const { data: restrictions } = await supabase
    .from("layer_restrictions")
    .select("*")
    .eq("project_id", projectId);

  const { data: layerConfigs } = await supabase
    .from("layer_configurations")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order");

  const traitLayerIds = previewLayerNames?.length
    ? (layers || [])
        .filter((l) => previewLayerNames.includes(l.name))
        .map((l) => l.id)
    : (layers || []).map((l) => l.id);

  const { data: traits } = await supabase
    .from("traits")
    .select("*")
    .in(
      "layer_id",
      traitLayerIds.length ? traitLayerIds : ["00000000-0000-0000-0000-000000000000"]
    );

  const traitsByLayerId = {};
  (traits || []).forEach((t) => {
    if (!traitsByLayerId[t.layer_id]) traitsByLayerId[t.layer_id] = [];
    traitsByLayerId[t.layer_id].push(t);
  });

  const triggerOf = (r) => {
    const fromPayload = r.payload?.triggerElements;
    if (Array.isArray(fromPayload) && fromPayload.length) return fromPayload;
    return r.trigger_element;
  };

  const layerRestrictions = (restrictions || []).map((r) => {
    if (r.restriction_type === "exclude_layers") {
      return {
        when: { layer: r.trigger_layer, element: triggerOf(r) },
        excludeLayers: r.payload.excludeLayers || [],
      };
    }
    const allowedWhenTriggered = r.payload.allowedWhenTriggered || {};
    return {
      when: { layer: r.trigger_layer, element: triggerOf(r) },
      excludeElements: r.payload.excludeElements || {},
      lockExclusiveToTrigger: !!r.payload.lockExclusiveToTrigger,
      allowedWhenTriggered,
    };
  });

  const allLayersOrder = (layers || []).map((l) => ({
    name: l.name,
    options: l.options || {},
  }));

  let layerConfigurations;
  let totalEditions;
  if (layerConfigs && layerConfigs.length) {
    let cumulative = 0;
    layerConfigurations = layerConfigs.map((c) => {
      cumulative += c.edition_count || 0;
      const order = Array.isArray(c.layers_order) ? c.layers_order : [];
      const layersOrder = order
        .map((entry) => {
          const name = typeof entry === "string" ? entry : entry.name;
          const match = (layers || []).find((l) => l.name === name);
          return match ? { name, options: match.options || {} } : null;
        })
        .filter(Boolean);
      return { growEditionSizeTo: cumulative, layersOrder };
    });
    totalEditions = cumulative;
  } else {
    layerConfigurations = [
      { growEditionSizeTo: project.edition_size, layersOrder: allLayersOrder },
    ];
    totalEditions = project.edition_size;
  }

  const gen = project.gen_config || {};

  const config = {
    format: {
      width: project.canvas_width,
      height: project.canvas_height,
      smoothing: gen.smoothing ?? false,
    },
    baseUri: project.base_uri,
    description: project.description,
    namePrefix: project.name_prefix,
    network: project.network || "mvx",
    extraMetadata: project.extra_metadata || {},
    solanaMetadata: project.solana_metadata || {},
    layerConfigurations,
    layerRestrictions,
    rarityDelimiter: gen.rarityDelimiter || "#",
    uniqueDnaTorrance: gen.uniqueDnaTorrance || 10000,
    shuffleLayerConfigurations: gen.shuffleLayerConfigurations ?? false,
    background: {
      generate: gen.background?.generate ?? true,
      brightness: gen.background?.brightness || "80%",
      static: gen.background?.static ?? false,
      default: gen.background?.default || "#000000",
    },
    debugLogs: false,
    text: {
      only: gen.text?.only ?? false,
      color: gen.text?.color || "#ffffff",
      size: gen.text?.size ?? 20,
      xGap: gen.text?.xGap ?? 40,
      yGap: gen.text?.yGap ?? 40,
      align: gen.text?.align || "left",
      baseline: gen.text?.baseline || "top",
      weight: gen.text?.weight || "regular",
      family: gen.text?.family || "Courier",
      spacer: gen.text?.spacer || " => ",
    },
  };

  return {
    project,
    layers: layers || [],
    traitsByLayerId,
    config,
    totalEditions,
    allLayersOrder,
    layerConfigRecords: layerConfigs || [],
  };
}

export async function resolveEditionSize(projectId, project, editionSize) {
  const { data: layerConfigs } = await supabase
    .from("layer_configurations")
    .select("edition_count")
    .eq("project_id", projectId);

  return layerConfigs && layerConfigs.length
    ? layerConfigs.reduce((sum, c) => sum + (c.edition_count || 0), 0)
    : editionSize || project.edition_size;
}

export { parseTraitFilename };
