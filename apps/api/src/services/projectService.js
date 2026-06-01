const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { supabase } = require("../lib/supabase");

const ASSET_CACHE_ROOT = path.join(os.tmpdir(), "basturds-cache");

// A short fingerprint of a project's trait set. Changes whenever traits are
// added, removed or renamed (which changes the image files we must download).
// Trait weight changes don't alter the files, so they don't bust the cache.
function layersVersion(layers, traitsByLayerId) {
  const parts = [];
  for (const layer of layers) {
    for (const t of traitsByLayerId[layer.id] || []) parts.push(t.storage_path);
  }
  parts.sort();
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

// Keep only the current version's folder for a project to bound disk usage.
function pruneOldCacheVersions(projectDir, keepVersion) {
  try {
    if (!fs.existsSync(projectDir)) return;
    for (const entry of fs.readdirSync(projectDir)) {
      if (entry !== keepVersion) {
        fs.rmSync(path.join(projectDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // best-effort cleanup
  }
}

async function loadProjectConfig(projectId, userId) {
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

  const layerIds = (layers || []).map((l) => l.id);
  const { data: traits } = await supabase
    .from("traits")
    .select("*")
    .in("layer_id", layerIds.length ? layerIds : ["00000000-0000-0000-0000-000000000000"]);

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
    return {
      when: { layer: r.trigger_layer, element: triggerOf(r) },
      excludeElements: r.payload.excludeElements || {},
    };
  });

  const allLayersOrder = (layers || []).map((l) => ({
    name: l.name,
    options: l.options || {},
  }));

  // Build the layerConfigurations array (multiple "characters"). Each config
  // grows the collection cumulatively, mirroring HashLips' config.js. Falls
  // back to a single configuration over all layers for legacy projects.
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

  return { project, layers, traitsByLayerId, config, totalEditions, allLayersOrder, layerConfigRecords: layerConfigs || [] };
}

/**
 * Make the project's trait images available on local disk, cached by a version
 * fingerprint of the trait set. Repeated generate/regenerate runs for the same
 * layers reuse the cached files instead of re-downloading everything from
 * Storage — the biggest avoidable source of egress while iterating.
 *
 * The returned layersDir is a persistent cache directory and must NOT be
 * deleted by the caller; only the per-job build directory should be cleaned up.
 */
async function downloadProjectAssets(project, layers, traitsByLayerId, userId) {
  const version = layersVersion(layers, traitsByLayerId);
  const projectDir = path.join(ASSET_CACHE_ROOT, String(project.id));
  const layersDir = path.join(projectDir, version);
  const marker = path.join(layersDir, ".complete");
  const cached = fs.existsSync(marker);

  if (!cached && fs.existsSync(layersDir)) {
    // Remove any partial download from a previous interrupted run.
    fs.rmSync(layersDir, { recursive: true, force: true });
  }
  fs.mkdirSync(layersDir, { recursive: true });

  const traitsByLayer = {};

  for (const layer of layers) {
    const layerPath = path.join(layersDir, layer.name);
    fs.mkdirSync(layerPath, { recursive: true });
    traitsByLayer[layer.name] = [];

    const layerTraits = traitsByLayerId[layer.id] || [];
    for (let i = 0; i < layerTraits.length; i++) {
      const trait = layerTraits[i];
      const localPath = path.join(layerPath, trait.filename);

      if (!cached || !fs.existsSync(localPath)) {
        const { data, error } = await supabase.storage
          .from("layer-assets")
          .download(trait.storage_path);

        if (error) {
          console.error(`Failed to download ${trait.storage_path}:`, error.message);
          continue;
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        fs.writeFileSync(localPath, buffer);
      }

      traitsByLayer[layer.name].push({
        id: i,
        name: trait.name,
        filename: trait.filename,
        path: localPath,
        weight: trait.weight,
      });
    }
  }

  if (!cached) {
    fs.writeFileSync(marker, new Date().toISOString());
  }
  pruneOldCacheVersions(projectDir, version);

  return { layersDir, traitsByLayer, cached };
}

/**
 * Download only the selected trait per layer (fast path for single previews).
 * selectedTraits: { LAYER_NAME: "TraitName" }. Falls back to the first trait.
 */
async function downloadSelectedTraits(layers, traitsByLayerId, selectedTraits = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basturds-prev-"));
  const layersDir = path.join(tmpDir, "layers");
  fs.mkdirSync(layersDir, { recursive: true });

  const traitsByLayer = {};

  for (const layer of layers) {
    const layerTraits = traitsByLayerId[layer.id] || [];
    if (!layerTraits.length) {
      traitsByLayer[layer.name] = [];
      continue;
    }

    const wantedName = selectedTraits[layer.name];
    const trait =
      layerTraits.find((t) => t.name === wantedName) || layerTraits[0];

    const layerPath = path.join(layersDir, layer.name);
    fs.mkdirSync(layerPath, { recursive: true });
    const localPath = path.join(layerPath, trait.filename);

    const { data, error } = await supabase.storage
      .from("layer-assets")
      .download(trait.storage_path);

    if (error) {
      throw new Error(`Failed to download ${trait.storage_path}: ${error.message}`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    traitsByLayer[layer.name] = [
      {
        id: 0,
        name: trait.name,
        filename: trait.filename,
        path: localPath,
        weight: trait.weight,
      },
    ];
  }

  return { tmpDir, layersDir, traitsByLayer };
}

function cleanupTempDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Recursively collect every object path under a storage prefix.
 * Supabase's list() is not recursive, so we walk folders ourselves.
 */
async function listStorageObjects(bucket, prefix) {
  const found = [];
  const stack = [prefix];

  while (stack.length) {
    const dir = stack.pop();
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(dir, { limit: 1000 });

    if (error || !data) continue;

    for (const entry of data) {
      const fullPath = dir ? `${dir}/${entry.name}` : entry.name;
      // Folders come back with a null id; files have metadata/id.
      if (entry.id === null || entry.metadata == null) {
        stack.push(fullPath);
      } else {
        found.push(fullPath);
      }
    }
  }

  return found;
}

async function removeStoragePrefix(bucket, prefix) {
  const paths = await listStorageObjects(bucket, prefix);
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    if (batch.length) {
      await supabase.storage.from(bucket).remove(batch);
    }
  }
  return paths.length;
}

/**
 * Permanently delete a whole collection: storage assets in both buckets and
 * the project row (cascades to layers, traits, restrictions, jobs, editions).
 */
async function deleteProject(projectId, userId) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .single();

  if (error || !project) throw new Error("Project not found");

  const prefix = `${userId}/${projectId}`;
  let removed = 0;
  removed += await removeStoragePrefix("layer-assets", prefix);
  removed += await removeStoragePrefix("generations", prefix);

  const { error: delError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", userId);

  if (delError) throw delError;

  return { deleted: true, filesRemoved: removed };
}

/**
 * Remove all generation output for a project: every job row (cascades to
 * generated_editions) and the job files in storage. Keeps the database clean
 * before a fresh re-generation.
 */
async function clearProjectGenerations(projectId, userId) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .single();

  if (error || !project) throw new Error("Project not found");

  await removeStoragePrefix("generations", `${userId}/${projectId}/jobs`);

  const { error: delError } = await supabase
    .from("generation_jobs")
    .delete()
    .eq("project_id", projectId);

  if (delError) throw delError;

  return { cleared: true };
}

module.exports = {
  loadProjectConfig,
  downloadProjectAssets,
  downloadSelectedTraits,
  cleanupTempDir,
  deleteProject,
  clearProjectGenerations,
};
