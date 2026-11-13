// ============================================================================
// Reactive Sync & Recovery Engine (Svelte 5 Runes)
// Coordinates HTTP Client, WebSocket Client (chat.v1), and IndexedDB Storage
// Implements Section 4 (Idempotent Outbox) and Section 6 (Contiguous Recovery)
// ============================================================================

import type {
  Message,
  PendingMessage,
  Room,
  SessionInfo,
  UserSummary
} from '../types/contract.js';
import {
  compareSeq,
  generateUuid,
  parseSeq,
  validateMessageText
} from '../types/contract.js';
import {
  clearUserPendingData,
  getAllPendingForUser,
  initStorage,
  loadRoomState,
  removePendingSend,
  saveMessagesAndCursorAtomic,
  savePendingSend
} from '../storage/indexeddb.js';
import { ApiError, httpClient } from './http-client.js';
import { localDemoEnabled } from './local-demo.js';
import { wsClient, type WsState } from './ws-client.js';

export interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'ws' | 'sync' | 'http' | 'error';
  text: string;
}

export class ChatEngine {
  isUiPreview = $state(false);

  // Reactive State (Svelte 5 Runes)
  session: SessionInfo | null = $state(null);
  devUsers: UserSummary[] = $state([]);
  authLoading: boolean = $state(true);
  authError: string | null = $state(null);
  storageDegraded: boolean = $state(false);
  notificationSoundEnabled: boolean = $state(true);

  rooms: Room[] = $state([]);
  roomsNextCursor: string | null = $state(null);
  loadingMoreRooms: boolean = $state(false);
  activeRoomId: string | null = $state(null);
  messagesByRoom: Record<string, Message[]> = $state({});
  pendingByRoom: Record<string, PendingMessage[]> = $state({});
  cursorByRoom: Record<string, string> = $state({});
  subscribedRooms: Record<string, boolean> = $state({});
  revokedRooms: Record<string, string> = $state({});

  historyHasMoreByRoom: Record<string, boolean> = $state({});
  historyNextBeforeSeqByRoom: Record<string, string | null> = $state({});
  loadingHistory: boolean = $state(false);
  syncingByRoom: Record<string, boolean> = $state({});

  wsState: WsState = $state('disconnected');
  wsError: string | null = $state(null);
  lastCloseCode: number | null = $state(null);
  reconnectAttempt: number = $state(0);

  simulateTimeoutOnSend: boolean = $state(false);
  workerPaused: boolean = $state(false);
  outboxBacklogCount: number = $state(0);
  eventLog: LogEntry[] = $state([]);

  // Internal live event buffer during active HTTP sync / room subscribe (max 500 events per room)
  private liveBuffer: Record<string, Message[]> = {};
  public bufferingRoomIds: Record<string, boolean> = {};
  private simulatedDroppedIds = new Set<string>();
  private periodicSyncTimer: ReturnType<typeof setInterval> | null = null;
  private isVisibilityListenerAttached = false;
  private unreadTabMessages = new Set<string>();
  private originalTabTitle: string | null = null;
  private notificationRoomSequences = new Map<string, string>();
  private notificationMonitorGeneration = 0;
  private notificationScanRunning = false;
  private hiddenSince: number | null = null;
  private audioContext: AudioContext | null = null;
  private soundUnlockAttached = false;
  private lastNotificationSoundAt = -Infinity;
  private alertedMessageIds = new Set<string>();

  constructor() {
    this.setupWsCallbacks();
  }

  // Getters & Derived helpers
  get activeRoom(): Room | null {
    if (!this.activeRoomId) return null;
    return this.rooms.find((r) => r.room_id === this.activeRoomId) ?? null;
  }

  get activeMessages(): Message[] {
    if (!this.activeRoomId) return [];
    return this.messagesByRoom[this.activeRoomId] ?? [];
  }

  get activePending(): PendingMessage[] {
    if (!this.activeRoomId) return [];
    return this.pendingByRoom[this.activeRoomId] ?? [];
  }

  get activeCursor(): string {
    if (!this.activeRoomId) return '0';
    return this.cursorByRoom[this.activeRoomId] ?? '0';
  }

  public addLog(type: LogEntry['type'], text: string): void {
    const entry: LogEntry = {
      id: generateUuid(),
      time: new Date().toLocaleTimeString(),
      type,
      text
    };
    this.eventLog = [entry, ...this.eventLog.slice(0, 99)];
  }

  /**
   * Initializes the engine: loads storage, dev users, verifies current session,
   * restores pending outbox sends, and sets up sync timers.
   */
  public async initialize(): Promise<void> {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
      this.isUiPreview = true;
      const user = { user_id: 'preview-user', display_name: 'Demo A' };
      const peer = { user_id: 'preview-peer', display_name: 'Demo B' };
      this.session = {
        user,
        session: { expires_at: '', idle_expires_at: '' },
        csrf_token: ''
      };
      this.rooms = [
        { room_id: 'preview-dm', kind: 'dm', title: peer.display_name, membership_role: 'member', last_seq: '2' },
        { room_id: 'preview-group', kind: 'group', title: 'Project Chat', membership_role: 'owner', last_seq: '0' }
      ];
      this.activeRoomId = 'preview-dm';
      this.messagesByRoom['preview-dm'] = [
        {
          message_id: 'preview-1', room_id: 'preview-dm', seq: '1', sender: peer,
          client_message_id: 'preview-1', text: 'Hey! Welcome to the chat preview.',
          created_at: new Date().toISOString()
        },
        {
          message_id: 'preview-2', room_id: 'preview-dm', seq: '2', sender: user,
          client_message_id: 'preview-2', text: 'Thanks! I can see the conversation.',
          created_at: new Date().toISOString()
        }
      ];
      this.cursorByRoom['preview-dm'] = '2';
      this.authLoading = false;
      return;
    }

    this.authLoading = true;
    this.authError = null;
    this.setupNotificationSound();

