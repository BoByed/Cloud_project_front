<script lang="ts">
  import { onMount } from 'svelte';
  import { chatEngine } from './lib/services/chat-engine.svelte.js';
  import { localDemoEnabled } from './lib/services/local-demo.js';
  import BrandMark from './lib/components/BrandMark.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import ChatHeader from './lib/components/ChatHeader.svelte';
  import MessageList from './lib/components/MessageList.svelte';
  import MessageComposer from './lib/components/MessageComposer.svelte';
  import RoomDialog from './lib/components/RoomDialog.svelte';
  import LoginScreen from './lib/components/LoginScreen.svelte';

  let localDemo = $state(false);
  let isDevDrawerOpen = $state(false);
  let showRoomList = $state(true);
  let roomDialog = $state<'new' | 'manage' | null>(null);
  const loadDevDrawer = import.meta.env.DEV ? () => import('./lib/components/DevInspectorDrawer.svelte') : null;

  onMount(() => {
    localDemo = localDemoEnabled();
    if (!chatEngine.session && chatEngine.authLoading) {
      chatEngine.initialize();
    }
  });

  function closeDevDrawer() {
    isDevDrawerOpen = false;
  }
</script>

<div class="app-root">
  {#if chatEngine.authLoading}
    <div class="loading-screen" role="status">
      <BrandMark size={40} />
      <p>กำลังเปิด Cloud Chat…</p>
    </div>
  {:else if !chatEngine.session}
    <LoginScreen {localDemo} />
  {:else}
    {#if chatEngine.storageDegraded}
      <div class="degraded-banner" role="status">
        เบราว์เซอร์บันทึกข้อความที่ยังไม่ได้ส่งไม่ได้ หากโหลดหน้าใหม่อาจต้องพิมพ์อีกครั้ง
      </div>
    {/if}

    <div class="messenger-container">
      <div class:show-room-list={showRoomList} class="sidebar-panel">
        <Sidebar
          onNewRoom={() => roomDialog = 'new'}
          onOpenDevDrawer={localDemo ? () => isDevDrawerOpen = true : undefined}
          onSelectRoom={() => showRoomList = false}
          onLogout={() => { showRoomList = true; closeDevDrawer(); }}
        />
      </div>

      <main class:show-room-list={showRoomList} class="chat-main" aria-label="ห้องสนทนา">
        {#if chatEngine.activeRoom}
          <ChatHeader onShowRooms={() => showRoomList = true} onManage={() => roomDialog = 'manage'} />
          <MessageList />
          <MessageComposer />
        {:else}
          <div class="no-room-selected">
            <BrandMark size={48} />
            <h2>ห้องสนทนาของคุณ</h2>
            <p>เลือกห้องจากรายการเพื่อเปิดข้อความ</p>
            <button type="button" class="back-to-list" onclick={() => showRoomList = true}>กลับไปยังรายการแชท</button>
          </div>
        {/if}
      </main>

      {#if roomDialog}
        <RoomDialog mode={roomDialog} room={chatEngine.activeRoom} onClose={() => roomDialog = null} onOpened={() => showRoomList = false} />
      {/if}

      {#if localDemo && loadDevDrawer && isDevDrawerOpen}
        {#await loadDevDrawer() then { default: DevInspectorDrawer }}
          <DevInspectorDrawer onClose={closeDevDrawer} />
        {/await}
      {/if}
    </div>
  {/if}
</div>

<style>
  .app-root { height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
  .degraded-banner { padding: 8px 16px; background: var(--item-active); color: var(--text-primary); text-align: center; flex-shrink: 0; }
  .loading-screen, .no-room-selected { flex: 1; display: grid; align-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; color: var(--text-secondary); }
  .no-room-selected h2 { color: var(--text-primary); }
  .messenger-container { flex: 1; min-height: 0; display: flex; overflow: hidden; }
  .chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-app); }
  .sidebar-panel { flex-shrink: 0; }
  .back-to-list { display: none; }

  @media (max-width: 700px) {
    .sidebar-panel { display: none; width: 100%; }
    .sidebar-panel.show-room-list { display: block; }
    .chat-main.show-room-list { display: none; }
    .back-to-list { display: block; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-surface); color: var(--brand-accent); }
  }
</style>
