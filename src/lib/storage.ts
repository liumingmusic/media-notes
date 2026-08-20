import { openDB, type IDBPDatabase } from 'idb';
import type { NoteRecord } from '../types';

const DB_NAME = 'media-notes';
const STORE = 'notes';

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbp;
}

export async function saveNote(note: NoteRecord): Promise<void> {
  const d = await db();
  await d.put(STORE, note);
}

export async function listNotes(): Promise<NoteRecord[]> {
  const d = await db();
  const all = (await d.getAll(STORE)) as NoteRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getNote(id: string): Promise<NoteRecord | undefined> {
  const d = await db();
  return (await d.get(STORE, id)) as NoteRecord | undefined;
}

export async function deleteNote(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}
