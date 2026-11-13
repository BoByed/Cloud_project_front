<script lang="ts">
  import { onMount } from 'svelte';
  import { httpClient } from '../services/http-client.js';

  let { url, description, width, height }: {
    url: string;
    description: string;
    width: number;
    height: number;
  } = $props();
  let imageWidth = $derived(width > 0 && height > 0 ? width : 240);
  let imageHeight = $derived(width > 0 && height > 0 ? height : 180);
  let thumbnailWidth = $derived(Math.min(imageWidth, 240, 240 * imageWidth / imageHeight));
  let objectUrl = $state<string | null>(null);
  let failed = $state(false);
  let dialog = $state<HTMLDialogElement>();
  let disposed = false;

  async function load() {
    failed = false;
    try {
      const blob = await httpClient.fetchImage(url);
      if (disposed) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
    } catch {
      failed = true;
    }
  }

  onMount(() => {
    load();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
</script>

<div class="image-frame" style:width={thumbnailWidth + 'px'} style:aspect-ratio={imageWidth + ' / ' + imageHeight}>
  {#if objectUrl}
    <button class="image-preview" type="button" onclick={() => dialog?.showModal()} aria-label="เปิดรูปขนาดใหญ่">
      <img src={objectUrl} alt={description || 'รูปภาพในแชท'} />
    </button>
  {:else if failed}
    <button class="image-retry" type="button" onclick={load} aria-label="โหลดรูปไม่สำเร็จ ลองโหลดอีกครั้ง" title="ลองโหลดอีกครั้ง">↻</button>
  {:else}
    <span class="image-loading" role="status" aria-label="กำลังโหลดรูป">…</span>
  {/if}
</div>

{#if objectUrl}
  <dialog class="image-viewer" bind:this={dialog} aria-label="รูปภาพในแชท">
    <button class="close-viewer" type="button" onclick={() => dialog?.close()} aria-label="ปิดรูปภาพ">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
    <img class="full-image" src={objectUrl} alt={description || 'รูปภาพในแชท'} />
  </dialog>
{/if}


<style>
  .image-frame {
    position: relative;
    max-width: 100%;
    min-width: min(32px, 100%);
    min-height: 32px;
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .image-preview, .image-retry, .image-loading {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
  }
  .image-preview { cursor: zoom-in; }
  .image-retry { cursor: pointer; font-size: 18px; }
  .image-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }

  .image-viewer {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 64px 20px 24px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: hidden;
  }
  .image-viewer[open] { display: grid; grid-template-rows: minmax(0, 1fr); place-items: center; }
  .image-viewer::backdrop { background: rgba(9, 16, 13, .92); backdrop-filter: blur(8px); }
  .full-image {
    display: block;
    max-width: min(100%, 1200px);
    max-height: 100%;
    min-height: 0;
    min-width: 0;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .25);
  }
  .close-viewer {
    position: absolute;
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 1px solid rgba(255, 255, 255, .28);
    border-radius: 50%;
    background: rgba(255, 255, 255, .12);
    color: white;
    cursor: pointer;
  }
  .close-viewer:hover { background: rgba(255, 255, 255, .24); }
  .close-viewer:focus-visible { outline: 2px solid white; outline-offset: 3px; }
  @media (prefers-reduced-motion: no-preference) {
    .close-viewer { transition: background-color 150ms ease; }
    .full-image { animation: image-in 180ms ease-out both; }
  }
  @keyframes image-in {
    from { opacity: 0; transform: scale(.98); }
    to { opacity: 1; transform: scale(1); }
  }
  @media (max-width: 700px) {
    .image-viewer { padding: 64px 12px 20px; }
  }
</style>
