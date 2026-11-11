<script lang="ts">
  import { onMount } from 'svelte';
  import BrandMark from './BrandMark.svelte';
  import { chatEngine } from '../services/chat-engine.svelte.js';

  let { onOpenDevDrawer, onSelectRoom, onLogout, onNewRoom }: {
    onOpenDevDrawer?: () => void;
    onSelectRoom: () => void;
    onLogout: () => void;
    onNewRoom: () => void;
  } = $props();

  let searchQuery = $state('');
  let signingOut = $state(false);
  let logoutError = $state(false);
  let refreshError = $state(false);
  let filteredRooms = $derived(chatEngine.rooms.filter((room) =>
    room.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
  ));
  let currentScheme = $state<'light' | 'dark'>('light');

  function updateCurrentSchemeState() {
    try {
      const stored = localStorage.getItem('color-scheme');
      if (stored === 'light' || stored === 'dark') {
        currentScheme = stored;
      } else {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        currentScheme = isSystemDark ? 'dark' : 'light';
      }
    } catch {
      currentScheme = 'light';
    }
  }

  function toggleColorScheme() {
    try {
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemPreference = isSystemDark ? 'dark' : 'light';
      
      // Target scheme is the opposite of currently rendered scheme
      const target = currentScheme === 'dark' ? 'light' : 'dark';

      if (target !== systemPreference) {
        localStorage.setItem('color-scheme', target);
      } else {
        localStorage.removeItem('color-scheme');
      }

      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) {
        meta.setAttribute('content', localStorage.getItem('color-scheme') ?? 'light dark');
      }

      updateCurrentSchemeState();
    } catch (e) {
      console.warn('Failed to toggle color scheme in localStorage:', e);
    }
  }

  onMount(() => {
    updateCurrentSchemeState();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'color-scheme') {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) {
          meta.setAttribute('content', event.newValue ?? 'light dark');
        }
        updateCurrentSchemeState();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  });


  function initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? '').join('').toUpperCase();
  }

  async function refreshRooms() {
    refreshError = false;
    try { await chatEngine.refreshRooms(); }
    catch { refreshError = true; }
  }

  async function signOut(allDevices: boolean) {
    signingOut = true;
    logoutError = false;
    try {
      await chatEngine.logout(allDevices);
      onLogout();
    } catch {
      logoutError = true;
    } finally {
      signingOut = false;
    }
  }
</script>

<aside class="sidebar" aria-label="รายการแชท">
  <header class="sidebar-header">
    <div class="wordmark"><BrandMark /> Cloud Chat</div>
