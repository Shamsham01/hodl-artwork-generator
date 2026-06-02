import { supabase } from "./supabase";
import { parseTraitFilename } from "@basturds/engine-core";
import { traitThumbPath } from "./traitPreviews.js";

async function createWebpThumb(pngBlob, maxSize = 256, quality = 0.72) {
  const bitmap = await createImageBitmap(pngBlob);
  const ratio = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality
    );
  });
}

export async function ensureTraitThumb(storagePath) {
  const thumbPath = traitThumbPath(storagePath);
  const { data: existing } = await supabase.storage
    .from("layer-assets")
    .list(thumbPath.slice(0, thumbPath.lastIndexOf("/")), {
      search: thumbPath.slice(thumbPath.lastIndexOf("/") + 1),
    });
  if (existing?.some((f) => f.name === thumbPath.slice(thumbPath.lastIndexOf("/") + 1))) {
    return thumbPath;
  }

  const { data, error } = await supabase.storage
    .from("layer-assets")
    .download(storagePath);
  if (error || !data) return null;

  const webp = await createWebpThumb(data);
  const { error: uploadError } = await supabase.storage
    .from("layer-assets")
    .upload(thumbPath, webp, { contentType: "image/webp", upsert: true });
  if (uploadError) return null;
  return thumbPath;
}

export async function ensureTraitThumbs(storagePaths) {
  const results = [];
  for (const path of storagePaths) {
    try {
      results.push(await ensureTraitThumb(path));
    } catch {
      // non-fatal
    }
  }
  return results;
}

export async function uploadPreviewThumb(userId, projectId, jobId, edition, webpBlob) {
  const path = `${userId}/${projectId}/previews/${jobId}/${edition}.webp`;
  const { error } = await supabase.storage
    .from("layer-assets")
    .upload(path, webpBlob, { contentType: "image/webp", upsert: true });
  if (error) return null;
  return path;
}

export async function clearPreviewThumbs(userId, projectId, jobId) {
  const prefix = `${userId}/${projectId}/previews/${jobId}`;
  const { data } = await supabase.storage.from("layer-assets").list(prefix, { limit: 1000 });
  if (!data?.length) return;
  const paths = data.map((f) => `${prefix}/${f.name}`);
  await supabase.storage.from("layer-assets").remove(paths);
}

export async function syncTraitsToProject(projectId, uploadedTraits) {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const layerNames = [...new Set(uploadedTraits.map((t) => t.layerName))];
  const layerMap = {};

  for (let i = 0; i < layerNames.length; i++) {
    const name = layerNames[i];
    const { data: layer } = await supabase
      .from("project_layers")
      .upsert(
        { project_id: projectId, name, sort_order: i, options: {} },
        { onConflict: "project_id,name" }
      )
      .select()
      .single();
    layerMap[name] = layer;
  }

  await supabase.from("traits").delete().in(
    "layer_id",
    Object.values(layerMap).map((l) => l.id)
  );

  const traitRows = uploadedTraits.map((t) => {
    const parsed = parseTraitFilename(t.filename);
    return {
      layer_id: layerMap[t.layerName].id,
      name: parsed.name,
      weight: t.weight ?? parsed.weight,
      storage_path: t.storagePath,
      filename: t.filename,
    };
  });

  const { data: traits, error } = await supabase
    .from("traits")
    .insert(traitRows)
    .select();

  if (error) throw error;

  await supabase.from("projects").update({ status: "ready" }).eq("id", projectId);

  ensureTraitThumbs(uploadedTraits.map((t) => t.storagePath)).catch(() => {});

  return { layers: Object.values(layerMap), traits };
}

export async function deleteProjectClient(projectId, userId) {
  const prefix = `${userId}/${projectId}`;

  async function removePrefix(bucket, dir) {
    const { data } = await supabase.storage.from(bucket).list(dir, { limit: 1000 });
    if (!data?.length) return;
    const files = [];
    for (const entry of data) {
      const full = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await removePrefix(bucket, full);
      } else {
        files.push(full);
      }
    }
    if (files.length) {
      await supabase.storage.from(bucket).remove(files);
    }
  }

  await removePrefix("layer-assets", prefix);

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", userId);

  if (error) throw error;
  return { deleted: true };
}

export async function clearProjectGenerationsClient(projectId, userId) {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .single();

  if (!project) throw new Error("Project not found");

  const prefix = `${userId}/${projectId}/previews`;
  const { data: previewDirs } = await supabase.storage
    .from("layer-assets")
    .list(prefix, { limit: 100 });
  if (previewDirs?.length) {
    for (const dir of previewDirs) {
      const jobPrefix = `${prefix}/${dir.name}`;
      const { data: files } = await supabase.storage
        .from("layer-assets")
        .list(jobPrefix, { limit: 1000 });
      if (files?.length) {
        await supabase.storage
          .from("layer-assets")
          .remove(files.map((f) => `${jobPrefix}/${f.name}`));
      }
    }
  }

  const { error } = await supabase
    .from("generation_jobs")
    .delete()
    .eq("project_id", projectId);

  if (error) throw error;
  return { cleared: true };
}
