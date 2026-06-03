import { supabase } from "./supabase";
import { filterDNAOptions } from "@basturds/engine-core";
import {
  loadProjectConfig,
  filterLayersForJob,
  resolveEditionSize,
} from "./projectConfig.js";
import {
  ensureTraitsCached,
  getTraitBlob,
  saveEdition,
  clearEditionsForJob,
} from "./traitCache.js";
import {
  clearProjectGenerationsClient,
} from "./projectActions.js";
import { downloadLayerAsset } from "./storageDownload.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
function traitDownloadFnForCanvas(project) {
  const w = project?.canvas_width ?? 512;
  const h = project?.canvas_height ?? 512;
  return w <= 512 && h <= 512
    ? downloadTraitForPreview
    : downloadTraitFromStorage;
}

let activeWorker = null;
let activeJobId = null;

/** Full PNG — used for final batch generation output quality */
async function downloadTraitFromStorage(storagePath) {
  return downloadLayerAsset(storagePath, { preferThumb: false });
}

/** WebP thumb first — studio preview & cached trait blobs for compositing */
async function downloadTraitForPreview(storagePath) {
  return downloadLayerAsset(storagePath, { preferThumb: true });
}

async function callVerifyGeneration({ projectId, editionSize, paymentTxHash, regenerate }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ projectId, editionSize, paymentTxHash, regenerate }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to start generation");
  return data.job;
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

  return {
    completed: editions.length,
    dnaList,
    doneEditions,
    metadataList,
  };
}

function traitDefsForWorker(layers, traitsByLayerId) {
  const traitDefsByLayer = {};
  for (const layer of layers) {
    traitDefsByLayer[layer.name] = (traitsByLayerId[layer.id] || []).map((t) => ({
      name: t.name,
      filename: t.filename,
      storage_path: t.storage_path,
      weight: t.weight,
    }));
  }
  return traitDefsByLayer;
}

async function cacheAllTraits(traits, downloadFn = downloadTraitFromStorage) {
  await ensureTraitsCached(traits, downloadFn);
}

function terminateWorker() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
    activeJobId = null;
  }
}

export function isGenerationRunning() {
  return activeWorker != null;
}

