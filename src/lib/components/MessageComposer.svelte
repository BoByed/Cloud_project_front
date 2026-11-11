<script lang="ts">
  import { chatEngine } from '../services/chat-engine.svelte.js';
  import { getUtf8ByteLength, validateMessageText } from '../types/contract.js';

  let text = $state('');
  let isSending = $state(false);
  let errorMessage = $state<string | null>(null);
  let image = $state<File | null>(null);
  let preview = $state<string | null>(null);

  let byteLength = $derived(getUtf8ByteLength(text));
  let validation = $derived(validateMessageText(text));
  let isRevoked = $derived(
    Boolean(chatEngine.activeRoomId && chatEngine.revokedRooms && chatEngine.revokedRooms[chatEngine.activeRoomId])
  );
  let canSend = $derived((image ? !text.includes('\u0000') && byteLength <= 4096 : validation.valid) && !isSending && !isRevoked);

  function selectImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      errorMessage = 'เลือกไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MiB';
      input.value = '';
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    image = file;
    preview = URL.createObjectURL(file);
    errorMessage = null;
    input.value = '';
  }

  function removeImage() {
    if (preview) URL.revokeObjectURL(preview);
    image = null;
    preview = null;
  }

  let placeholderText = $derived(
    isRevoked
      ? 'คุณส่งข้อความในห้องนี้ไม่ได้'
      : 'พิมพ์ข้อความ…'
  );

  async function handleSend() {
    if (!canSend) return;

    isSending = true;
    errorMessage = null;
    const textToSend = text;
    const imageToSend = image;

    try {
      // Clear input immediately for snappy user experience
      text = '';
      removeImage();
      await chatEngine.sendMessage(textToSend, imageToSend ?? undefined);
    } catch (err) {
      // Note: chatEngine will keep the message in pending_sends as failed_retryable / failed_permanent
      // so the message is not lost.
      errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่ง';
    } finally {
      isSending = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      handleSend();
    }
  }
</script>

<div class="composer-wrapper">
  {#if preview}
    <div><img src={preview} alt="ตัวอย่างรูปที่เลือก" style="max-width: 160px; max-height: 120px" />
      <button type="button" onclick={removeImage}>นำรูปออก</button></div>
  {/if}
  {#if byteLength > 4096}
    <p class="length-error" role="status">ข้อความยาวเกินไป กรุณาย่อก่อนส่ง</p>
  {/if}


  <div class="composer-bar {isRevoked ? 'revoked' : ''}">
    <label class="image-picker" title="แนบรูปภาพ">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m3 17 5-4 4 3 5-6 4 4" /></svg>
      <input aria-label="แนบรูปภาพ" type="file" accept="image/jpeg,image/png,image/webp" onchange={selectImage} disabled={isSending || isRevoked} />
    </label>
    <div class="textarea-container">
      <textarea
        class="composer-textarea"
        placeholder={placeholderText}
        aria-label="ข้อความ"
        bind:value={text}
        onkeydown={handleKeyDown}
        disabled={isSending || isRevoked}
        rows="1"
      ></textarea>
    </div>

    <!-- Send Button -->
    <button
      type="button"
      class="send-btn"
      disabled={!canSend}
      onclick={handleSend}
      aria-label="ส่งข้อความ"
      title={isRevoked ? 'สิทธิ์สมาชิกถูกเพิกถอน' : canSend ? 'ส่งข้อความ' : 'พิมพ์ข้อความหรือแนบรูปก่อนส่ง'}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
      </svg>
    </button>
  </div>

  <!-- Validation / Send Error Alert -->
  {#if errorMessage}
    <div class="composer-alert">
      <span role="alert">{errorMessage}</span>
      <button type="button" class="dismiss-alert" aria-label="ปิดข้อความแจ้งเตือน" onclick={() => errorMessage = null}>×</button>
    </div>
  {/if}
</div>

<style>
  .image-picker { flex-shrink: 0; display: grid; place-items: center; width: 38px; height: 38px; color: var(--brand-accent); cursor: pointer; border-radius: 8px; }
  .image-picker:hover { background: var(--item-hover); }
  .image-picker:focus-within { outline: 2px solid var(--brand-accent); }
  .image-picker input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .composer-wrapper {
    background-color: var(--bg-surface);
    border-top: 1px solid var(--border);
    padding: 10px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .length-error { color: var(--status-red); font-size: 12px; }

  .composer-bar {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    background-color: var(--bg-input);
    border-radius: 10px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .composer-bar.revoked {
    opacity: 0.7;
    background-color: var(--item-hover);
    cursor: not-allowed;
  }

  .composer-bar:focus-within {
    border-color: var(--brand-blue);
    box-shadow: 0 0 0 1px var(--brand-blue);
  }

  .textarea-container {
    flex: 1;
    display: flex;
    min-width: 0;
  }

  .send-btn {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    border: none;
    background: var(--brand-fill);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.1s ease, opacity 0.15s ease;
    padding-left: 3px; /* visual center for send arrow */
  }

  .send-btn:hover:not(:disabled) {
    transform: scale(1.06);
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .send-btn:disabled {
    background: var(--border);
    color: var(--text-tertiary);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .composer-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background-color: rgba(250, 56, 62, 0.12);
    border-radius: 8px;
    color: var(--status-red);
    font-size: 12px;
  }

  .dismiss-alert {
    background: transparent;
    border: none;
    font-size: 16px;
    color: var(--status-red);
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-bar, .send-btn { transition: none; }
    .send-btn:hover:not(:disabled), .send-btn:active:not(:disabled) { transform: none; }
  }
  @media (max-width: 700px) {
    .composer-wrapper { padding: 8px; }
  }
</style>
