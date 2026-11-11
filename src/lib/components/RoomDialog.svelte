<script lang="ts">
  import { onMount } from 'svelte';
  import { chatEngine } from '../services/chat-engine.svelte.js';
  import { httpClient } from '../services/http-client.js';
  import { generateUuid, type Room, type UserSummary } from '../types/contract.js';

  let { mode, room, onClose, onOpened }: {
    mode: 'new' | 'manage';
    room?: Room | null;
    onClose: () => void;
    onOpened: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let kind = $state<'dm' | 'group'>('dm');
  let title = $state('');
  let query = $state('');
  let results = $state<UserSummary[]>([]);
  let selected = $state<UserSummary[]>([]);
  let members = $state<Array<UserSummary & { role: string; is_active: boolean }>>([]);
  let busy = $state(false);
  let error = $state('');
  let requestId = $state(generateUuid());
  let nextCursor = $state<string | null>(null);
  let searchedQuery = $state('');
  const canManage = $derived(room?.membership_role === 'owner' || room?.membership_role === 'admin');

  onMount(() => {
    title = room?.title ?? '';
    dialog.showModal();
    if (mode === 'manage') loadMembers();
  });

  async function loadMembers() {
    if (!room) return;
    try { members = (await httpClient.fetchMembers(room.room_id)).items; }
    catch { error = 'โหลดรายชื่อสมาชิกไม่สำเร็จ'; }
  }

  async function search(more = false) {
    const term = more ? searchedQuery : query.trim();
    if (!term || busy) return;
    busy = true; error = '';
    try {
      const page = await httpClient.searchUsers(term, 20, more ? nextCursor : null);
      results = more ? [...results, ...page.items] : page.items;
      searchedQuery = term;
      nextCursor = page.next_cursor;
    } catch { error = 'ค้นหาผู้ใช้ไม่สำเร็จ กรุณาลองอีกครั้ง'; }
    finally { busy = false; }
  }

  function toggle(user: UserSummary) {
    if (kind === 'dm' && mode === 'new') selected = [user];
    else if (selected.some(item => item.user_id === user.user_id)) selected = selected.filter(item => item.user_id !== user.user_id);
    else if (selected.length < 19) selected = [...selected, user];
    requestId = generateUuid();
  }

  async function create() {
    if (busy || (kind === 'dm' ? selected.length !== 1 : !title.trim())) return;
    busy = true; error = '';
    try {
      const result = await httpClient.createRoom(kind === 'dm'
        ? { kind: 'dm', user_id: selected[0].user_id }
        : { kind: 'group', title: title.trim(), member_ids: selected.map(user => user.user_id), request_id: requestId });
      await chatEngine.refreshRooms(result.room_id);
      onOpened(); dialog.close();
    } catch { error = 'สร้างแชทไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง'; }
    finally { busy = false; }
  }

  async function addMembers() {
    if (!room || !selected.length || busy) return;
    busy = true; error = '';
    try {
      await httpClient.addMembers(room.room_id, selected.map(user => user.user_id), requestId);
      selected = []; requestId = generateUuid();
      await loadMembers();
    } catch { error = 'เพิ่มสมาชิกไม่สำเร็จ กลุ่มมีสมาชิกได้ไม่เกิน 20 คน'; }
    finally { busy = false; }
  }

  async function rename() {
    if (!room || busy || !title.trim()) return;
    busy = true; error = '';
    try {
      await httpClient.renameGroup(room.room_id, title.trim());
      await chatEngine.refreshRooms(room.room_id);
      dialog.close();
    } catch { error = 'เปลี่ยนชื่อกลุ่มไม่สำเร็จ กรุณาลองอีกครั้ง'; }
    finally { busy = false; }
  }

  async function remove(user: UserSummary) {
    if (!room || busy) return;
    const self = user.user_id === chatEngine.session?.user.user_id;
    if (!confirm(self ? 'ออกจากกลุ่มนี้หรือไม่?' : `นำ ${user.display_name} ออกจากกลุ่มหรือไม่?`)) return;
    busy = true; error = '';
    try {
      await httpClient.removeGroupMember(room.room_id, user.user_id);
      if (self) { chatEngine.forgetRoom(room.room_id); dialog.close(); }
      else await loadMembers();
    } catch { error = 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง'; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="room-dialog-title">
  <div class="dialog-content">
    <header><h2 id="room-dialog-title">{mode === 'new' ? 'เริ่มแชทใหม่' : 'จัดการกลุ่ม'}</h2><button class="close" type="button" onclick={() => dialog.close()} aria-label="ปิด">×</button></header>
    <div class="body">
      {#if mode === 'new'}
        <div class="tabs" aria-label="ประเภทแชท">
          <button type="button" class:active={kind === 'dm'} onclick={() => { kind = 'dm'; selected = []; requestId = generateUuid(); }}>แชทส่วนตัว</button>
          <button type="button" class:active={kind === 'group'} onclick={() => { kind = 'group'; selected = []; requestId = generateUuid(); }}>สร้างกลุ่ม</button>
        </div>
      {/if}

      {#if (mode === 'new' && kind === 'group') || (mode === 'manage' && canManage)}
        <label class="field">ชื่อกลุ่ม
          <input maxlength="200" bind:value={title} oninput={() => requestId = generateUuid()} placeholder="ตั้งชื่อกลุ่ม" />
        </label>
        {#if mode === 'manage'}<button type="button" class="secondary" disabled={busy || !title.trim() || title.trim() === room?.title} onclick={rename}>บันทึกชื่อ</button>{/if}
      {/if}

      {#if mode === 'manage'}
        <h3>สมาชิก ({members.length}/20)</h3>
        <ul class="people">
          {#each members as member (member.user_id)}
            {@const self = member.user_id === chatEngine.session?.user.user_id}
            <li><span>{member.display_name} {self ? '(คุณ)' : ''}<small>{member.role === 'owner' ? 'เจ้าของ' : member.role === 'admin' ? 'ผู้ดูแล' : 'สมาชิก'}{member.is_active ? '' : ' · ไม่พร้อมใช้งาน'}</small></span>
              {#if member.role !== 'owner' && (self || room?.membership_role === 'owner' || (room?.membership_role === 'admin' && member.role === 'member'))}
                <button class="text-action" type="button" disabled={busy} onclick={() => remove(member)}>{self ? 'ออกจากกลุ่ม' : 'นำออก'}</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if room?.membership_role === 'owner'}<p class="hint">เจ้าของกลุ่มไม่สามารถออกจากกลุ่มได้</p>{/if}
      {/if}

      {#if mode === 'new' || canManage}
        <form class="search-form" onsubmit={(event) => { event.preventDefault(); search(); }}>
          <label class="field">ค้นหาผู้ใช้
            <input bind:value={query} placeholder="พิมพ์ชื่อ" />
          </label>
          <button class="secondary" disabled={busy || !query.trim()}>ค้นหา</button>
        </form>
        {#if searchedQuery && results.length === 0}<p class="hint">ไม่พบผู้ใช้</p>{/if}
        <ul class="people">
          {#each results as user (user.user_id)}
            {@const chosen = selected.some(item => item.user_id === user.user_id)}
            {@const alreadyMember = members.some(item => item.user_id === user.user_id)}
            <li><span>{user.display_name}{#if alreadyMember}<small>เป็นสมาชิกแล้ว</small>{/if}</span>
              <button class="text-action" type="button" disabled={busy || alreadyMember} onclick={() => toggle(user)}>{chosen ? 'เลือกแล้ว ✓' : 'เลือก'}</button>
            </li>
          {/each}
        </ul>
        {#if nextCursor}<button type="button" class="text-action" disabled={busy} onclick={() => search(true)}>ดูเพิ่มเติม</button>{/if}
        {#if selected.length}<p class="hint">เลือกแล้ว: {selected.map(user => user.display_name).join(', ')}</p>{/if}
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
    <footer>
      <button type="button" class="secondary" onclick={() => dialog.close()}>ปิด</button>
      {#if mode === 'new'}
        <button type="button" class="primary" disabled={busy || (kind === 'dm' ? selected.length !== 1 : !title.trim())} onclick={create}>{kind === 'dm' ? 'เริ่มแชท' : 'สร้างกลุ่ม'}</button>
      {:else if canManage}
        <button type="button" class="primary" disabled={busy || !selected.length} onclick={addMembers}>เพิ่มสมาชิก</button>
      {/if}
    </footer>
  </div>
</dialog>

<style>
  .dialog-content { display: flex; flex-direction: column; max-height: min(85dvh, 720px); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; }
  header { border-bottom: 1px solid var(--border); }
  h2 { font-size: 19px; } h3 { font-size: 14px; margin-top: 16px; }
  .body { padding: 18px 20px; overflow-y: auto; display: grid; gap: 12px; }
  footer { border-top: 1px solid var(--border); justify-content: flex-end; }
  button, input { font: inherit; }
  button { cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .close { border: 0; background: transparent; color: var(--text-secondary); font-size: 25px; }
  .tabs { display: flex; gap: 8px; }
  .tabs button, .secondary, .primary { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--bg-surface); color: var(--text-primary); }
  .tabs .active { border-color: var(--brand-accent); background: var(--item-active); color: var(--brand-accent); }
  .primary { border-color: var(--brand-fill); background: var(--brand-fill); color: white; }
  .field { display: grid; gap: 5px; flex: 1; min-width: 0; font-weight: 600; }
  input { width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-input); color: var(--text-primary); }
  .search-form { display: flex; gap: 8px; align-items: end; }
  .people { list-style: none; display: grid; gap: 4px; }
  .people li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  small { display: block; color: var(--text-secondary); }
  .text-action { background: transparent; border: 0; color: var(--brand-accent); padding: 6px; }
  .hint { color: var(--text-secondary); font-size: 12px; }
  .error { color: var(--status-red); }
</style>
