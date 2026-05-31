const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { authMiddleware } = require("./middleware/auth");
const { supabase } = require("./lib/supabase");
const {
  createPreview,
  streamDownloadZip,
  updateCollectionUri,
  computeRarity,
  listJobEditions,
  startWorker,
} = require("./workers/jobProcessor");
const { deleteProject, clearProjectGenerations } = require("./services/projectService");
const { parseTraitFilename } = require("@basturds/engine");

const app = express();
const PORT = process.env.PORT || 3001;

// Render (and most PaaS) sit behind a reverse proxy that sets X-Forwarded-For.
// Trust the first hop so express-rate-limit can read the real client IP instead
// of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
app.set("trust proxy", 1);

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173").split(",");

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some((o) => origin.startsWith(o.trim()))) {
        cb(null, true);
      } else {
        cb(null, true);
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
});
app.use("/api", limiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/preview", authMiddleware, async (req, res) => {
  try {
    const { projectId, selectedTraits } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: "projectId required" });
    }

    const result = await createPreview(projectId, req.userId, selectedTraits);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveEditionSize(projectId, project, editionSize) {
  // When the project defines multiple layer configurations ("characters"),
  // the total edition size is the sum of their per-config counts.
  const { data: layerConfigs } = await supabase
    .from("layer_configurations")
    .select("edition_count")
    .eq("project_id", projectId);

  return layerConfigs && layerConfigs.length
    ? layerConfigs.reduce((sum, c) => sum + (c.edition_count || 0), 0)
    : editionSize || project.edition_size;
}

async function queueGenerationJob(projectId, size) {
  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({ project_id: projectId, edition_size: size, status: "queued" })
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from("projects")
    .update({ status: "generating", edition_size: size })
    .eq("id", projectId);

  return job;
}

app.post("/api/projects/:id/generate", authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.id;

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_id", req.userId)
      .single();

    if (!project) return res.status(404).json({ error: "Project not found" });

    const size = await resolveEditionSize(projectId, project, req.body.editionSize);
    if (!size || size < 1) {
      return res.status(400).json({ error: "Edition size must be at least 1" });
    }

    const maxSize = parseInt(process.env.MAX_EDITION_SIZE || "10000", 10);
    if (size > maxSize) {
      return res.status(400).json({ error: `Max edition size is ${maxSize}` });
    }

    const { data: runningJobs } = await supabase
      .from("generation_jobs")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["queued", "running"]);

    if (runningJobs?.length) {
      return res.status(409).json({ error: "Generation already in progress" });
    }

    const job = await queueGenerationJob(projectId, size);
    res.status(202).json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/regenerate", authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.id;

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_id", req.userId)
      .single();

    if (!project) return res.status(404).json({ error: "Project not found" });

    const size = await resolveEditionSize(projectId, project, req.body.editionSize);
    if (!size || size < 1) {
      return res.status(400).json({ error: "Edition size must be at least 1" });
    }

    const maxSize = parseInt(process.env.MAX_EDITION_SIZE || "10000", 10);
    if (size > maxSize) {
      return res.status(400).json({ error: `Max edition size is ${maxSize}` });
    }

    // Wipe all previous jobs, editions and generated files first.
    await clearProjectGenerations(projectId, req.userId);

    const job = await queueGenerationJob(projectId, size);
    res.status(202).json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", authMiddleware, async (req, res) => {
  try {
    const result = await deleteProject(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    const status = err.message === "Project not found" ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get("/api/jobs/:id", authMiddleware, async (req, res) => {
  try {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("*, projects(owner_id)")
      .eq("id", req.params.id)
      .single();

    if (!job || job.projects.owner_id !== req.userId) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id/download", authMiddleware, async (req, res) => {
  try {
    await streamDownloadZip(req.params.id, req.userId, res);
  } catch (err) {
    if (!res.headersSent) {
      const status = err.message === "Job not found" ? 404 : 500;
      res.status(status).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

app.post("/api/jobs/:id/update-uri", authMiddleware, async (req, res) => {
  try {
    const { baseUri, namePrefix, description } = req.body || {};
    const result = await updateCollectionUri(req.params.id, req.userId, {
      baseUri,
      namePrefix,
      description,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id/rarity", authMiddleware, async (req, res) => {
  try {
    const result = await computeRarity(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id/editions", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 48, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await listJobEditions(req.params.id, req.userId, limit, offset);
    res.json(result);
  } catch (err) {
    const status = err.message === "Job not found" ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.post("/api/projects/:id/sync-traits", authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.id;
    const { traits: uploadedTraits } = req.body;

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_id", req.userId)
      .single();

    if (!project) return res.status(404).json({ error: "Project not found" });

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

    await supabase
      .from("projects")
      .update({ status: "ready" })
      .eq("id", projectId);

    res.json({ layers: Object.values(layerMap), traits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Defense in depth: a stray rejection from a single request handler must never
// crash the process and kill an in-flight generation job.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

app.listen(PORT, () => {
  console.log(`Basturds API running on port ${PORT}`);
  startWorker();
});
