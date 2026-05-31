const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require("archiver");
const { renderSingle, renderBatch } = require("@basturds/engine");
const { supabase } = require("../lib/supabase");
const {
  loadProjectConfig,
  downloadProjectAssets,
  downloadSelectedTraits,
  cleanupTempDir,
} = require("../services/projectService");

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10);
const MAX_EDITION_SIZE = parseInt(process.env.MAX_EDITION_SIZE || "10000", 10);
let activeJobs = 0;

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
  let tmpDir = null;

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

    // Single-configuration (legacy) projects honour the per-job edition size;
    // multi-configuration projects derive the total from their configs.
    if (config.layerConfigurations.length === 1) {
      config.layerConfigurations[0].growEditionSizeTo = job.edition_size;
    }

    const assets = await downloadProjectAssets(
      project,
      layers,
      traitsByLayerId,
      job.projects.owner_id
    );
    tmpDir = assets.tmpDir;

    const outputDir = path.join(tmpDir, "build");
    const outputPrefix = `${job.projects.owner_id}/${job.project_id}/jobs/${jobId}`;

    await renderBatch(config, {
      traitsByLayer: assets.traitsByLayer,
      outputDir,
      onProgress: async ({ completed, total, edition }) => {
        await supabase
          .from("generation_jobs")
          .update({ progress: completed })
          .eq("id", jobId);
      },
      onEdition: async ({ edition, dna, metadata, buffer }) => {
        const imagePath = `${outputPrefix}/images/${edition}.png`;
        const metadataPath = `${outputPrefix}/json/${edition}.json`;

        await supabase.storage
          .from("generations")
          .upload(imagePath, buffer, { contentType: "image/png", upsert: true });

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

    const metadataFile = path.join(outputDir, "json", "_metadata.json");
    if (fs.existsSync(metadataFile)) {
      await supabase.storage
        .from("generations")
        .upload(
          `${outputPrefix}/json/_metadata.json`,
          fs.readFileSync(metadataFile),
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
    cleanupTempDir(tmpDir);
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
 * still marked "running" is orphaned from a previous crash/restart/deploy, so
 * fail it — otherwise the project stays locked in "generating" forever and the
 * UI shows a frozen progress bar with no way to recover.
 */
async function recoverOrphanedJobs() {
  const { data: orphaned } = await supabase
    .from("generation_jobs")
    .update({
      status: "failed",
      error_message: "Worker restarted before this job completed",
      completed_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .select("project_id");

  const projectIds = [...new Set((orphaned || []).map((j) => j.project_id))];
  if (projectIds.length) {
    await supabase
      .from("projects")
      .update({ status: "ready" })
      .in("id", projectIds);
  }
}

function startWorker() {
  recoverOrphanedJobs()
    .catch((err) => console.error("Orphaned job recovery failed:", err))
    .finally(() => {
      setInterval(pollQueuedJobs, 5000);
      pollQueuedJobs();
    });
}

async function createPreview(projectId, userId, selectedTraits) {
  const { layers, traitsByLayerId, config, allLayersOrder } =
    await loadProjectConfig(projectId, userId);

  // Preview always renders the full layer stack (every uploaded layer),
  // regardless of how the collection is split into configurations.
  if (allLayersOrder?.length) {
    config.layerConfigurations = [
      { growEditionSizeTo: 1, layersOrder: allLayersOrder },
    ];
  }

  // Only download the selected trait per layer (not the whole collection),
  // so a single preview renders in well under a second.
  const assets = await downloadSelectedTraits(
    layers,
    traitsByLayerId,
    selectedTraits
  );

  try {
    const result = await renderSingle(config, {
      traitsByLayer: assets.traitsByLayer,
      selectedTraits,
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
async function listJobEditions(jobId, userId, limit = 48, offset = 0) {
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
    .order("edition_number")
    .range(offset, offset + limit - 1);

  const paths = (editions || []).map((e) => e.image_path);
  const urlMap = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from("generations")
      .createSignedUrls(paths, 3600);
    (signed || []).forEach((s) => {
      if (s.path && s.signedUrl) urlMap[s.path] = s.signedUrl;
    });
  }

  const result = (editions || []).map((e) => ({
    edition: e.edition_number,
    url: urlMap[e.image_path] || null,
    name: e.metadata?.name || `#${e.edition_number}`,
    attributes: e.metadata?.attributes || [],
  }));

  return { editions: result, total: count || 0 };
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
};
