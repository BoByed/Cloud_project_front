<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { chatEngine } from '../services/chat-engine.svelte.js';
  import ChatImage from './ChatImage.svelte';
  import type { Message, PendingMessage } from '../types/contract.js';
  import { getUtf8ByteLength, validateMessageText } from '../types/contract.js';

  let messagesContainer = $state<HTMLElement | null>(null);
  let editDialog = $state<HTMLDialogElement | null>(null);

  // Edit modal state
  let editingItem = $state<PendingMessage | null>(null);
  let editText = $state('');
  let editError = $state<string | null>(null);
  let editByteLength = $derived(getUtf8ByteLength(editText));

  let messages = $derived(chatEngine.activeMessages);
  let pendingSends = $derived(chatEngine.activePending);
  let activeRoom = $derived(chatEngine.activeRoom);
  let hasMoreHistory = $derived(
    activeRoom ? (chatEngine.historyHasMoreByRoom[activeRoom.room_id] ?? false) : false
  );
  let revokedReason = $derived(
    chatEngine.activeRoomId && chatEngine.revokedRooms
      ? chatEngine.revokedRooms[chatEngine.activeRoomId]
      : null
  );

  // Auto-scroll helper
  async function scrollToBottom(smooth = false) {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
      });
    }
  }

  // Scroll to bottom when messages count changes
  $effect(() => {
    if (messages.length > 0 || pendingSends.length > 0) {
      scrollToBottom(true);
    }
  });

  // Modern Web Guidance: light-dismiss-a-dialog fallback
  onMount(() => {
    scrollToBottom(false);

    if (editDialog && !('closedBy' in HTMLDialogElement.prototype)) {
      editDialog.addEventListener('click', (event: MouseEvent) => {
        if (event.target !== editDialog) return;
        const rect = editDialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (isDialogContent) return;
        editDialog.close();
      });
    }
  });

  function openEditModal(item: PendingMessage) {
    editingItem = item;
    editText = item.text;
    editError = null;
    if (editDialog) {
      editDialog.showModal();
    }
  }

  function closeEditModal() {
    if (editDialog) {
      editDialog.close();
    }
    editingItem = null;
    editText = '';
    editError = null;
  }

  async function handleConfirmEdit() {
    if (!editingItem) return;
    const validation = validateMessageText(editText);
    if (!validation.valid) {
      editError = validation.reason || 'ข้อความไม่ถูกต้อง';
      return;
    }

    try {
      await chatEngine.editAndResendPendingMessage(editingItem.client_message_id, editText);
      closeEditModal();
    } catch (err) {
      editError = err instanceof Error ? err.message : 'ส่งข้อความใหม่ไม่สำเร็จ';
    }
  }

  function formatTime(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  }
</script>

