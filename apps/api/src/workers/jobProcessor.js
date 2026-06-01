const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require("archiver");
const { renderSingle, renderBatch, createThumbnail, filterDNAOptions } = require("@basturds/engine");
const { supabase } = require("../lib/supabase");
const { ensureTraitThumbs, traitThumbPath, listLayerThumbNames } = require("../services/thumbnails");
const {
  loadProjectConfig,
  downloadProjectAssets,
  downloadSelectedTraits,
  cleanupTempDir,
  cleanupStaleTempDirs,
  filterLayersForJob,
} = require("../services/projectService");

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10);
const MAX_EDITION_SIZE = parseInt(process.env.MAX_EDITION_SIZE || "10000", 10);
// Long TTL so gallery URLs stay stable and hit the Supabase CDN cache instead
// of re-downloading the same thumb with a new signed token every poll.
const SIGNED_URL_TTL = parseInt(process.env.SIGNED_URL_TTL || "604800", 10);
let activeJobs = 0;

// Serialize preview renders on this instance. Parallel previews on a 512 MB
// Render box OOM-kill the process; the browser then reports a CORS error because
// the dead connection has no Access-Control-Allow-Origin header.
let previewQueue = Promise.resolve();

function enqueuePreview(work) {
  const run = previewQueue.then(work);
  previewQueue = run.catch(() => {});
  return run;
}

async function loadResumeState(jobId) {
  const { data: editions } = await supabase
    .from("generated_editions")
    .select("edition_number, dna, metadata")
    .eq("job_id", jobId)
    .order("edition_number");

  if (!editions?.length) return null;

  const dnaList = new Set();
  const doneEditions = new Set();
  const metadataList = [];
  for (const e of editions) {
    if (e.dna) dnaList.add(filterDNAOptions(e.dna));
    doneEditions.add(e.edition_number);
    if (e.metadata) metadataList.push(e.metadata);
  }

  return { completed: editions.length, dnaList, doneEditions, metadataList };
}