<div class="heading-row"><h1>แชท</h1><div><button type="button" class="header-action" onclick={refreshRooms} aria-label="รีเฟรชรายการแชท" title="รีเฟรชรายการแชท">↻</button><button type="button" class="header-action" onclick={onNewRoom} aria-label="เริ่มแชทใหม่" title="เริ่มแชทใหม่">＋</button></div></div>
    <label class="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" />
      </svg>
      <input type="search" aria-label="ค้นหาแชท" placeholder="ค้นหาแชท" bind:value={searchQuery} />
    </label>
  </header>

  <nav class="rooms" aria-label="ห้องสนทนา">
    {#if refreshError}<p class="empty" role="alert">รีเฟรชแชทไม่สำเร็จ กรุณาลองอีกครั้ง</p>{/if}
    {#if filteredRooms.length === 0}
      <p class="empty">{searchQuery.trim() ? 'ไม่พบแชทที่ตรงกับคำค้น' : 'ยังไม่มีห้องสนทนา'}</p>
    {:else}
      <ul>
        {#each filteredRooms as room (room.room_id)}
          {@const active = chatEngine.activeRoomId === room.room_id}
          <li>
            <button
              type="button"
              class="room-item"
              class:active
              aria-current={active ? 'true' : undefined}
              onclick={() => { chatEngine.selectRoom(room.room_id); onSelectRoom(); }}
            >
              <span class="room-avatar" class:group={room.kind === 'group'} aria-hidden="true">{initials(room.title)}</span>
              <span class="room-content">
                <span class="room-title">{room.title}</span>
                <span class="room-kind">
                  {chatEngine.revokedRooms[room.room_id] ? 'เข้าถึงไม่ได้' : room.kind === 'group' ? 'กลุ่ม' : 'แชทส่วนตัว'}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if chatEngine.roomsNextCursor}
      <button class="load-more" type="button" disabled={chatEngine.loadingMoreRooms} onclick={() => chatEngine.loadMoreRooms()}>
        {chatEngine.loadingMoreRooms ? 'กำลังโหลด…' : 'ดูแชทเพิ่มเติม'}
      </button>
    {/if}
  </nav>

  {#if chatEngine.session}
    {@const name = chatEngine.session.user.display_name}
    <footer>
      {#if onOpenDevDrawer}
        <button class="dev-entry" type="button" onclick={onOpenDevDrawer}>เครื่องมือทดสอบ</button>
      {/if}
      <details class="account">
        <summary aria-label={'เมนูบัญชี ' + name}>
          <span class="room-avatar profile-avatar" aria-hidden="true">{initials(name)}</span>
          <span class="profile-name">{name}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
        </summary>
        <div class="account-menu">
          <button type="button" onclick={() => chatEngine.setNotificationSound(!chatEngine.notificationSoundEnabled)}>{chatEngine.notificationSoundEnabled ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'}</button>
          <button type="button" onclick={toggleColorScheme}>{currentScheme === 'dark' ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'}</button>
          <button type="button" disabled={signingOut} onclick={() => signOut(false)}>ออกจากระบบ</button>
          {#if !onOpenDevDrawer}
            <button type="button" disabled={signingOut} onclick={() => signOut(true)}>ออกจากระบบทุกอุปกรณ์</button>
          {/if}
          {#if logoutError}<p role="alert">ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง</p>{/if}
        </div>
      </details>
    </footer>
  {/if}
</aside>

<style>
  .sidebar { width: clamp(272px, 26vw, 332px); height: 100%; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-sidebar); }
  .sidebar-header { padding: 22px 20px 14px; }
  .wordmark { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 700; }
  .heading-row { display: flex; align-items: center; justify-content: space-between; margin: 24px 0 14px; }
  h1 { font-size: 25px; line-height: 1.3; }
  .header-action { width: 36px; height: 36px; border: 0; border-radius: 8px; background: var(--bg-input); color: var(--brand-accent); font-size: 22px; margin-left: 5px; }
  .header-action:hover { background: var(--item-active); }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); background: var(--bg-input); }
  .search:focus-within { border-color: var(--brand-accent); }
  .search svg { flex-shrink: 0; }
  .search input { min-width: 0; width: 100%; min-height: 39px; border: none; outline: none; color: var(--text-primary); background: transparent; font: inherit; }
  .search input::placeholder { color: var(--text-secondary); }

  .rooms { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 10px; }
  ul { list-style: none; display: grid; gap: 2px; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: wait; }
  .room-item { width: 100%; display: flex; align-items: center; gap: 11px; padding: 9px 10px; min-height: 62px; border: 0; border-radius: 8px; background: transparent; color: var(--text-primary); text-align: left; }
  .room-item:hover, summary:hover, .account-menu button:hover { background: var(--item-hover); }
  .room-item.active { background: var(--item-active); }
  .room-avatar { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; background: var(--item-active); color: var(--brand-accent); font-weight: 700; }
  .room-avatar.group { background: var(--group-bg); color: var(--group-text); }
  .room-content { display: grid; min-width: 0; gap: 2px; }
  .room-title, .profile-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 650; }
  .room-kind, .empty { font-size: 12px; color: var(--text-secondary); }
  .empty { padding: 16px 10px; }
  .load-more, .dev-entry { border: 0; background: transparent; color: var(--brand-accent); padding: 10px; text-align: left; }

  footer { border-top: 1px solid var(--border); padding: 8px 10px; }
  .account { position: relative; }
  summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 10px; border-radius: 8px; list-style: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  summary svg { flex-shrink: 0; color: var(--text-secondary); }
  .profile-avatar { width: 32px; height: 32px; }
  .profile-name { flex: 1; }
  .account-menu { position: absolute; z-index: 2; inset: auto 0 calc(100% + 6px); padding: 5px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); box-shadow: 0 6px 24px #0002; }
  .account-menu button { display: block; width: 100%; padding: 9px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--text-primary); text-align: left; }
  .account-menu p { padding: 8px 10px; color: var(--status-red); }


  @media (prefers-reduced-motion: no-preference) {
    .room-item, summary, .account-menu button { transition: background-color 160ms ease; }
    .account-menu { animation: menu-in 160ms ease-out both; }
  }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 700px) { .sidebar { width: 100%; border-right: 0; } }
</style>
