// IndexedDB 轻量封装：大图 dataURL 存这里（容量按磁盘算，GB 级），
// localStorage 只留图层结构 + 缩略图（~5MB 上限再也压不到原图）。
const DB_NAME = "malachite";
const STORE = "blobs";
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

export async function idbSet(key: string, val: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(val, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbGet(key: string): Promise<string | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const q = t.objectStore(STORE).get(key);
    q.onsuccess = () => resolve((q.result as string) ?? null);
    q.onerror = () => reject(q.error);
  });
}
