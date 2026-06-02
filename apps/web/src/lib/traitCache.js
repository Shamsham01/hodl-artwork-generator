const TRAIT_DB = "hodl-trait-cache";
const TRAIT_STORE = "traits";
const EDITION_DB = "hodl-edition-cache";
const EDITION_STORE = "editions";

function openDb(name, version, storeName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) {
        req.result.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function withStore(dbName, storeName, mode, fn) {
  const db = await openDb(dbName, 1, storeName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTraitBlob(storagePath) {
  return withStore(TRAIT_DB, TRAIT_STORE, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(storagePath);
      req.onsuccess = () => resolve(req.result?.blob ?? null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putTraitBlob(storagePath, blob) {
  return withStore(TRAIT_DB, TRAIT_STORE, "readwrite", (store) => {
    store.put({ blob, updatedAt: Date.now() }, storagePath);
  });
}

const CACHE_CONCURRENCY = 4;

async function runPool(items, worker, concurrency) {
  let index = 0;
  async function runOne() {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runOne()
  );
  await Promise.all(workers);
}

export async function ensureTraitsCached(traits, downloadFn) {
  let cached = 0;
  const missing = [];
  for (const trait of traits) {
    const existing = await getTraitBlob(trait.storage_path);
    if (existing) cached++;
    else missing.push(trait);
  }

  await runPool(missing, async (trait) => {
    const blob = await downloadFn(trait.storage_path);
    if (blob) {
      await putTraitBlob(trait.storage_path, blob);
      cached++;
    }
  }, CACHE_CONCURRENCY);

  return cached;
}

export async function saveEdition(jobId, editionNumber, pngBlob, metadata) {
  const key = `${jobId}:${editionNumber}`;
  const db = await openDb(EDITION_DB, 1, EDITION_STORE);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EDITION_STORE, "readwrite");
    const store = tx.objectStore(EDITION_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result ?? null;
      store.put(
        {
          pngBlob: pngBlob ?? existing?.pngBlob,
          metadata,
          editionNumber,
          jobId,
        },
        key
      );
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getEdition(jobId, editionNumber) {
  const key = `${jobId}:${editionNumber}`;
  return withStore(EDITION_DB, EDITION_STORE, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function listEditionNumbers(jobId) {
  const prefix = `${jobId}:`;
  return withStore(EDITION_DB, EDITION_STORE, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const numbers = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(numbers.sort((a, b) => a - b));
          return;
        }
        if (String(cursor.key).startsWith(prefix)) {
          numbers.push(cursor.value.editionNumber);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function clearEditionsForJob(jobId) {
  const prefix = `${jobId}:`;
  return withStore(EDITION_DB, EDITION_STORE, "readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const toDelete = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          for (const key of toDelete) store.delete(key);
          resolve(toDelete.length);
          return;
        }
        if (String(cursor.key).startsWith(prefix)) {
          toDelete.push(cursor.key);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function clearEditionsForProject(projectId) {
  const marker = `:${projectId}:`;
  return withStore(EDITION_DB, EDITION_STORE, "readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const toDelete = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          for (const key of toDelete) store.delete(key);
          resolve(toDelete.length);
          return;
        }
        if (String(cursor.key).includes(marker)) {
          toDelete.push(cursor.key);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}
