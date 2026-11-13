<script lang="ts">
  import { chatEngine } from '../services/chat-engine.svelte.js';
  let { onShowRooms, onManage }: { onShowRooms: () => void; onManage: () => void } = $props();
  let room = $derived(chatEngine.activeRoom);
</script>

{#if room}
  <header class="chat-header">
    <button class="back-to-rooms" type="button" onclick={onShowRooms} aria-label="กลับไปยังห้องสนทนา">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
    </button>
    <span class="channel-mark" class:group={room.kind === 'group'} aria-hidden="true">
      {room.kind === 'group' ? '#' : Array.from(room.title.trim())[0]?.toUpperCase()}
    </span>
    <div class="room-meta">
      <h2>{room.title}</h2>
      <p>{room.kind === 'group' ? 'กลุ่ม' : 'แชทส่วนตัว'}</p>
    </div>
    <div class="header-actions">
      {#if chatEngine.wsState !== 'connected' && !chatEngine.isUiPreview}
        <p class="connection" role="status">
          {chatEngine.wsState === 'connecting' || chatEngine.wsState === 'reconnecting' ? 'กำลังเชื่อมต่อ…' : 'ไม่ได้เชื่อมต่อ'}
        </p>
      {/if}
      {#if room.kind === 'group'}
        <button type="button" class="manage" onclick={onManage} aria-label="สมาชิกและตั้งค่า" title="สมาชิกและตั้งค่า">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3" /><path d="M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v1" />
          </svg>
          <span>สมาชิกและตั้งค่า</span>
        </button>
      {/if}
    </div>
  </header>
{/if}

<style>
  .chat-header { min-height: 72px; padding: 12px 24px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); background: var(--bg-surface); flex-shrink: 0; }
  .room-meta { min-width: 0; flex: 1; }
  h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; line-height: 1.35; }
  p { font-size: 12px; color: var(--text-secondary); }
  .manage { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-surface); color: var(--text-primary); font: inherit; cursor: pointer; }
  .manage:hover { background: var(--item-hover); }
  .connection { text-align: end; }
  .back-to-rooms { display: none; }

  @media (max-width: 700px) {
    .chat-header { min-height: 62px; padding: 8px 12px; gap: 6px; }
    .back-to-rooms { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border: 0; border-radius: 8px; background: transparent; color: var(--text-primary); cursor: pointer; }
    .back-to-rooms:hover { background: var(--item-hover); }
  }
  @media (min-width: 701px) { .chat-header { min-height: 86px; padding: 18px 32px; } }
  .manage { border-radius: 10px; }
  .channel-mark { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 14px; background: var(--item-active); color: var(--brand-accent); font-size: 20px; font-weight: 700; }
  .channel-mark.group { background: var(--group-bg); color: var(--group-text); }
  .header-actions, .manage { display: flex; align-items: center; gap: 8px; }
  .connection { padding: 4px 8px; border-radius: 8px; background: var(--bg-input); }
  @media (max-width: 700px) {
    .manage span { display: none; }
    .channel-mark { width: 36px; height: 36px; border-radius: 11px; }
  }
</style>
