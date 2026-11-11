// ============================================================================
// IndexedDB Storage & Per-User Isolation (cloud_chat_v1)
// Follows Contract Section 2 & Section 6
// ============================================================================

import type { Message, PendingMessage, RoomCursorRecord } from '../types/contract.js';
import { compareSeq, parseSeq } from '../types/contract.js';

const DB_NAME = 'cloud_chat_v1';
const DB_VERSION = 1;

export interface StoredMessageRecord extends Message {
  user_id: string;
  room_id: string;
}

let dbInstance: IDBDatabase | null = null;
let isStorageDegraded = false;

// In-Memory Fallbacks when IndexedDB is blocked or unavailable
const inMemoryMessages = new Map<string, StoredMessageRecord>();
const inMemoryCursors = new Map<string, RoomCursorRecord>();
const inMemoryPending = new Map<string, PendingMessage>();

function msgKey(userId: string, roomId: string, messageId: string): string {
  return `${userId}:${roomId}:${messageId}`;
}

function cursorKey(userId: string, roomId: string): string {
  return `${userId}:${roomId}`;
}

function pendingKey(userId: string, roomId: string, clientMessageId: string): string {
  return `${userId}:${roomId}:${clientMessageId}`;
}

/**
 * Initializes the IndexedDB database.
 * Falls back to in-memory maps if IndexedDB is blocked (e.g. in certain private browsing modes).
 */
export async function initStorage(): Promise<{ degraded: boolean }> {
  if (typeof indexedDB === 'undefined') {
    isStorageDegraded = true;
    return { degraded: true };
  }

  try {
    dbInstance = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        // 1. messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', {
            keyPath: ['user_id', 'room_id', 'message_id']
          });
          messageStore.createIndex('by_user_room', ['user_id', 'room_id'], { unique: false });
        }

        // 2. cursors store
        if (!db.objectStoreNames.contains('cursors')) {
          db.createObjectStore('cursors', {
            keyPath: ['user_id', 'room_id']
          });
        }

        // 3. pending_sends store
        if (!db.objectStoreNames.contains('pending_sends')) {
          const pendingStore = db.createObjectStore('pending_sends', {
            keyPath: ['user_id', 'room_id', 'client_message_id']
          });
          pendingStore.createIndex('by_user', 'user_id', { unique: false });
          pendingStore.createIndex('by_user_room', ['user_id', 'room_id'], { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open request blocked'));
    });

    isStorageDegraded = false;
    return { degraded: false };
  } catch (err) {
    console.warn('IndexedDB initialization failed; falling back to in-memory storage (degraded mode):', err);
    isStorageDegraded = true;
    return { degraded: true };
  }
}

/**
 * Verifies that the stored contiguous cursor is strictly justified by locally stored contiguous messages.
 * Implements Contract Section 6 Rule 9:
 * If local messages are missing or non-contiguous (e.g. storage cleared, or intermediate gap),
 * returns the verified contiguous sequence up to which messages actually exist consecutively starting from #1.
 * If storedCursor exceeds verified contiguous sequence, resets to verified contiguous sequence.
 */
export function computeVerifiedContiguousSeq(messages: Message[], storedCursor: string): string {
  if (messages.length === 0) {
    return '0';
  }

  const sorted = [...messages].sort((a, b) => compareSeq(a.seq, b.seq));
  let contiguous = 0n;

  for (const m of sorted) {
    let s: bigint;
    try {
      s = parseSeq(m.seq);
    } catch {
      break;
    }

    if (s === contiguous + 1n) {
      contiguous = s;
    } else if (s > contiguous + 1n) {
      break;
    }
  }

  let storedBig = 0n;
  try {
    storedBig = parseSeq(storedCursor || '0');
  } catch {
    storedBig = 0n;
  }

  if (storedBig > contiguous) {
    return contiguous.toString();
  }

  return storedCursor;
}

/**
 * Loads the stored messages, contiguous recovery cursor, and pending outbox sends for a room.
 * Enforces Section 6 Rule 9: If stored messages are empty or non-contiguous,
 * contiguousSeq is verified against actual contiguous prefix starting from #1 and reset if inconsistent.
 */