    try {
      // 1. Initialize IndexedDB storage
      const storageInit = await initStorage();
      this.storageDegraded = storageInit.degraded;
      if (storageInit.degraded) {
        this.addLog('info', 'IndexedDB unavailable; operating in degraded in-memory mode.');
      } else {
        this.addLog('info', 'IndexedDB (cloud_chat_v1) initialized.');
      }

      if (localDemoEnabled()) {
        this.devUsers = await httpClient.fetchDevUsers();
      } else if (import.meta.env.DEV) {
        httpClient.setActiveLocalUserId(null);
      }

      // 3. Check current authentication session
      try {
        const session = await httpClient.fetchSession();
        this.session = session;
        this.addLog('info', `Session verified for user ${session.user.display_name} (${session.user.user_id})`);
        await this.onLoginSuccess();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          this.authError = error instanceof Error ? error.message : 'Session check failed';
        }
        // Not logged in or expired session
        this.session = null;
        this.addLog('info', 'No active user session. Please log in.');
      }
    } catch (err) {
      this.authError = err instanceof Error ? err.message : 'Engine initialization failed';
      this.addLog('error', `Init error: ${this.authError}`);
    } finally {
      this.authLoading = false;
    }

    this.setupVisibilityListener();
  }

  /**
   * Logs in using one of the mock dev users.
   */
  public async loginWithDevUser(userId: string): Promise<void> {
    this.authLoading = true;
    this.authError = null;
    try {
      const session = await httpClient.devLogin(userId);
      this.session = session;
      this.addLog('info', `Logged in as ${session.user.display_name} (${session.user.user_id})`);
      await this.onLoginSuccess();
    } catch (err) {
      this.authError = err instanceof Error ? err.message : 'Dev login failed';
      this.addLog('error', `Dev login error: ${this.authError}`);
      throw err;
    } finally {
      this.authLoading = false;
    }
  }

  public async loginWithPassword(email: string, password: string): Promise<void> {
    const session = await httpClient.passwordLogin(email, password);
    this.session = session;
    await this.onLoginSuccess();
  }

  /**
   * Logs out from this device or all devices.
   */
  public async logout(allDevices = false): Promise<void> {
    const userId = this.session?.user.user_id;
    try {
      await httpClient.logout(allDevices);
    } catch (err) {
      this.authError = err instanceof Error ? err.message : 'Logout failed';
      this.addLog('error', `Logout failed: ${this.authError}`);
      throw err;
    }

    if (userId) {
      try {
        await clearUserPendingData(userId);
      } catch (err) {
        console.warn('Failed to clear user pending data:', err);
      }
    }

    this.clearTabNotifications();
    this.alertedMessageIds.clear();
    this.stopNotificationMonitor();
    this.stopPeriodicSync();
    wsClient.disconnect();

    this.session = null;
    this.rooms = [];
    this.roomsNextCursor = null;
    this.loadingMoreRooms = false;
    this.activeRoomId = null;
    this.messagesByRoom = {};
    this.pendingByRoom = {};
    this.cursorByRoom = {};
    this.subscribedRooms = {};
    this.revokedRooms = {};
    this.historyHasMoreByRoom = {};
    this.historyNextBeforeSeqByRoom = {};
    this.syncingByRoom = {};
    this.liveBuffer = {};
    this.bufferingRoomIds = {};
    this.simulateTimeoutOnSend = false;
    httpClient.simulateDropAfterSend = false;
    this.workerPaused = false;
    this.outboxBacklogCount = 0;

    this.addLog('info', allDevices ? 'Logged out from all devices.' : 'Logged out from this device.');
  }

  public async refreshRooms(selectRoomId?: string): Promise<void> {
    if (!this.session) return;
    const items: Room[] = [];
    const targetRoomId = selectRoomId ?? this.activeRoomId;
    let cursor: string | null = null;
    do {
      const page: { items: Room[]; next_cursor: string | null } = await httpClient.fetchRooms(50, cursor);
      items.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor && targetRoomId && !items.some(room => room.room_id === targetRoomId));
    this.rooms = items;
    this.roomsNextCursor = cursor;
    if (selectRoomId && items.some(room => room.room_id === selectRoomId)) {
      await this.selectRoom(selectRoomId);
    } else if (this.activeRoomId && !items.some(room => room.room_id === this.activeRoomId) && !cursor) {
      wsClient.unsubscribeRoom(this.activeRoomId);
      this.activeRoomId = null;
    }
  }

  public forgetRoom(roomId: string): void {
    wsClient.unsubscribeRoom(roomId);
    this.rooms = this.rooms.filter(room => room.room_id !== roomId);
    if (this.activeRoomId === roomId) this.activeRoomId = null;
  }

  /**
   * Paginates the rooms list using next_cursor (Gap F9).
   */
  public async loadMoreRooms(): Promise<void> {
    if (!this.session || this.loadingMoreRooms || !this.roomsNextCursor) return;
    this.loadingMoreRooms = true;
    try {
      this.addLog('http', `Loading more rooms (cursor: ${this.roomsNextCursor})...`);
      const resp = await httpClient.fetchRooms(50, this.roomsNextCursor);
      const newRooms = resp.items || [];
      const existingIds = new Set(this.rooms.map((r) => r.room_id));
      const toAdd = newRooms.filter((r) => !existingIds.has(r.room_id));
      this.rooms = [...this.rooms, ...toAdd];
      this.roomsNextCursor = resp.next_cursor ?? null;
      this.addLog('http', `Loaded ${toAdd.length} more rooms (next_cursor: ${this.roomsNextCursor ?? 'none'})`);
    } catch (err) {
      this.addLog('error', `Failed to load more rooms: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.loadingMoreRooms = false;
    }
  }

  /**
   * Selects an active chat room, loading local state from IDB, subscribing over WS (awaiting 'subscribed' frame),
   * and initiating background recovery sync (Gap F1, F5).
   */
  public async selectRoom(roomId: string): Promise<void> {
    if (!this.session) return;
    this.activeRoomId = roomId;
    if (this.isUiPreview) return;

    const userId = this.session.user.user_id;

    // 1. Load stored messages, cursor, and pending outbox for this room from IDB
    const local = await loadRoomState(userId, roomId);

    // Gap F5: Reload during sending/pending -> Restore as failed_retryable with same client_message_id
    for (const p of local.pending) {
      if (p.status === 'sending' || p.status === 'pending') {
        p.status = 'failed_retryable';
        p.error_code = 'RELOAD_INTERRUPTED';
        p.error_message = 'โหลดหน้าใหม่ระหว่างรอผล — กดส่งซ้ำด้วยรหัสเดิม';
        await savePendingSend(p);
      }
    }

    this.messagesByRoom[roomId] = local.messages;
    this.cursorByRoom[roomId] = local.contiguousSeq;
    this.pendingByRoom[roomId] = local.pending;

    this.addLog(
      'info',
      `Opened room ${roomId}: loaded ${local.messages.length} messages (Cursor: #${local.contiguousSeq}, Pending: ${local.pending.length})`
    );

    // 2. Gap F1: Enable live buffering BEFORE awaiting subscribe confirmation
    this.bufferingRoomIds[roomId] = true;
    this.liveBuffer[roomId] = this.liveBuffer[roomId] || [];

    const subLastSeq = await wsClient.subscribeRoom(roomId);
    this.subscribedRooms[roomId] = true;
    if (subLastSeq) {
      this.addLog('ws', `Subscribed to room ${roomId} (last_seq: #${subLastSeq})`);
    }

    // 3. Run recovery sync per Section 6 (which merges liveBuffer and clears buffering)
    await this.syncRoom(roomId);

    // 4. If room has no messages yet, attempt initial history load
    if ((this.messagesByRoom[roomId]?.length ?? 0) === 0) {
      await this.loadOlderHistory(roomId);
    }
  }

  /**
   * Loads older message history older than before_seq.
   * Section 4 requirement: Message history paging does NOT advance the contiguous recovery cursor.
   */
  public async loadOlderHistory(roomId?: string): Promise<void> {
    const targetRoomId = roomId ?? this.activeRoomId;
    if (!targetRoomId || !this.session || this.loadingHistory) return;
    if (this.historyHasMoreByRoom[targetRoomId] === false) return;

    this.loadingHistory = true;
    try {
      const beforeSeq = this.historyNextBeforeSeqByRoom[targetRoomId] ?? null;
      this.addLog('http', `Loading history for room ${targetRoomId} (before_seq: ${beforeSeq ?? 'latest'})...`);

      const resp = await httpClient.fetchRoomHistory(targetRoomId, 50, beforeSeq);
      this.historyHasMoreByRoom[targetRoomId] = resp.has_more;
      this.historyNextBeforeSeqByRoom[targetRoomId] = resp.next_before_seq;

      if (resp.items && resp.items.length > 0) {
        const existing = this.messagesByRoom[targetRoomId] || [];
        const merged = this.dedupAndSortMessages([...resp.items, ...existing]);
        this.messagesByRoom[targetRoomId] = merged;

        // Save history messages to storage without altering contiguousSeq
        const cursor = this.cursorByRoom[targetRoomId] || '0';
        await saveMessagesAndCursorAtomic(this.session.user.user_id, targetRoomId, merged, cursor);
        this.addLog('http', `Loaded ${resp.items.length} older messages (has_more: ${resp.has_more})`);
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.code === 'ROOM_NOT_FOUND')) {
        this.handleRoomRevoked(targetRoomId, 'ROOM_NOT_FOUND');
      }
      this.addLog('error', `Failed to load history: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.loadingHistory = false;
    }
  }

  /**
   * Implements Section 6 Steps 2–5 Contiguous Recovery Protocol:
   * 1. Reads local contiguous cursor.
   * 2. Loops GET /api/v1/rooms/{id}/sync locking through_seq from page 1.
   * 3. Merges HTTP items with live event buffer.
   * 4. Deduplicates by message_id and sorts by BigInt(seq).
   * 5. Advances contiguous_seq while seq === cursor + 1n.
   * 6. Atomically saves messages + cursor in IndexedDB.
   */
  public async syncRoom(roomId: string): Promise<void> {
    if (!this.session || this.syncingByRoom[roomId]) return;

    this.syncingByRoom[roomId] = true;
    this.addLog('sync', `Starting recovery sync for room ${roomId}...`);

    try {
      const userId = this.session.user.user_id;
      let currentCursor = this.cursorByRoom[roomId] || '0';
      let lockedThroughSeq: string | null = null;
      let hasMore = true;
      let nextAfterSeq = currentCursor;
      const httpItems: Message[] = [];

      // Drain and lock live events arriving while sync is actively fetching
      this.liveBuffer[roomId] = this.liveBuffer[roomId] || [];

      while (hasMore) {
        const resp = await httpClient.fetchRoomSync(
          roomId,
          nextAfterSeq,
          lockedThroughSeq,
          100
        );

        if (!lockedThroughSeq && resp.through_seq) {
          lockedThroughSeq = resp.through_seq;
        }

        if (resp.items && resp.items.length > 0) {
          httpItems.push(...resp.items);
        }

        hasMore = resp.has_more;
        nextAfterSeq = resp.next_after_seq;

        // Safety break if server reports next_after_seq <= currentCursor
        if (hasMore && compareSeq(nextAfterSeq, currentCursor) <= 0) {
          break;
        }
      }

      // Merge HTTP items + buffered live WebSocket events
      const bufferedEvents = this.liveBuffer[roomId] || [];
      this.liveBuffer[roomId] = [];
      this.bufferingRoomIds[roomId] = false;

      const currentMessages = this.messagesByRoom[roomId] || [];
      const combined = [...currentMessages, ...httpItems, ...bufferedEvents];
      const dedupedAndSorted = this.dedupAndSortMessages(combined);
      this.messagesByRoom[roomId] = dedupedAndSorted;

      // Advance contiguous cursor:
      // While there are messages starting at cursor + 1n with no missing seq gap,
      // advance contiguous_seq.
      let newCursorBig = parseSeq(currentCursor);
      for (const msg of dedupedAndSorted) {
        const msgSeq = parseSeq(msg.seq);
        if (msgSeq === newCursorBig + 1n) {
          newCursorBig = msgSeq;
        } else if (msgSeq > newCursorBig + 1n) {
          // Sequence gap encountered! Stop advancing cursor per Section 6 Rule 5.
          break;
        }
      }

      const finalCursor = newCursorBig.toString();
      this.cursorByRoom[roomId] = finalCursor;

      // Reconcile pending outbox sends with confirmed messages
      await this.reconcilePendingSends(roomId, dedupedAndSorted);

      // Save atomically in IndexedDB
      await saveMessagesAndCursorAtomic(userId, roomId, dedupedAndSorted, finalCursor);

      this.addLog(
        'sync',
        `Sync completed for room ${roomId}: ${httpItems.length} HTTP items + ${bufferedEvents.length} live buffered. Contiguous cursor is now #${finalCursor}.`
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.code === 'ROOM_NOT_FOUND')) {
        this.handleRoomRevoked(roomId, 'ROOM_NOT_FOUND');
      }
      this.addLog('error', `Sync failed for room ${roomId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.syncingByRoom[roomId] = false;
      this.bufferingRoomIds[roomId] = false;
    }
  }

  /**
   * Validates text, generates client_message_id, stores in pending_sends in IDB,
   * fires HTTP POST, reconciles with live WebSocket events, and handles retryable vs permanent errors.
   */
  public async sendMessage(text: string, image?: File): Promise<void> {
    if (!this.session || !this.activeRoomId) {
      throw new Error('Cannot send message: no active room or session');
    }

    const roomId = this.activeRoomId;
    if (this.revokedRooms[roomId]) {
      const err = `Cannot send message: access to room ${roomId} was revoked (${this.revokedRooms[roomId]})`;
      this.addLog('error', err);
      throw new Error(err);
    }

    const userId = this.session.user.user_id;

    // 1. Text validation per Section 3
    const validation = validateMessageText(text);
    if (image ? text.includes('\u0000') || validation.byteLength > 4096 : !validation.valid) {
      const err = validation.reason || 'Invalid message text';
      this.addLog('error', `Message validation error: ${err}`);
      throw new Error(err);
    }

    // 2. Generate client_message_id (UUID v4)
    const clientMessageId = generateUuid();

    if (this.isUiPreview) {
      const seq = (parseSeq(this.activeCursor) + 1n).toString();
      this.messagesByRoom[roomId] = [...this.activeMessages, {
        message_id: clientMessageId,
        room_id: roomId,
        seq,
        sender: this.session.user,
        client_message_id: clientMessageId,
        text,
        created_at: new Date().toISOString()
      }];
      this.cursorByRoom[roomId] = seq;
      const room = this.activeRoom;
      if (room) room.last_seq = seq;
      return;
    }

    // 3. Record pending send before initiating HTTP request
    const pendingItem: PendingMessage = {
      user_id: userId,
      room_id: roomId,
      client_message_id: clientMessageId,
      text,
      image,
      created_at: new Date().toISOString(),
      status: 'sending',
      attempts: 1
    };

    const currentPending = this.pendingByRoom[roomId] || [];
    this.pendingByRoom[roomId] = [...currentPending, pendingItem];
    await savePendingSend(pendingItem);

    this.addLog('http', `Sending message (ID: ${clientMessageId.slice(0, 8)}...)...`);

    // 4. Synchronize HTTP client chaos flag
    httpClient.simulateDropAfterSend = this.simulateTimeoutOnSend;
    if (this.simulateTimeoutOnSend) {
      this.simulatedDroppedIds.add(clientMessageId);
    }

    try {
      const resp = image
        ? await httpClient.sendImageMessageHttp(roomId, clientMessageId, image, text)
        : await httpClient.sendMessageHttp(roomId, clientMessageId, text);
      const confirmedMsg = resp.message;

      this.addLog(
        'http',
        `Message confirmed! Seq: #${confirmedMsg.seq} (replayed: ${resp.replayed})`
      );

      // Reconcile and clean up pending send
      await this.removePending(roomId, clientMessageId);

      // Deduplicate and insert confirmed message
      const existing = this.messagesByRoom[roomId] || [];
      const updated = this.dedupAndSortMessages([...existing, confirmedMsg]);
      this.messagesByRoom[roomId] = updated;

      // Advance contiguous cursor if this message is next in line
      const currentCursorBig = parseSeq(this.cursorByRoom[roomId] || '0');
      const msgSeqBig = parseSeq(confirmedMsg.seq);
      let newCursor = this.cursorByRoom[roomId] || '0';
      if (msgSeqBig === currentCursorBig + 1n) {
        newCursor = msgSeqBig.toString();
        this.cursorByRoom[roomId] = newCursor;
      }

      await saveMessagesAndCursorAtomic(userId, roomId, updated, newCursor);
    } catch (err) {
      this.handleSendError(roomId, clientMessageId, err);
      throw err;
    }
  }

  /**
   * Retries a pending message using the EXACT SAME client_message_id and text.
   */
  public async retryPendingMessage(clientMessageId: string): Promise<void> {
    if (!this.session || !this.activeRoomId) return;

    const roomId = this.activeRoomId;
    if (this.revokedRooms[roomId]) {
      this.addLog('error', `Cannot retry message: access to room ${roomId} was revoked`);
      return;
    }

    const userId = this.session.user.user_id;
    const pendingList = this.pendingByRoom[roomId] || [];
    const item = pendingList.find((p) => p.client_message_id === clientMessageId);

    if (!item) {
      this.addLog('error', `Pending message ${clientMessageId} not found to retry`);
      return;
    }

    item.status = 'sending';
    item.attempts += 1;
    item.error_code = undefined;
    item.error_message = undefined;
    this.pendingByRoom[roomId] = [...pendingList];
    await savePendingSend(item);

    this.addLog('http', `Retrying message with exact same ID (${clientMessageId.slice(0, 8)}...) attempt #${item.attempts}`);

    this.simulatedDroppedIds.delete(clientMessageId);

    try {
      const resp = item.image
        ? await httpClient.sendImageMessageHttp(roomId, clientMessageId, item.image, item.text, true)
        : await httpClient.sendMessageHttp(roomId, clientMessageId, item.text, true);
      const confirmedMsg = resp.message;

      this.addLog(
        'http',
        `Retried message confirmed! Seq: #${confirmedMsg.seq} (replayed: ${resp.replayed})`
      );

      await this.removePending(roomId, clientMessageId);

      const existing = this.messagesByRoom[roomId] || [];
      const updated = this.dedupAndSortMessages([...existing, confirmedMsg]);
      this.messagesByRoom[roomId] = updated;

      const currentCursorBig = parseSeq(this.cursorByRoom[roomId] || '0');
      const msgSeqBig = parseSeq(confirmedMsg.seq);
      let newCursor = this.cursorByRoom[roomId] || '0';
      if (msgSeqBig === currentCursorBig + 1n) {
        newCursor = msgSeqBig.toString();
        this.cursorByRoom[roomId] = newCursor;
      }

      await saveMessagesAndCursorAtomic(userId, roomId, updated, newCursor);
    } catch (err) {
      this.handleSendError(roomId, clientMessageId, err);
    }
  }

  /**
   * Edits and resends a pending message.
   * Section 6 requirement: Editing text constitutes a NEW intent, so the old pending item
   * is removed and a NEW client_message_id is generated.
   */
  public async editAndResendPendingMessage(oldClientMessageId: string, newText: string): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('info', `Editing pending message ${oldClientMessageId.slice(0, 8)}... with new text and generating fresh ID.`);
    await this.cancelPendingMessage(oldClientMessageId);
    await this.sendMessage(newText);
  }

  /**
   * Cancels and removes a pending message from the outbox.
   */
  public async cancelPendingMessage(clientMessageId: string): Promise<void> {
    if (!this.activeRoomId) return;
    await this.removePending(this.activeRoomId, clientMessageId);
    this.addLog('info', `Cancelled pending message ${clientMessageId.slice(0, 8)}...`);
  }

  /**
   * Fires count (default 20) concurrent HTTP POST requests with the EXACT SAME client_message_id
   * to demonstrate backend idempotency and safety under parallel race conditions.
   */
  public async runConcurrentIdempotencyDemo(count = 20): Promise<{
    total: number;
    created201: number;
    replayed200: number;
    uniqueMessageIds: number;
    seq: string;
  }> {
    if (!this.session || !this.activeRoomId) {
      throw new Error('Must be logged in with an active room to run idempotency test');
    }

    const roomId = this.activeRoomId;
    const testId = generateUuid();
    const testText = `[Concurrent Idempotency Demo] ${count} parallel requests at ${new Date().toLocaleTimeString()}`;

    this.addLog(
      'http',
      `Launching ${count} concurrent POST requests with single client_message_id (${testId.slice(0, 8)})...`
    );

    const promises = Array.from({ length: count }, async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          return await httpClient.sendMessageHttp(roomId, testId, testText, true);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 429 || attempt === 29) throw err;
          const delay = Math.max(1, err.retryAfterSeconds ?? 1) * 1000 + Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      throw new Error('Idempotency test exceeded retry limit');
    });

    const settled = await Promise.allSettled(promises);
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const results = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

    let created201 = 0;
    let replayed200 = 0;
    const messageIds = new Set<string>();
    let finalSeq = '';

    for (const res of results) {
      if (res.replayed) {
        replayed200++;
      } else {
        created201++;
      }
      messageIds.add(res.message.message_id);
      finalSeq = res.message.seq;
    }

    const report = {
      total: count,
      created201,
      replayed200,
      uniqueMessageIds: messageIds.size,
      seq: finalSeq
    };

    if (created201 !== 1 || replayed200 !== count - 1 || messageIds.size !== 1) {
      throw new Error('Idempotency test returned inconsistent message results');
    }

    this.addLog(
      'info',
      `Idempotency test completed: ${created201} created, ${replayed200} replayed. Unique message_ids: ${messageIds.size} (Seq: #${finalSeq}). Exactly 1 record committed!`
    );

    await this.syncRoom(roomId);

    return report;
  }

  /**
   * Demonstrates Idempotency Conflict (409 IDEMPOTENCY_CONFLICT).
   * Sends first request with client_message_id, then sends a second request with the
   * SAME client_message_id but DIFFERENT text, catching the 409 error.
   */
  public async simulateIdempotencyConflict409(): Promise<{
    code: string;
    status: number;
    message: string;
    clientMessageId: string;
  }> {
    if (!this.session || !this.activeRoomId) {
      throw new Error('Must be logged in with an active room to test 409 conflict');
    }

    const roomId = this.activeRoomId;
    const clientMessageId = generateUuid();
    const originalText = 'Original text for 409 test';
    const modifiedText = 'Modified text with same client_message_id';

    this.addLog('http', `[409 Test] Sending 1st request with ID ${clientMessageId.slice(0, 8)}...`);
    await httpClient.sendMessageHttp(roomId, clientMessageId, originalText, true);

    this.addLog('http', `[409 Test] Sending 2nd request with SAME ID but MODIFIED text...`);
    try {
      await httpClient.sendMessageHttp(roomId, clientMessageId, modifiedText, true);
      throw new Error('Expected 409 IDEMPOTENCY_CONFLICT, but request succeeded');
    } catch (err) {
      if (err instanceof ApiError) {
        this.addLog('http', `[409 Test] Caught expected ${err.status} ${err.code}: ${err.message}`);
        await this.syncRoom(roomId);
        return {
          code: err.code,
          status: err.status,
          message: err.message,
          clientMessageId
        };
      }
      throw err;
    }
  }

  /**
   * Toggles or sets the server-side outbox transactional background worker pause state.
   */
  public async toggleOutboxWorker(paused?: boolean): Promise<void> {
    const target = paused ?? !this.workerPaused;
    this.addLog('http', `Setting outbox worker paused = ${target}...`);
    const res = await httpClient.triggerDevChaos<{
      worker_paused: boolean;
      flushed_count: number;
      outbox_backlog_count: number;
    }>({ action: 'set_worker_paused', paused: target });

    this.workerPaused = res.worker_paused;
    this.outboxBacklogCount = res.outbox_backlog_count;
    this.addLog(
      'info',
      `Outbox worker is now ${res.worker_paused ? 'PAUSED' : 'ACTIVE'} (Backlog: ${res.outbox_backlog_count}, Flushed: ${res.flushed_count})`
    );
  }

  /**
   * Refreshes the dev chaos status (worker pause state and outbox backlog count).
   */
  public async refreshDevChaosStatus(): Promise<void> {
    try {
      const res = await httpClient.triggerDevChaos<{
        worker_paused: boolean;
        outbox_backlog_count: number;
      }>({ action: 'get_status' });
      if (typeof res.worker_paused === 'boolean') {
        this.workerPaused = res.worker_paused;
      }
      if (typeof res.outbox_backlog_count === 'number') {
        this.outboxBacklogCount = res.outbox_backlog_count;
      }
    } catch (err) {
      console.warn('Failed to refresh dev chaos status:', err);
    }
  }

  /**
   * Commits a message on the server without WebSocket broadcast to test recovery sync.
   */
  public async simulateSilentPeerMessage(): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('http', `Simulating silent peer message in ${this.activeRoomId}...`);
    await httpClient.triggerDevChaos({
      action: 'simulate_silent_message',
      room_id: this.activeRoomId
    });
    this.addLog(
      'sync',
      'Silent peer message committed on server without WebSocket broadcast. Waiting for periodic sync (15s) or manual sync to recover.'
    );
  }

  /**
   * Simulates duplicate WebSocket broadcast frames from server.
   */
  public async simulateDuplicateWsEvent(): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('ws', `Simulating duplicate WebSocket frames for room ${this.activeRoomId}...`);
    await httpClient.triggerDevChaos({
      action: 'simulate_duplicate_ws',
      room_id: this.activeRoomId
    });
    this.addLog('ws', 'Simulated 3 identical message.created frames sent from server.');
  }

  /**
   * Simulates out-of-order WebSocket broadcast frames from server (#N+2 before #N+1).
   */
  public async simulateOutOfOrderWsEvent(): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('ws', `Simulating out-of-order WebSocket frames for room ${this.activeRoomId}...`);
    await httpClient.triggerDevChaos({
      action: 'simulate_out_of_order_ws',
      room_id: this.activeRoomId
    });
    this.addLog('ws', 'Simulated out-of-order events emitted (#N+2 sent before #N+1). Gap healing should trigger.');
  }

  /**
   * Simulates membership revocation in the active room (e.g. member kicked).
   */
  public async simulateRemoveMember(silent = false): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('http', `Simulating member removal (silent=${silent}) in room ${this.activeRoomId}...`);
    await httpClient.triggerDevChaos({
      action: 'remove_member',
      room_id: this.activeRoomId,
      silent
    });
    this.addLog('info', `Member removed from room ${this.activeRoomId} (silent: ${silent}).`);
  }

  /**
   * Restores membership in the active room, clears revocation state, and resubscribes/syncs.
   */
  public async simulateRestoreMember(): Promise<void> {
    if (!this.activeRoomId) return;
    const roomId = this.activeRoomId;
    this.addLog('http', `Restoring membership in room ${roomId}...`);
    await httpClient.triggerDevChaos({
      action: 'restore_member',
      room_id: roomId
    });
    delete this.revokedRooms[roomId];
    this.addLog('info', `Membership restored for room ${roomId}. Resubscribing and syncing...`);
    await this.selectRoom(roomId);
  }

  /**
   * Triggers a dev simulation of an incoming message from a peer user.
   */
  public async simulateIncomingFromPeer(): Promise<void> {
    if (!this.activeRoomId) return;
    this.addLog('http', 'Simulating incoming message from peer...');
    await httpClient.triggerDevChaos({
      action: 'simulate_incoming',
      room_id: this.activeRoomId
    });
  }

  /**
   * Forces a simulated WebSocket disconnection with code 1001 or specified code via backend chaos endpoint.
   */
  public async simulateWsDisconnect(code = 1001): Promise<void> {
    this.addLog('ws', 'Disconnecting the browser WebSocket to test recovery.');
    wsClient.forceDisconnect(4000);
  }

  /**
   * Artificially sets local cursor backwards to create a sequence gap, then runs syncRoom
   * to demonstrate contiguous gap detection and recovery.
   */
  public async simulateLocalGapAndSync(): Promise<void> {
    if (!this.activeRoomId) return;
    const roomId = this.activeRoomId;
    const current = this.cursorByRoom[roomId] || '0';
    const big = parseSeq(current);
    const fakeCursor = big > 2n ? (big - 2n).toString() : '0';

    this.cursorByRoom[roomId] = fakeCursor;
    this.addLog('sync', `Artificially rolled back cursor from #${current} to #${fakeCursor} to create gap.`);
    await this.syncRoom(roomId);
  }

  // ============================================================================
  // Private Helpers & Event Wiring
  // ============================================================================

  private setupWsCallbacks(): void {
    wsClient.setCallbacks({
      onStateChange: (state, error, closeCode) => {
        this.wsState = state;
        this.wsError = error ?? null;
        this.lastCloseCode = closeCode ?? null;
        this.reconnectAttempt = wsClient.getReconnectAttempt();
        this.addLog('ws', `WebSocket state changed to ${state}${closeCode ? ` (code: ${closeCode})` : ''}`);

        // Gap F4: Repeated handshake failure -> verify session status via HTTP
        if (state === 'reconnecting' && this.reconnectAttempt >= 2) {
          this.verifySessionOnWsFailure();
        }
      },

      onSubscribed: (roomId, lastSeq) => {
        this.subscribedRooms[roomId] = true;
        this.addLog('ws', `Subscribed to room ${roomId} (last_seq: #${lastSeq})`);
      },

      onUnsubscribed: (roomId) => {
        this.subscribedRooms[roomId] = false;
        this.addLog('ws', `Unsubscribed from room ${roomId}`);
      },

      onSubscriptionRevoked: (roomId, reason) => {
        this.handleRoomRevoked(roomId, reason);
      },

      onProtocolAnomaly: (reason) => {
        this.addLog('error', `[Protocol Anomaly] ${reason}`);
      },

      onMessageCreated: (roomId, message) => {
        this.handleWsMessageCreated(roomId, message);
      },

      onError: (code, message) => {
        this.addLog('error', `WebSocket error (${code}): ${message}`);
      },

      onAuthExpired: () => {
        this.clearTabNotifications();
        this.stopNotificationMonitor();
        this.session = null;
        this.addLog('error', 'Session expired via WebSocket. Please log in again.');
      },

      onReconnected: () => {
        this.addLog('ws', 'WebSocket reconnected. Triggering sync for active room...');
        if (this.activeRoomId) {
          this.syncRoom(this.activeRoomId);
        }
      }
    });
  }

  /**
   * Handles room access revocation (Gap F2):
   * Sets revoked status, unsubscribes, marks pending messages as permanent failure, and logs.
   */
  private handleRoomRevoked(roomId: string, reason = 'ACCESS_REVOKED'): void {
    this.subscribedRooms[roomId] = false;
    this.revokedRooms[roomId] = reason;
    wsClient.unsubscribeRoom(roomId);

    const pendingList = this.pendingByRoom[roomId] || [];
    for (const item of pendingList) {
      item.status = 'failed_permanent';
      item.error_code = 'ROOM_NOT_FOUND';
      item.error_message = `Room access revoked (${reason})`;
      savePendingSend(item).catch((e) => console.error('Failed to update revoked pending in IDB:', e));
    }
    this.pendingByRoom[roomId] = [...pendingList];

    this.addLog('error', `Access to room ${roomId} revoked (${reason}). Stopped tracking and sending.`);
  }

  /**
   * Gap F4: Verifies authentication session when WebSocket repeatedly fails to reconnect.
   */
  private async verifySessionOnWsFailure(): Promise<void> {
    try {
      await httpClient.fetchSession();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'UNAUTHENTICATED')) {
        this.addLog('error', 'Session expired during WebSocket reconnect — stopping retries');
        wsClient.disconnect();
        this.clearTabNotifications();
        this.session = null;
      }
    }
  }

  private handleWsMessageCreated(roomId: string, message: Message): void {
    if (message.client_message_id && this.simulatedDroppedIds.has(message.client_message_id)) {
      this.addLog(
        'ws',
        `[Chaos Mode] Suppressed live WS frame for ${message.client_message_id.slice(0, 8)}... to simulate dropped network packet during send`
      );
      return;
    }
    this.addLog('ws', `Received live message.created in ${roomId} (Seq: #${message.seq})`);

    // 1. Reconcile with pending sends
    const userId = this.session?.user.user_id;
    if (userId && message.sender.user_id === userId && message.client_message_id) {
      this.removePending(roomId, message.client_message_id);
    }

    this.notifyTabOfMessage(roomId, message);

    // 2. Buffer if currently performing recovery sync OR awaiting subscribe confirmation (Gap F1)
    if (this.syncingByRoom[roomId] || this.bufferingRoomIds[roomId]) {
      this.liveBuffer[roomId] = this.liveBuffer[roomId] || [];
      if (this.liveBuffer[roomId].length >= 500) {
        this.addLog(
          'error',
          'Live event buffer reached 500 events limit! Restarting connection and fresh recovery sync.'
        );
        this.liveBuffer[roomId] = [];
        this.bufferingRoomIds[roomId] = false;
        wsClient.forceDisconnect(1001);
        return;
      }
      this.liveBuffer[roomId].push(message);
      return;
    }

    // 3. Deduplicate and add to messages
    const existing = this.messagesByRoom[roomId] || [];
    const updated = this.dedupAndSortMessages([...existing, message]);
    this.messagesByRoom[roomId] = updated;

    // 4. Advance contiguous cursor if message matches cursor + 1n
    const currentCursor = this.cursorByRoom[roomId] || '0';
    const currentCursorBig = parseSeq(currentCursor);
    const msgSeqBig = parseSeq(message.seq);
    let newCursor = currentCursor;

    if (msgSeqBig === currentCursorBig + 1n) {
      newCursor = msgSeqBig.toString();
      this.cursorByRoom[roomId] = newCursor;
    } else if (msgSeqBig > currentCursorBig + 1n) {
      // Missing intermediate sequence detected: trigger background sync to heal gap!
      this.addLog('sync', `Detected sequence gap (Cursor: #${currentCursor}, Message: #${message.seq}). Scheduling sync...`);
      this.syncRoom(roomId);
    }

    if (userId) {
      saveMessagesAndCursorAtomic(userId, roomId, updated, newCursor).catch((err) => {
        console.error('Failed to save live message to IDB:', err);
      });
    }
  }

  private async onLoginSuccess(): Promise<void> {
    if (!this.session) return;
    const userId = this.session.user.user_id;

    // Connect WebSocket
    wsClient.connect();

    // Fetch rooms (Gap F9: track next_cursor)
    try {
      const resp = await httpClient.fetchRooms(50);
      this.rooms = resp.items || [];
      this.roomsNextCursor = resp.next_cursor ?? null;
      this.addLog('http', `Loaded ${this.rooms.length} chat rooms`);
    } catch (err) {
      this.addLog('error', `Failed to load rooms: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Load any pending sends from previous sessions from IDB (Gap F5)
    try {
      const allPending = await getAllPendingForUser(userId);
      const grouped: Record<string, PendingMessage[]> = {};
      for (const p of allPending) {
        if (p.status === 'sending' || p.status === 'pending') {
          p.status = 'failed_retryable';
          p.error_code = 'RELOAD_INTERRUPTED';
          p.error_message = 'โหลดหน้าใหม่ระหว่างรอผล — กดส่งซ้ำด้วยรหัสเดิม';
          await savePendingSend(p);
        }
        grouped[p.room_id] = grouped[p.room_id] || [];
        grouped[p.room_id].push(p);
      }
      this.pendingByRoom = grouped;
      if (allPending.length > 0) {
        this.addLog('info', `Restored ${allPending.length} pending outbox messages from local storage.`);
      }
    } catch (err) {
      console.warn('Failed to load pending sends from storage:', err);
    }

    // Refresh dev chaos status

    // Start periodic recovery and room-list checks.
    this.startPeriodicSync();
    this.startNotificationMonitor();

    // Select first room if available
    if (this.rooms.length > 0 && !this.activeRoomId) {
      await this.selectRoom(this.rooms[0].room_id);
    }
  }

  private startPeriodicSync(): void {
    this.stopPeriodicSync();
    this.periodicSyncTimer = setInterval(() => {
      void this.scanRoomsForNotifications(this.notificationMonitorGeneration);
      if (document.visibilityState === 'visible' && this.activeRoomId && this.session) {
        this.syncRoom(this.activeRoomId);
      }
    }, 15000);
  }

  private stopPeriodicSync(): void {
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
  }

  private startNotificationMonitor(): void {
    this.stopNotificationMonitor();
    this.hiddenSince = document.visibilityState === 'hidden' ? httpClient.estimatedServerTime() - 1000 : null;
    void this.scanRoomsForNotifications(this.notificationMonitorGeneration);
  }

  private stopNotificationMonitor(): void {
    this.notificationMonitorGeneration++;
    this.notificationRoomSequences.clear();
    this.hiddenSince = null;
  }

  // Room-list sequence snapshots are only notification checkpoints, never recovery cursors.
  private async scanRoomsForNotifications(generation: number): Promise<void> {
    const userId = this.session?.user.user_id;
    if (!userId || this.notificationScanRunning) return;
    this.notificationScanRunning = true;
    const isCurrent = () => generation === this.notificationMonitorGeneration && this.session?.user.user_id === userId;
    const read = async <T>(request: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try { return await request(); }
        catch (error) {
          if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 3 || !isCurrent()) throw error;
          await new Promise(resolve => setTimeout(resolve, (error.retryAfterSeconds ?? 1) * 1000));
          if (!isCurrent()) throw error;
        }
      }
    };
    try {
      let cursor: string | null = null;
      do {
        const page: { items: Room[]; next_cursor: string | null } = await read(() => httpClient.fetchRooms(100, cursor));
        if (!isCurrent()) return;
        for (const room of page.items) {
          if (!isCurrent()) return;
          const previous = this.notificationRoomSequences.get(room.room_id);
          if ((previous !== undefined || (document.visibilityState === 'hidden' && this.hiddenSince !== null)) &&
              compareSeq(room.last_seq, previous ?? '0') > 0) {
            // For a newly discovered room, ignore history from before this background period.
            let after = previous ?? '0';
            let hasMore = true;
            while (hasMore) {
              const response = await read(() => httpClient.fetchRoomSync(room.room_id, after, room.last_seq, 100));
              if (!isCurrent()) return;
              for (const message of response.items) {
                if (previous !== undefined || (this.hiddenSince !== null && Date.parse(message.created_at) >= this.hiddenSince)) {
                  this.notifyTabOfMessage(room.room_id, message);
                }
              }
              if (response.has_more && compareSeq(response.next_after_seq, after) <= 0) {
                throw new Error('Notification scan did not advance');
              }
              after = response.next_after_seq;
              hasMore = response.has_more;
            }
          }
          if (!isCurrent()) return;
          this.notificationRoomSequences.set(room.room_id, room.last_seq);
        }
        cursor = page.next_cursor;
      } while (cursor && isCurrent());
    } catch (error) {
      this.addLog('error', `Room notification check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.notificationScanRunning = false;
      // A new session may have started while the previous request was in flight.
      if (generation !== this.notificationMonitorGeneration && this.session) {
        void this.scanRoomsForNotifications(this.notificationMonitorGeneration);
      }
    }
  }

  private setupNotificationSound(): void {
    if (this.soundUnlockAttached || typeof window === 'undefined') return;
    this.soundUnlockAttached = true;
    try { this.notificationSoundEnabled = localStorage.getItem('chat_notification_sound') !== 'off'; } catch { /* Storage is optional. */ }
    const unlock = () => this.unlockNotificationAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  public setNotificationSound(enabled: boolean): void {
    this.notificationSoundEnabled = enabled;
    try { localStorage.setItem('chat_notification_sound', enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    if (enabled) this.unlockNotificationAudio();
  }

  private unlockNotificationAudio(): void {
    if (!this.notificationSoundEnabled || typeof window === 'undefined') return;
    try {
      if (!this.audioContext) this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') void this.audioContext.resume().catch(() => {});
    } catch {
      // Audio is optional and must not interrupt messaging.
    }
  }

  private playNotificationSound(): void {
    const context = this.audioContext;
    if (!this.notificationSoundEnabled || !context || context.state !== 'running') return;
    const now = context.currentTime;
    if (now - this.lastNotificationSoundAt < 0.8) return;
    this.lastNotificationSoundAt = now;
    try {
      const gain = context.createGain();
      const tone = context.createOscillator();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(740, now);
      tone.frequency.setValueAtTime(988, now + 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.10, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      tone.connect(gain);
      gain.connect(context.destination);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(now);
      tone.stop(now + 0.33);
    } catch {
      // Audio is optional and must not interrupt messaging.
    }
  }

  private notifyTabOfMessage(roomId: string, message: Message): void {
    if (typeof document === 'undefined' || !this.session ||
        message.sender.user_id === this.session.user.user_id ||
        this.alertedMessageIds.has(message.message_id) ||
        (this.messagesByRoom[roomId] ?? []).some(item => item.message_id === message.message_id) ||
        (this.liveBuffer[roomId] ?? []).some(item => item.message_id === message.message_id)) return;

    this.alertedMessageIds.add(message.message_id);
    if (this.alertedMessageIds.size > 1000) {
      const oldest = this.alertedMessageIds.values().next().value;
      if (oldest !== undefined) this.alertedMessageIds.delete(oldest);
    }
    this.playNotificationSound();

    if (document.visibilityState !== 'hidden') return;
    if (this.originalTabTitle === null) this.originalTabTitle = document.title;
    this.unreadTabMessages.add(message.message_id);
    document.title = `(${this.unreadTabMessages.size}) ${this.originalTabTitle}`;
  }

  private clearTabNotifications(): void {
    if (typeof document !== 'undefined' && this.originalTabTitle !== null) {
      document.title = this.originalTabTitle;
    }
    this.originalTabTitle = null;
    this.unreadTabMessages.clear();
  }

  private setupVisibilityListener(): void {
    if (this.isVisibilityListenerAttached || typeof document === 'undefined') return;
    this.isVisibilityListenerAttached = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.hiddenSince = null;
        this.clearTabNotifications();
      } else {
        this.hiddenSince = httpClient.estimatedServerTime() - 1000;
      }
      void this.scanRoomsForNotifications(this.notificationMonitorGeneration);
      if (document.visibilityState === 'visible' && this.activeRoomId && this.session) {
        this.addLog('sync', 'App tab became visible. Running immediate catch-up sync...');
        this.syncRoom(this.activeRoomId);
      }
    });
  }

  private handleSendError(roomId: string, clientMessageId: string, err: unknown): void {
    const pendingList = this.pendingByRoom[roomId] || [];
    const item = pendingList.find((p) => p.client_message_id === clientMessageId);
    if (!item) return;

    let retryable = true;
    let code = 'NETWORK_ERROR';
    let message = err instanceof Error ? err.message : 'Send failed';

    if (err instanceof ApiError) {
      retryable = err.retryable;
      code = err.code;
      message = err.message;
      if (err.status === 404 || err.code === 'ROOM_NOT_FOUND') {
        this.handleRoomRevoked(roomId, 'ROOM_NOT_FOUND');
      }
    }

    item.status = retryable ? 'failed_retryable' : 'failed_permanent';
    item.error_code = code;
    item.error_message = message;
    this.pendingByRoom[roomId] = [...pendingList];

    savePendingSend(item).catch((e) => console.error('Failed to update pending error in IDB:', e));
    this.addLog('error', `Send failed for ${clientMessageId.slice(0, 8)}... (${code}): ${message}`);
  }

  private async removePending(roomId: string, clientMessageId: string): Promise<void> {
    const list = this.pendingByRoom[roomId] || [];
    this.pendingByRoom[roomId] = list.filter((p) => p.client_message_id !== clientMessageId);
    if (this.session) {
      await removePendingSend(this.session.user.user_id, roomId, clientMessageId);
    }
  }

  private async reconcilePendingSends(roomId: string, confirmedMessages: Message[]): Promise<void> {
    const pendingList = this.pendingByRoom[roomId] || [];
    if (pendingList.length === 0) return;

    const confirmedIds = new Set(confirmedMessages.map((m) => m.client_message_id).filter(Boolean));
    const remaining: PendingMessage[] = [];

    for (const pending of pendingList) {
      if (confirmedIds.has(pending.client_message_id)) {
        if (this.session) {
          await removePendingSend(this.session.user.user_id, roomId, pending.client_message_id);
        }
      } else {
        remaining.push(pending);
      }
    }

    this.pendingByRoom[roomId] = remaining;
  }

  private dedupAndSortMessages(messages: Message[]): Message[] {
    const map = new Map<string, Message>();
    for (const msg of messages) {
      map.set(msg.message_id, msg);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => compareSeq(a.seq, b.seq));
    return list;
  }
}

export const chatEngine = new ChatEngine();
