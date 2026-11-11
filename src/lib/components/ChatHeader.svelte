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
    <div class="room-meta">
      <h2>{room.title}</h2>
      <p>{room.kind === 'group' ? 'กลุ่ม' : 'แชทส่วนตัว'}</p>
    </div>
    {#if room.kind === 'group'}<button type="button" class="manage" onclick={onManage}>สมาชิกและตั้งค่า</button>{/if}
    {#if chatEngine.wsState !== 'connected'}
      <p class="connection" role="status">
        {chatEngine.wsState === 'connecting' || chatEngine.wsState === 'reconnecting' ? 'กำลังเชื่อมต่อ…' : 'ไม่ได้เชื่อมต่อ'}
      </p>
    {/if}
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
</style>