async function processJob(jobId) {
  if (activeJobs >= MAX_CONCURRENT) return;

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select("*, projects(*)")
    .eq("id", jobId)
    .eq("status", "queued")
    .single();

  if (error || !job) return;

  activeJobs++;

  try {
    await supabase
      .from("generation_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    await supabase
      .from("projects")
      .update({ status: "generating" })
      .eq("id", job.project_id);

    const { project, layers, traitsByLayerId, config, totalEditions } =
      await loadProjectConfig(job.project_id, job.projects.owner_id);

    if (config.layerConfigurations.length === 1) {
      config.layerConfigurations[0].growEditionSizeTo = job.edition_size;
    }

    const { layers: jobLayers, traitsByLayerId: jobTraits } = filterLayersForJob(
      layers,
      traitsByLayerId,
      config
    );

    const assets = await downloadProjectAssets(
      project,
      jobLayers,
      jobTraits,
      job.projects.owner_id
    );

    const outputPrefix = `${job.projects.owner_id}/${job.project_id}/jobs/${jobId}`;

    const resumeState = await loadResumeState(jobId);
    if (resumeState?.completed) {
      console.log(
        `Resuming job ${jobId} from edition ${resumeState.completed + 1} (${resumeState.completed} already done)`
      );
    }

    const { metadataList } = await renderBatch(config, {
      traitsByLayer: assets.traitsByLayer,
      resumeState,
      onProgress: async ({ completed, total, edition }) => {
        await supabase
          .from("generation_jobs")
          .update({ progress: completed })
          .eq("id", jobId);
      },
      onEdition: async ({ edition, dna, metadata, buffer }) => {
        const { data: existing } = await supabase
          .from("generated_editions")
          .select("id")
          .eq("job_id", jobId)
          .eq("edition_number", edition)
          .maybeSingle();

        if (existing) return;

        const imagePath = `${outputPrefix}/images/${edition}.png`;
        const thumbPath = `${outputPrefix}/thumbs/${edition}.webp`;
        const metadataPath = `${outputPrefix}/json/${edition}.json`;

        await supabase.storage
          .from("generations")
          .upload(imagePath, buffer, { contentType: "image/png", upsert: true });

        // Small WebP thumbnail for the gallery so the UI never downloads the
        // full-resolution PNG just to show a preview tile.
        try {
          const thumb = await createThumbnail(buffer, 256);
          await supabase.storage
            .from("generations")
            .upload(thumbPath, thumb, { contentType: "image/webp", upsert: true });
        } catch (thumbErr) {
          console.error(`Thumbnail failed for #${edition}:`, thumbErr.message);
        }

        await supabase.storage
          .from("generations")
          .upload(metadataPath, JSON.stringify(metadata, null, 2), {
            contentType: "application/json",
            upsert: true,
          });

        await supabase.from("generated_editions").insert({
          job_id: jobId,
          edition_number: edition,
          dna,
          image_path: imagePath,
          metadata_path: metadataPath,
          metadata,
        });
      },
    });

    if (metadataList?.length) {
      await supabase.storage
        .from("generations")
        .upload(
          `${outputPrefix}/json/_metadata.json`,
          JSON.stringify(metadataList, null, 2),
          { contentType: "application/json", upsert: true }
        );
    }

    const finalTotal =
      config.layerConfigurations.length === 1 ? job.edition_size : totalEditions;

    await supabase
      .from("generation_jobs")
      .update({
        status: "complete",
        progress: finalTotal,
        edition_size: finalTotal,
        output_prefix: outputPrefix,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase
      .from("projects")
      .update({ status: "complete" })
      .eq("id", job.project_id);
  } catch (err) {
    console.error(`Job ${jobId} failed:`, err);
    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase
      .from("projects")
      .update({ status: "failed" })
      .eq("id", job.project_id);
  } finally {
    activeJobs--;
    pollQueuedJobs();
  }
}

async function pollQueuedJobs() {
  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_CONCURRENT - activeJobs);

  for (const job of jobs || []) {
    processJob(job.id);
  }
}

/**
 * On (re)start, no job is actually running inside this fresh process. Any row
 * still marked "running" is orphaned from a deploy/restart/OOM-kill. Re-queue
 * it so the worker resumes from the last uploaded edition instead of failing
 * the whole run and locking the UI.
 */
async function recoverOrphanedJobs() {
  const { data: orphaned } = await supabase
    .from("generation_jobs")
    .select("id, project_id, edition_size, progress")
    .eq("status", "running");

  if (!orphaned?.length) return;

  for (const job of orphaned) {
    const { count } = await supabase
      .from("generated_editions")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id);

    const done = count || 0;
    const target = job.edition_size || 0;

    if (target > 0 && done >= target) {
      console.log(`Finalizing orphaned job ${job.id} (${done}/${target} editions)`);
      await supabase
        .from("generation_jobs")
        .update({
          status: "complete",
          progress: target,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      await supabase
        .from("projects")
        .update({ status: "complete" })
        .eq("id", job.project_id);
      continue;
    }

    console.log(`Re-queuing orphaned job ${job.id} (${done}/${target} editions done)`);
    await supabase
      .from("generation_jobs")
      .update({
        status: "queued",
        progress: done,
        error_message: null,
      })
      .eq("id", job.id);
    await supabase
      .from("projects")
      .update({ status: "generating" })
      .eq("id", job.project_id);
  }
}

function startWorker() {
  cleanupStaleTempDirs();
  recoverOrphanedJobs()
    .catch((err) => console.error("Orphaned job recovery failed:", err))
    .finally(() => {
      setInterval(pollQueuedJobs, 5000);
      pollQueuedJobs();
    });
}

async function createPreview(projectId, userId, selectedTraits, configurationId = null) {
  return enqueuePreview(async () => {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("owner_id", userId)
      .single();

    if (!project) throw new Error("Project not found");

    const { data: layers } = await supabase
      .from("project_layers")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    const { data: layerConfigRecords } = await supabase
      .from("layer_configurations")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    const allLayersOrder = (layers || []).map((l) => ({
      name: l.name,
      options: l.options || {},
    }));

    let layersOrder = allLayersOrder;

    if (configurationId && layerConfigRecords?.length) {
      const record = layerConfigRecords.find((c) => c.id === configurationId);
      if (record) {
        const order = Array.isArray(record.layers_order) ? record.layers_order : [];
        layersOrder = order
          .map((entry) => {
            const name = typeof entry === "string" ? entry : entry.name;
            const match = (layers || []).find((l) => l.name === name);
            return match ? { name, options: match.options || {} } : null;
          })
          .filter(Boolean);
      }
    } else if (layerConfigRecords?.length) {
      const order = Array.isArray(layerConfigRecords[0].layers_order)
        ? layerConfigRecords[0].layers_order
        : [];
      layersOrder = order
        .map((entry) => {
          const name = typeof entry === "string" ? entry : entry.name;
          const match = (layers || []).find((l) => l.name === name);
          return match ? { name, options: match.options || {} } : null;
        })
        .filter(Boolean);
    }

    const previewLayerNames = layersOrder.map((l) => l.name);
    const { traitsByLayerId, config } = await loadProjectConfig(projectId, userId, {
      previewLayerNames,
    });

    config.layerConfigurations = [{ growEditionSizeTo: 1, layersOrder }];

    const orderedLayers = layersOrder
      .map((lo) => (layers || []).find((l) => l.name === lo.name))
      .filter(Boolean);

    const filteredSelections = {};
    for (const { name } of layersOrder) {
      if (selectedTraits[name] != null) filteredSelections[name] = selectedTraits[name];
    }

    const assets = await downloadSelectedTraits(
      orderedLayers,
      traitsByLayerId,
      filteredSelections
    );

    try {
      const result = await renderSingle(config, {
        traitsByLayer: assets.traitsByLayer,
        selectedTraits: filteredSelections,
        edition: 1,
      });

      return {
        image: result.buffer.toString("base64"),
        dna: result.dna,
        metadata: result.metadata,
        attributes: result.attributes,
      };
    } finally {
      cleanupTempDir(assets.tmpDir);
    }
  });
}

function sanitizeFolderName(name) {
  return (name || "collection").replace(/[^a-z0-9_-]/gi, "_") || "collection";
}

/**
 * Zip a render output directory so every {edition}.png and {edition}.json
 * lives side by side in a single folder named after the collection.
 */
function buildBundle(buildDir, outPath, collectionName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const root = sanitizeFolderName(collectionName);

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    const imagesDir = path.join(buildDir, "images");
    const jsonDir = path.join(buildDir, "json");

    if (fs.existsSync(imagesDir)) {
      for (const file of fs.readdirSync(imagesDir)) {
        archive.file(path.join(imagesDir, file), { name: `${root}/${file}` });
      }
    }
    if (fs.existsSync(jsonDir)) {
      for (const file of fs.readdirSync(jsonDir)) {
        archive.file(path.join(jsonDir, file), { name: `${root}/${file}` });
      }
    }

    archive.finalize();
  });
}

/**
 * Build the download bundle from Supabase storage + DB metadata and stream it
 * straight to the HTTP response as a single zip. Every {edition}.png and
 * {edition}.json lands in one folder (required for MultiversX IPFS uploads).
 */
async function streamDownloadZip(jobId, userId, res) {
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("*, projects(*)")
    .eq("id", jobId)
    .single();

  if (!job || job.projects.owner_id !== userId) {
    throw new Error("Job not found");
  }

  const { data: editions } = await supabase
    .from("generated_editions")
    .select("*")
    .eq("job_id", jobId)
    .order("edition_number");

  if (!editions || editions.length === 0) {
    throw new Error("No generated files found for this collection");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basturds-zip-"));
  try {
    const buildDir = path.join(tmpDir, "build");
    fs.mkdirSync(path.join(buildDir, "images"), { recursive: true });
    fs.mkdirSync(path.join(buildDir, "json"), { recursive: true });

    const allMetadata = [];
    for (const edition of editions) {
      const { data: img } = await supabase.storage
        .from("generations")
        .download(edition.image_path);
      if (img) {
        fs.writeFileSync(
          path.join(buildDir, "images", `${edition.edition_number}.png`),
          Buffer.from(await img.arrayBuffer())
        );
      }
      fs.writeFileSync(
        path.join(buildDir, "json", `${edition.edition_number}.json`),
        JSON.stringify(edition.metadata, null, 2)
      );
      allMetadata.push(edition.metadata);
    }

    fs.writeFileSync(
      path.join(buildDir, "json", "_metadata.json"),
      JSON.stringify(allMetadata, null, 2)
    );

    const zipPath = path.join(tmpDir, "bundle.zip");
    await buildBundle(buildDir, zipPath, job.projects?.name);

    const filename = `${sanitizeFolderName(job.projects?.name)}.zip`;
    await new Promise((resolve, reject) => {
      res.download(zipPath, filename, (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    cleanupTempDir(tmpDir);
  }
}

/**
 * Re-point a generated collection at a new IPFS / base URI (and optionally
 * rename / re-describe it), rewriting every metadata JSON in storage and DB.
 * Mirrors the HashLips utils/update_info.js script.
 */
async function updateCollectionUri(jobId, userId, { baseUri, namePrefix, description }) {
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("*, projects(*)")
    .eq("id", jobId)
    .single();

  if (!job || job.projects.owner_id !== userId) {
    throw new Error("Job not found");
  }

  const { data: editions } = await supabase
    .from("generated_editions")
    .select("*")
    .eq("job_id", jobId)
    .order("edition_number");

  const allMetadata = [];
  for (const edition of editions || []) {
    const meta = { ...edition.metadata };
    if (namePrefix != null) meta.name = `${namePrefix} #${edition.edition_number}`;
    if (description != null) meta.description = description;
    if (baseUri != null) meta.image = `${baseUri}/${edition.edition_number}.png`;

    await supabase.storage
      .from("generations")
      .upload(edition.metadata_path, JSON.stringify(meta, null, 2), {
        contentType: "application/json",
        upsert: true,
      });

    await supabase
      .from("generated_editions")
      .update({ metadata: meta })
      .eq("id", edition.id);

    allMetadata.push(meta);
  }

  await supabase.storage
    .from("generations")
    .upload(
      `${job.output_prefix}/json/_metadata.json`,
      JSON.stringify(allMetadata, null, 2),
      { contentType: "application/json", upsert: true }
    );

  const projectUpdate = {};
  if (baseUri != null) projectUpdate.base_uri = baseUri;
  if (namePrefix != null) projectUpdate.name_prefix = namePrefix;
  if (description != null) projectUpdate.description = description;
  if (Object.keys(projectUpdate).length) {
    await supabase.from("projects").update(projectUpdate).eq("id", job.project_id);
  }

  return { updated: (editions || []).length };
}

/**
 * Rarity breakdown computed from generated metadata (utils/rarity.js).
 */
async function computeRarity(jobId, userId) {
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("*, projects(owner_id)")
    .eq("id", jobId)
    .single();

  if (!job || job.projects.owner_id !== userId) {
    throw new Error("Job not found");
  }

  const { data: editions } = await supabase
    .from("generated_editions")
    .select("metadata")
    .eq("job_id", jobId);

  const total = editions?.length || 0;
  const counts = {};
  for (const edition of editions || []) {
    const attrs = edition.metadata?.attributes || [];
    for (const attr of attrs) {
      counts[attr.trait_type] = counts[attr.trait_type] || {};
      counts[attr.trait_type][attr.value] =
        (counts[attr.trait_type][attr.value] || 0) + 1;
    }
  }

  const rarity = Object.entries(counts).map(([traitType, values]) => ({
    trait_type: traitType,
    values: Object.entries(values)
      .map(([value, count]) => ({
        value,
        count,
        percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => a.count - b.count),
  }));

  return { total, rarity };
}

/**
 * Return a page of generated editions with short-lived signed thumbnail URLs
 * so the UI can show a results gallery without downloading the whole zip.
 */
async function listJobEditions(
  jobId,
  userId,
  limit = 48,
  offset = 0,
  { latest = false, thumbsOnly = false } = {}
) {
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, projects(owner_id)")
    .eq("id", jobId)
    .single();

  if (!job || job.projects.owner_id !== userId) {
    throw new Error("Job not found");
  }

  const { count } = await supabase
    .from("generated_editions")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  const { data: editions } = await supabase
    .from("generated_editions")
    .select("edition_number, image_path, metadata")
    .eq("job_id", jobId)
    .order("edition_number", { ascending: !latest })
    .range(latest ? 0 : offset, latest ? limit - 1 : offset + limit - 1);

  const toThumbPath = (imagePath) =>
    imagePath.replace("/images/", "/thumbs/").replace(/\.png$/i, ".webp");

  const imagePaths = (editions || []).map((e) => e.image_path);
  const thumbPaths = imagePaths.map(toThumbPath);

  const thumbMap = {};
  if (thumbPaths.length) {
    const { data: signedThumbs } = await supabase.storage
      .from("generations")
      .createSignedUrls(thumbPaths, SIGNED_URL_TTL);
    (signedThumbs || []).forEach((s) => {
      if (s.path && s.signedUrl) thumbMap[s.path] = s.signedUrl;
    });
  }

  const missingFull = thumbsOnly
    ? []
    : (editions || [])
        .filter((e) => !thumbMap[toThumbPath(e.image_path)])
        .map((e) => e.image_path);

  const fullMap = {};
  if (missingFull.length) {
    const { data: signedFull } = await supabase.storage
      .from("generations")
      .createSignedUrls(missingFull, SIGNED_URL_TTL);
    (signedFull || []).forEach((s) => {
      if (s.path && s.signedUrl) fullMap[s.path] = s.signedUrl;
    });
  }

  const result = (editions || [])
    .slice()
    .sort((a, b) => a.edition_number - b.edition_number)
    .map((e) => {
    const thumb = thumbMap[toThumbPath(e.image_path)];
    const full = fullMap[e.image_path];
    return {
      edition: e.edition_number,
      url: thumb || full || null,
      fullUrl: full || null,
      name: e.metadata?.name || `#${e.edition_number}`,
      attributes: e.metadata?.attributes || [],
    };
  });

  return { editions: result, total: count || 0 };
}

async function signStorageUrls(bucket, paths, ttl) {
  const urlByPath = {};
  const CHUNK = 50;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const { data: signed, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(chunk, ttl);
    if (error) {
      console.error(`signStorageUrls batch ${i}:`, error.message);
      continue;
    }
    for (const s of signed || []) {
      if (s.path && s.signedUrl) urlByPath[s.path] = s.signedUrl;
      if (s.error) console.error(`Sign failed ${s.path}:`, s.error);
    }
  }
  return urlByPath;
}

/**
 * Signed WebP preview URLs for every trait in a layer. Creates missing thumbs
 * on first request (one-time cost); the Traits page never loads full PNGs.
 */
async function listTraitPreviews(projectId, layerId, userId, { offset = 0, limit = 40 } = {}) {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .single();

  if (!project) throw new Error("Project not found");

  const { data: layer } = await supabase
    .from("project_layers")
    .select("id")
    .eq("id", layerId)
    .eq("project_id", projectId)
    .single();

  if (!layer) throw new Error("Layer not found");

  const { data: traits } = await supabase
    .from("traits")
    .select("id, storage_path")
    .eq("layer_id", layerId)
    .order("name");

  if (!traits?.length) return { urls: {}, total: 0, offset, limit, hasMore: false };

  const slice = traits.slice(offset, offset + limit);
  const layerDir = traits[0].storage_path.slice(0, traits[0].storage_path.lastIndexOf("/"));
  const existingThumbs = await listLayerThumbNames(layerDir);

  const missing = slice
    .filter((t) => !existingThumbs.has(traitThumbPath(t.storage_path).split("/").pop()))
    .map((t) => t.storage_path);

  if (missing.length) {
    await ensureTraitThumbs(missing, { concurrency: 4, existingNames: existingThumbs });
  }

  const thumbPaths = slice.map((t) => traitThumbPath(t.storage_path));
  const urlByPath = await signStorageUrls("layer-assets", thumbPaths, SIGNED_URL_TTL);

  const urls = {};
  for (const trait of slice) {
    const path = traitThumbPath(trait.storage_path);
    urls[trait.id] = urlByPath[path] || null;
  }

  return {
    urls,
    total: traits.length,
    offset,
    limit,
    hasMore: offset + limit < traits.length,
  };
}

module.exports = {
  startWorker,
  processJob,
  pollQueuedJobs,
  createPreview,
  streamDownloadZip,
  updateCollectionUri,
  computeRarity,
  listJobEditions,
  listTraitPreviews,
};