<div class="message-list-viewport" bind:this={messagesContainer}>
  <!-- Revocation Warning Banner (Section 5 & 7) -->
  {#if revokedReason}
    <div class="revocation-banner" role="status">
      <div class="revocation-content">
        <div class="revocation-text">
          คุณไม่ได้เป็นสมาชิกห้องนี้แล้ว จึงส่งข้อความใหม่ไม่ได้
        </div>
      </div>

    </div>
  {/if}

  <!-- Top Load More History Button -->
  {#if activeRoom && hasMoreHistory}
    <div class="history-loader-area">
      <button
        type="button"
        class="load-more-btn"
        disabled={chatEngine.loadingHistory}
        onclick={() => chatEngine.loadOlderHistory()}
      >
        {#if chatEngine.loadingHistory}
          กำลังโหลด…
        {:else}
          ดูข้อความก่อนหน้า
        {/if}
      </button>
    </div>
  {/if}

  <!-- Empty State -->
  {#if messages.length === 0 && pendingSends.length === 0}
    <div class="empty-state">
      <p class="empty-title">ยังไม่มีข้อความในห้องนี้</p>
      <p class="empty-desc">ส่งข้อความแรกเพื่อเริ่มคุย</p>
    </div>
  {/if}

  <!-- Confirmed Messages Timeline -->
  <div class="messages-stack">
    {#each messages as msg (msg.message_id)}
      {@const isSelf = msg.sender.user_id === chatEngine.session?.user.user_id}
      <div class="message-row {isSelf ? 'self' : 'peer'}">
        <!-- Peer Avatar -->
        {#if !isSelf}
          <div class="sender-avatar" aria-hidden="true">
            {msg.sender.display_name.slice(0, 2).toUpperCase()}
          </div>
        {/if}

        <div class="bubble-container">
          <!-- Peer Sender Name Header -->
          {#if !isSelf}
            <span class="sender-name">{msg.sender.display_name}</span>
          {/if}

          <!-- Plain Text Bubble (No HTML interpretation) -->
          <div class="bubble" class:image-bubble={Boolean(msg.image)}>
            {#if msg.image}<ChatImage url={msg.image.url} description={msg.text} />{/if}
            {#if msg.text}<span class="bubble-text">{msg.text}</span>{/if}
          </div>

          <div class="bubble-meta">
            <span class="time-tag">{formatTime(msg.created_at)}</span>
          </div>
        </div>
      </div>
    {/each}

    <!-- Pending Outbox Section (Section 4 & Section 6) -->
    {#if pendingSends.length > 0}
      {#each pendingSends as pending (pending.client_message_id)}
        <div class="message-row self pending {pending.status}">
          <div class="bubble-container">
            <!-- Plain Text Bubble -->
            <div class="bubble pending-bubble">
              {#if pending.image}<span>📷 {pending.image.name}</span>{/if}
              <span class="bubble-text">{pending.text}</span>
            </div>

            <!-- Outbox Status & Action Bar -->
            <div class="pending-meta-bar">
              {#if pending.status === 'sending' || pending.status === 'pending'}
                <span class="status-indicator sending">
                  <span class="spin-icon">⟳</span> กำลังส่ง...
                </span>
              {:else if pending.status === 'failed_retryable'}
                <div class="status-indicator retryable">
                  <span class="error-badge">ส่งไม่สำเร็จ</span>
                  <button
                    type="button"
                    class="retry-btn"
                    onclick={() => chatEngine.retryPendingMessage(pending.client_message_id)}
                  >
                    ลองส่งอีกครั้ง
                  </button>
                  {#if !pending.image}<button
                    type="button"
                    class="edit-btn"
                    onclick={() => openEditModal(pending)}
                  >
                    แก้ไข
                  </button>{/if}
                  <button
                    type="button"
                    class="cancel-btn"
                    onclick={() => chatEngine.cancelPendingMessage(pending.client_message_id)}
                  >
                    ยกเลิก
                  </button>
                </div>
              {:else if pending.status === 'failed_permanent'}
                <div class="status-indicator permanent">
                  <span class="error-badge danger">ส่งข้อความนี้ไม่ได้</span>
                  {#if !pending.image}<button
                    type="button"
                    class="edit-btn"
                    onclick={() => openEditModal(pending)}
                  >
                    แก้ไข
                  </button>{/if}
                  <button
                    type="button"
                    class="cancel-btn"
                    onclick={() => chatEngine.cancelPendingMessage(pending.client_message_id)}
                  >
                    ยกเลิก
                  </button>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- Modern Web Guidance: Native Light-Dismiss Dialog for Editing Failed Message -->
<!-- closedby="any" handles clicking backdrop, Esc key, and form submission -->
<dialog
  bind:this={editDialog}
  closedby="any"
  aria-labelledby="editDialogTitle"
  class="edit-modal"
>
  <div class="dialog-content">
    <div class="dialog-header">
      <h3 id="editDialogTitle">แก้ไข</h3>
      <button type="button" class="close-x" onclick={closeEditModal} aria-label="ปิดหน้าต่าง">×</button>
    </div>

    <div class="dialog-body">
      <textarea
        class="edit-textarea composer-textarea"
        bind:value={editText}
        placeholder="พิมพ์ข้อความใหม่ที่ต้องการส่ง…"
        aria-label="แก้ไขข้อความ"
        rows="3"
      ></textarea>

      <div class="edit-footer-info">
        <span class="byte-counter {editByteLength > 4096 ? 'warning' : ''}">
          {editByteLength > 4096 ? 'ข้อความยาวเกินไป' : ''}
        </span>
        {#if editError}
          <span class="edit-error-msg">{editError}</span>
        {/if}
      </div>
    </div>

    <div class="dialog-actions">
      <button type="button" class="btn-secondary" onclick={closeEditModal}>
        ยกเลิก
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={editByteLength === 0 || editByteLength > 4096}
        onclick={handleConfirmEdit}
      >
        ส่งข้อความใหม่
      </button>
    </div>
  </div>
</dialog>

<style>
  .message-list-viewport {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 20px clamp(12px, 3vw, 36px);
    display: flex;
    flex-direction: column;
    background-color: var(--bg-app);
  }

  .revocation-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    margin-bottom: 16px;
    border-radius: 10px;
    background-color: rgba(250, 56, 62, 0.12);
    border: 1px solid rgba(250, 56, 62, 0.35);
    color: var(--status-red);
    flex-wrap: wrap;
  }

  .revocation-content {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    flex: 1;
    min-width: 0;
  }

  .revocation-text {
    line-height: 1.4;
    color: var(--text-primary);
  }

  .history-loader-area {
    display: flex;
    justify-content: center;
    margin-bottom: 16px;
  }

  .load-more-btn {
    padding: 6px 14px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background-color: var(--bg-input);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .load-more-btn:hover:not(:disabled) {
    background-color: var(--item-hover);
    border-color: var(--brand-blue);
    color: var(--brand-blue);
  }

  .load-more-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .empty-desc {
    font-size: 13px;
  }

  .messages-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: min-content;
  }


  @media (prefers-reduced-motion: no-preference) {
    .message-row { animation: message-in 240ms ease-out both; }
  }

  @keyframes message-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .message-row {
    display: flex;
    gap: 8px;
    max-width: min(84%, 640px);
  }

  .message-row.peer {
    align-self: flex-start;
  }

  .message-row.self {
    align-self: flex-end;
    flex-direction: row-reverse;
  }

  .sender-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    align-self: flex-end;
  }

  .bubble-container {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .message-row.self .bubble-container {
    align-items: flex-end;
  }

  .sender-name {
    font-size: 11px;
    color: var(--text-secondary);
    padding-left: 4px;
    font-weight: 500;
  }

  /* Bubble Styling */
  .bubble {
    padding: 9px 14px;
    border-radius: 13px;
    font-size: 14px;
    line-height: 1.4;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
  }

  .image-bubble {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: fit-content;
    max-width: min(256px, 100%);
    padding: 8px;
  }

  .image-bubble .bubble-text {
    align-self: stretch;
    max-width: 100%;
    padding: 0 4px 2px;
  }

  .message-row.peer .bubble {
    background-color: var(--bubble-in-bg);
    color: var(--bubble-in-text);
    border-bottom-left-radius: 4px;
  }

  .message-row.self .bubble {
    background: var(--brand-fill);
    color: var(--bubble-out-text);
    border-bottom-right-radius: 4px;
  }

  .bubble-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    padding: 0 4px;
  }

  .time-tag {
    font-size: 10px;
  }

  .message-row.pending .bubble {
    opacity: 0.85;
    border: 1px dashed var(--brand-blue);
  }

  .message-row.pending.failed_retryable .bubble {
    border-color: var(--status-yellow);
    background: rgba(245, 166, 35, 0.15);
    color: var(--text-primary);
  }

  .message-row.pending.failed_permanent .bubble {
    border-color: var(--status-red);
    background: rgba(250, 56, 62, 0.15);
    color: var(--text-primary);
  }

  .pending-meta-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
    margin-top: 2px;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .status-indicator.sending {
    color: var(--brand-blue);
  }

  .error-badge {
    padding: 2px 6px;
    border-radius: 4px;
    background-color: rgba(245, 166, 35, 0.15);
    color: #b37400;
    font-size: 11px;
  }

  .error-badge.danger {
    background-color: rgba(250, 56, 62, 0.15);
    color: var(--status-red);
  }

  .retry-btn,
  .edit-btn,
  .cancel-btn {
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background-color: var(--bg-surface);
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .retry-btn {
    border-color: var(--brand-blue);
    color: var(--brand-blue);
    font-weight: 600;
  }

  .retry-btn:hover {
    background-color: var(--item-active);
  }

  .edit-btn {
    border-color: #e67e22;
    color: #e67e22;
    font-weight: 600;
  }

  .edit-btn:hover {
    background-color: rgba(230, 126, 34, 0.12);
  }

  .cancel-btn:hover {
    background-color: var(--item-hover);
    color: var(--status-red);
  }

  /* Edit Dialog */
  .edit-modal {
    padding: 0;
  }

  .dialog-content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dialog-header h3 {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-x {
    background: transparent;
    border: none;
    font-size: 20px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .edit-textarea {
    border: 1px solid var(--border) !important;
    border-radius: 8px !important;
    background-color: var(--bg-input) !important;
    padding: 10px !important;
  }

  .edit-footer-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
  }

  .byte-counter {
    color: var(--text-secondary);
  }

  .byte-counter.warning {
    color: var(--status-red);
    font-weight: 600;
  }

  .edit-error-msg {
    color: var(--status-red);
  }

  .dialog-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-primary {
    border: none;
    background: var(--brand-fill);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    border: 1px solid var(--border);
    background-color: var(--bg-surface);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background-color: var(--item-hover);
  }
</style>