export async function loadRoomState(
  userId: string,
  roomId: string
): Promise<{ messages: Message[]; contiguousSeq: string; pending: PendingMessage[] }> {
  if (isStorageDegraded || !dbInstance) {
    // Memory fallback
    const messages: Message[] = [];
    for (const item of inMemoryMessages.values()) {
      if (item.user_id === userId && item.room_id === roomId) {
        messages.push(item);
      }
    }

    messages.sort((a, b) => compareSeq(a.seq, b.seq));

    const cur = inMemoryCursors.get(cursorKey(userId, roomId));
    const rawContiguousSeq = cur ? cur.contiguous_seq : '0';

    // Section 6 Rule 9 contiguous prefix verification
    const verifiedSeq = computeVerifiedContiguousSeq(messages, rawContiguousSeq);
    let contiguousSeq = verifiedSeq;

    if (cur && cur.contiguous_seq !== verifiedSeq) {
      cur.contiguous_seq = verifiedSeq;
      cur.updated_at = new Date().toISOString();
    }

    const pending: PendingMessage[] = [];
    for (const item of inMemoryPending.values()) {
      if (item.user_id === userId && item.room_id === roomId) {
        pending.push(item);
      }
    }

    return { messages, contiguousSeq, pending };
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['messages', 'cursors', 'pending_sends'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const cursorStore = tx.objectStore('cursors');
      const pendingStore = tx.objectStore('pending_sends');

      const msgIndex = msgStore.index('by_user_room');
      const pendingIndex = pendingStore.index('by_user_room');

      const msgReq = msgIndex.getAll(IDBKeyRange.only([userId, roomId]));
      const cursorReq = cursorStore.get([userId, roomId]);
      const pendingReq = pendingIndex.getAll(IDBKeyRange.only([userId, roomId]));

      tx.oncomplete = () => {
        const storedMsgs: StoredMessageRecord[] = msgReq.result || [];
        const cursorRecord: RoomCursorRecord | undefined = cursorReq.result;
        const pendingList: PendingMessage[] = pendingReq.result || [];

        const messages: Message[] = storedMsgs.map((m) => ({
          message_id: m.message_id,
          room_id: m.room_id,
          seq: m.seq,
          sender: m.sender,
          client_message_id: m.client_message_id,
          text: m.text,
          image: m.image,
          created_at: m.created_at
        }));

        messages.sort((a, b) => compareSeq(a.seq, b.seq));

        const rawContiguousSeq = cursorRecord ? cursorRecord.contiguous_seq : '0';

        // Section 6 Rule 9 contiguous prefix verification:
        // If stored messages are missing, empty, or have gaps, reset cursor to verified contiguous sequence
        const verifiedSeq = computeVerifiedContiguousSeq(messages, rawContiguousSeq);
        let contiguousSeq = verifiedSeq;

        if (rawContiguousSeq !== verifiedSeq) {
          try {
            const resetTx = dbInstance!.transaction(['cursors'], 'readwrite');
            resetTx.objectStore('cursors').put({
              user_id: userId,
              room_id: roomId,
              contiguous_seq: verifiedSeq,
              updated_at: new Date().toISOString()
            } as RoomCursorRecord);
          } catch (e) {
            console.error('Failed to persist verified cursor in IDB:', e);
          }
        }

        resolve({
          messages,
          contiguousSeq,
          pending: pendingList
        });
      };

      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Saves messages and updates the contiguous cursor atomically in a single readwrite transaction.
 */
export async function saveMessagesAndCursorAtomic(
  userId: string,
  roomId: string,
  messages: Message[],
  newContiguousSeq: string
): Promise<void> {
  if (isStorageDegraded || !dbInstance) {
    for (const msg of messages) {
      inMemoryMessages.set(msgKey(userId, roomId, msg.message_id), {
        ...msg,
        user_id: userId,
        room_id: roomId
      });
    }
    inMemoryCursors.set(cursorKey(userId, roomId), {
      user_id: userId,
      room_id: roomId,
      contiguous_seq: newContiguousSeq,
      updated_at: new Date().toISOString()
    });
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['messages', 'cursors'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const cursorStore = tx.objectStore('cursors');

      for (const msg of messages) {
        const record: StoredMessageRecord = {
          ...msg,
          sender: { ...msg.sender },
          image: msg.image ? { ...msg.image } : undefined,
          user_id: userId,
          room_id: roomId
        };
        msgStore.put(record);
      }

      const cursorRecord: RoomCursorRecord = {
        user_id: userId,
        room_id: roomId,
        contiguous_seq: newContiguousSeq,
        updated_at: new Date().toISOString()
      };
      cursorStore.put(cursorRecord);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Saves or updates a pending outbox message.
 */
export async function savePendingSend(item: PendingMessage): Promise<void> {
  if (isStorageDegraded || !dbInstance) {
    inMemoryPending.set(pendingKey(item.user_id, item.room_id, item.client_message_id), { ...item });
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['pending_sends'], 'readwrite');
      tx.objectStore('pending_sends').put({ ...item });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Removes a pending send from the outbox after it is confirmed or explicitly cancelled/edited.
 */
export async function removePendingSend(
  userId: string,
  roomId: string,
  clientMessageId: string
): Promise<void> {
  if (isStorageDegraded || !dbInstance) {
    inMemoryPending.delete(pendingKey(userId, roomId, clientMessageId));
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['pending_sends'], 'readwrite');
      tx.objectStore('pending_sends').delete([userId, roomId, clientMessageId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves all pending outbox sends across all rooms for a given user.
 */
export async function getAllPendingForUser(userId: string): Promise<PendingMessage[]> {
  if (isStorageDegraded || !dbInstance) {
    const list: PendingMessage[] = [];
    for (const item of inMemoryPending.values()) {
      if (item.user_id === userId) {
        list.push(item);
      }
    }
    return list;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['pending_sends'], 'readonly');
      const index = tx.objectStore('pending_sends').index('by_user');
      const req = index.getAll(IDBKeyRange.only(userId));

      tx.oncomplete = () => resolve(req.result || []);
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clears all pending outbox messages for a user upon logout.
 */
export async function clearUserPendingData(userId: string): Promise<void> {
  if (isStorageDegraded || !dbInstance) {
    for (const [k, v] of inMemoryPending.entries()) {
      if (v.user_id === userId) {
        inMemoryPending.delete(k);
      }
    }
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance!.transaction(['pending_sends'], 'readwrite');
      const store = tx.objectStore('pending_sends');
      const index = store.index('by_user');
      const req = index.openCursor(IDBKeyRange.only(userId));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}
