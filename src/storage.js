const stores = ['books', 'contents', 'progress'];

export function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paper-shelf', 1);
    request.onupgradeneeded = () => {
      for (const name of stores) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('书库正被其他页面使用。'));
  });
}

function value(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function listBooks(db) {
  const transaction = db.transaction(['books', 'progress']);
  const [books, progress] = await Promise.all([
    value(transaction.objectStore('books').getAll()),
    value(transaction.objectStore('progress').getAll())
  ]);
  const lastRead = new Map(progress.map(record => [record.id, record]));
  return books.map(book => ({ ...book, progress: lastRead.get(book.id) }));
}

export async function loadBook(db, id) {
  const transaction = db.transaction(stores);
  const [book, content, progress] = await Promise.all(stores.map(name => value(transaction.objectStore(name).get(id))));
  return book && content ? { book, content, progress } : null;
}

export async function saveBook(db, { id, title, author, format, chapters, assets, cover }) {
  const transaction = db.transaction(['books', 'contents'], 'readwrite');
  const finished = completion(transaction);
  const books = transaction.objectStore('books');
  const existing = books.getKey(id);
  let added = false;
  existing.onsuccess = () => {
    if (existing.result !== undefined) return;
    const metadata = { id, title, author, format, addedAt: Date.now(), chapterCount: chapters.length, imageCount: assets.length, cover: cover?.blob };
    books.add(metadata);
    transaction.objectStore('contents').add({ id, chapters, assets });
    added = true;
  };
  await finished;
  return added;
}

export async function saveProgress(db, progress) {
  const transaction = db.transaction(['books', 'progress'], 'readwrite');
  const finished = completion(transaction);
  const existing = transaction.objectStore('books').getKey(progress.id);
  existing.onsuccess = () => {
    if (existing.result !== undefined) transaction.objectStore('progress').put(progress);
  };
  await finished;
}

export function removeBook(db, id) {
  const transaction = db.transaction(stores, 'readwrite');
  const finished = completion(transaction);
  for (const name of stores) transaction.objectStore(name).delete(id);
  return finished;
}
