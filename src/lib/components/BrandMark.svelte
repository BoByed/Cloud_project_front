<script lang="ts">
  let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="var(--brand-fill)" />
  <path d="M9 15.5a7 7 0 0 1 7-7h1a7 7 0 0 1 0 14h-3l-5 2v-9Z" stroke="white" stroke-width="1.65" stroke-linejoin="round" />
  <path d="M13 15.5h7" stroke="white" stroke-width="1.65" stroke-linecap="round" />
</svg>