export async function startClientGeneration({
  projectId,
  userId,
  editionSize,
  paymentTxHash,
  regenerate = false,
  onProgress,
  onEditionPreview,
  onComplete,
  onError,
}) {
  if (activeWorker) throw new Error("Generation already running in this tab");

  if (regenerate) {
    await clearProjectGenerationsClient(projectId, userId);
  }

  const { project, layers, traitsByLayerId, config } = await loadProjectConfig(
    projectId,
    userId
  );

  const size = await resolveEditionSize(projectId, project, editionSize);
  const { layers: jobLayers, traitsByLayerId: jobTraits } = filterLayersForJob(
    layers,
    traitsByLayerId,
    config
  );

  const allTraits = jobLayers.flatMap((l) => jobTraits[l.id] || []);
  await cacheAllTraits(allTraits, traitDownloadFnForCanvas(project));

  const job = await callVerifyGeneration({
    projectId,
    editionSize: size,
    paymentTxHash,
    regenerate,
  });

  activeJobId = job.id;
  await clearEditionsForJob(job.id);

  await supabase
    .from("generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id);

  const resumeState = await loadResumeState(job.id);
  const traitDefsByLayer = traitDefsForWorker(jobLayers, jobTraits);

  const worker = new Worker(
    new URL("../workers/generation.worker.js", import.meta.url),
    { type: "module" }
  );
  activeWorker = worker;

  const livePreviewUrls = [];

  worker.onmessage = async (event) => {
    const msg = event.data;

    if (msg.type === "progress") {
      await supabase
        .from("generation_jobs")
        .update({ progress: msg.completed })
        .eq("id", job.id);
      onProgress?.(msg);
    }

    if (msg.type === "edition") {
      await saveEdition(job.id, msg.edition, msg.blob, msg.metadata);

      const { data: existing } = await supabase
        .from("generated_editions")
        .select("id")
        .eq("job_id", job.id)
        .eq("edition_number", msg.edition)
        .maybeSingle();

      if (!existing) {
        await supabase.from("generated_editions").insert({
          job_id: job.id,
          edition_number: msg.edition,
          dna: msg.dna,
          image_path: null,
          metadata_path: null,
          metadata: msg.metadata,
        });
      }

      let previewUrl = null;
      if (msg.thumbBlob) {
        previewUrl = URL.createObjectURL(msg.thumbBlob);
        livePreviewUrls.push(previewUrl);
        while (livePreviewUrls.length > 20) {
          URL.revokeObjectURL(livePreviewUrls.shift());
        }
      }

      onEditionPreview?.({
        edition: msg.edition,
        name: msg.metadata?.name,
        url: previewUrl,
      });
    }

    if (msg.type === "complete") {
      await supabase
        .from("generation_jobs")
        .update({
          status: "complete",
          progress: size,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await supabase
        .from("projects")
        .update({ status: "complete" })
        .eq("id", projectId);

      terminateWorker();
      onComplete?.({ jobId: job.id });
    }

    if (msg.type === "error") {
      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          error_message: msg.message,
        })
        .eq("id", job.id);

      await supabase
        .from("projects")
        .update({ status: "failed" })
        .eq("id", projectId);

      terminateWorker();
      onError?.(new Error(msg.message));
    }
  };

  worker.onerror = async (err) => {
    const message = err.message || "Worker crashed";
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    terminateWorker();
    onError?.(new Error(message));
  };

  worker.postMessage({
    type: "run",
    payload: {
      config: structuredClone(config),
      traitDefsByLayer,
      resumeState: resumeState
        ? {
            completed: resumeState.completed,
            dnaList: [...resumeState.dnaList],
            doneEditions: resumeState.doneEditions,
            metadataList: resumeState.metadataList,
          }
        : null,
      editionSize: size,
    },
  });

  return job;
}

export async function resumeClientGeneration({
  projectId,
  userId,
  job,
  onProgress,
  onEditionPreview,
  onComplete,
  onError,
}) {
  if (activeWorker) throw new Error("Generation already running");
  if (job.status !== "running" && job.status !== "queued") {
    throw new Error("Job is not resumable");
  }

  const { project, layers, traitsByLayerId, config } = await loadProjectConfig(
    projectId,
    userId
  );

  const { layers: jobLayers, traitsByLayerId: jobTraits } = filterLayersForJob(
    layers,
    traitsByLayerId,
    config
  );

  const allTraits = jobLayers.flatMap((l) => jobTraits[l.id] || []);
  await cacheAllTraits(allTraits, traitDownloadFnForCanvas(project));

  activeJobId = job.id;

  await supabase
    .from("generation_jobs")
    .update({ status: "running" })
    .eq("id", job.id);

  const resumeState = await loadResumeState(job.id);
  const traitDefsByLayer = traitDefsForWorker(jobLayers, jobTraits);

  const worker = new Worker(
    new URL("../workers/generation.worker.js", import.meta.url),
    { type: "module" }
  );
  activeWorker = worker;

  worker.onmessage = async (event) => {
    const msg = event.data;
    if (msg.type === "progress") {
      await supabase
        .from("generation_jobs")
        .update({ progress: msg.completed })
        .eq("id", job.id);
      onProgress?.(msg);
    }
    if (msg.type === "edition") {
      await saveEdition(job.id, msg.edition, msg.blob, msg.metadata);
      const { data: existing } = await supabase
        .from("generated_editions")
        .select("id")
        .eq("job_id", job.id)
        .eq("edition_number", msg.edition)
        .maybeSingle();
      if (!existing) {
        await supabase.from("generated_editions").insert({
          job_id: job.id,
          edition_number: msg.edition,
          dna: msg.dna,
          image_path: null,
          metadata_path: null,
          metadata: msg.metadata,
        });
      }
      let previewUrl = null;
      if (msg.thumbBlob) {
        previewUrl = URL.createObjectURL(msg.thumbBlob);
      }
      onEditionPreview?.({
        edition: msg.edition,
        name: msg.metadata?.name,
        url: previewUrl,
      });
    }
    if (msg.type === "complete") {
      await supabase
        .from("generation_jobs")
        .update({
          status: "complete",
          progress: job.edition_size,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      terminateWorker();
      onComplete?.({ jobId: job.id });
    }
    if (msg.type === "error") {
      await supabase
        .from("generation_jobs")
        .update({ status: "failed", error_message: msg.message })
        .eq("id", job.id);
      terminateWorker();
      onError?.(new Error(msg.message));
    }
  };

  worker.postMessage({
    type: "run",
    payload: {
      config: structuredClone(config),
      traitDefsByLayer,
      resumeState: resumeState
        ? {
            completed: resumeState.completed,
            dnaList: [...resumeState.dnaList],
            doneEditions: resumeState.doneEditions,
            metadataList: resumeState.metadataList,
          }
        : null,
      editionSize: job.edition_size,
    },
  });
}

export async function buildTraitsByLayerForCompositor(
  layers,
  traitsByLayerId,
  { canvasWidth = 512, canvasHeight = 512 } = {}
) {
  const allTraits = layers.flatMap((l) => traitsByLayerId[l.id] || []);
  const downloadFn =
    canvasWidth <= 512 && canvasHeight <= 512
      ? downloadTraitForPreview
      : downloadTraitFromStorage;
  await ensureTraitsCached(allTraits, downloadFn);

  const traitsByLayer = {};
  for (const layer of layers) {
    const traits = traitsByLayerId[layer.id] || [];
    traitsByLayer[layer.name] = [];
    for (let i = 0; i < traits.length; i++) {
      const t = traits[i];
      const blob = await getTraitBlob(t.storage_path);
      if (!blob) {
        throw new Error(`Could not load "${t.name}" from cache.`);
      }
      traitsByLayer[layer.name].push({
        id: i,
        name: t.name,
        filename: t.filename,
        path: t.storage_path,
        imageSource: blob,
        weight: t.weight ?? 1,
      });
    }
  }
  return traitsByLayer;
}

export async function buildTraitsByLayerForPreview(
  layers,
  traitsByLayerId,
  selectedTraits = null,
  project = null
) {
  const traitsByLayer = {};

  const traitsToFetch = [];
  for (const layer of layers) {
    const traits = traitsByLayerId[layer.id] || [];
    if (selectedTraits?.[layer.name]) {
      const picked = traits.find((t) => t.name === selectedTraits[layer.name]);
      if (picked) traitsToFetch.push(picked);
    } else {
      traitsToFetch.push(...traits);
    }
  }

  const downloadFn = project
    ? traitDownloadFnForCanvas(project)
    : downloadTraitForPreview;
  await ensureTraitsCached(traitsToFetch, downloadFn);

  for (const layer of layers) {
    const traits = traitsByLayerId[layer.id] || [];
    traitsByLayer[layer.name] = [];
    for (let i = 0; i < traits.length; i++) {
      const t = traits[i];
      const selected = selectedTraits?.[layer.name] === t.name;
      const blob = selected ? await getTraitBlob(t.storage_path) : null;
      if (selected && !blob) {
        throw new Error(
          `Could not load "${t.name}" from storage (try again in a few seconds).`
        );
      }
      traitsByLayer[layer.name].push({
        id: i,
        name: t.name,
        filename: t.filename,
        path: t.storage_path,
        imageSource: blob,
        weight: t.weight ?? 1,
      });
    }
  }
  return traitsByLayer;
}

export async function updateCollectionUriClient(jobId, baseUri) {
  const { data: editions } = await supabase
    .from("generated_editions")
    .select("id, edition_number, metadata")
    .eq("job_id", jobId)
    .order("edition_number");

  const updated = [];
  for (const row of editions || []) {
    const meta = { ...row.metadata };
    meta.image = `${baseUri.replace(/\/$/, "")}/${row.edition_number}.png`;
    await supabase
      .from("generated_editions")
      .update({ metadata: meta })
      .eq("id", row.id);

    await saveEdition(jobId, row.edition_number, undefined, meta);
    updated.push(meta);
  }

  return updated;
}

export { clearEditionsForJob } from "./traitCache.js";
