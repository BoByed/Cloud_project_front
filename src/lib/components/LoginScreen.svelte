<script lang="ts">
  import BrandMark from './BrandMark.svelte';
  import { chatEngine } from '../services/chat-engine.svelte.js';

  let { localDemo = false }: { localDemo?: boolean } = $props();

  async function signInAsDemo(userId: string) {
    try {
      await chatEngine.loginWithDevUser(userId);
    } catch {
      // The sign-in screen displays the engine's error after it finishes loading.
    }
  }
</script>

<main class="login">
  <section class="sign-in" aria-labelledby="login-title">
    <div class="sign-in-inner">
      <div class="wordmark"><BrandMark size={36} /> Cloud Chat</div>
      <h1 id="login-title">เข้าสู่ระบบ</h1>
      <p class="intro">เข้าสู่บัญชี Cloud Chat เพื่อเปิดข้อความและคุยกับเพื่อนต่อ</p>

      {#if chatEngine.authError}
        <p class="login-error" role="alert">เชื่อมต่อเพื่อเข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง</p>
      {/if}

      <a class="sign-in-link" href="/auth/login" data-sveltekit-reload>
        เข้าสู่ระบบ
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 12h15m-6-6 6 6-6 6" />
        </svg>
      </a>

      {#if localDemo}
        <details class="local-demo">
          <summary>บัญชีทดสอบในเครื่อง</summary>
          <div class="demo-accounts">
            {#each chatEngine.devUsers as user (user.user_id)}
              <button type="button" onclick={() => signInAsDemo(user.user_id)}>{user.display_name}</button>
            {/each}
          </div>
        </details>
      {/if}
    </div>
  </section>

  <aside class="preview" aria-hidden="true">
    <div class="preview-inner">
      <p class="preview-title">คุยเรื่องงาน<br />นัดเจอเพื่อน</p>
      <div class="sample-chat">
        <div class="sample-header"><span class="sample-avatar">พ</span> นัดกินข้าว</div>
        <p class="sample-incoming">เย็นนี้เจอกันกี่โมงดี?</p>
        <p class="sample-outgoing">หกโมงที่ร้านเดิมนะ</p>
      </div>
    </div>
  </aside>
</main>

<style>
  .login {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--bg-surface);
  }

  .sign-in, .preview { display: grid; place-items: center; padding: clamp(32px, 6vw, 88px); }
  .sign-in-inner { width: min(100%, 360px); }
  .wordmark { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; margin-bottom: 40px; }
  h1 { font-size: clamp(30px, 4vw, 42px); line-height: 1.25; }
  .intro { margin: 10px 0 28px; color: var(--text-secondary); font-size: 15px; line-height: 1.7; }
  .sign-in-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 0 16px;
    border-radius: 9px;
    background: var(--brand-fill);
    color: white;
    font-size: 15px;
    font-weight: 650;
    text-decoration: none;
  }
  .sign-in-link:hover { background: var(--brand-fill-hover); }
  .login-error { margin-bottom: 12px; color: var(--status-red); }
  .local-demo { margin-top: 20px; color: var(--text-secondary); }
  .local-demo summary { cursor: pointer; }
  .demo-accounts { display: flex; gap: 8px; margin-top: 10px; }
  .demo-accounts button { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-input); color: var(--text-primary); cursor: pointer; }

  .preview { background: #143c31; color: #f6f6eb; }
  .preview-inner { width: min(100%, 376px); }
  .preview-title { font-size: clamp(32px, 4vw, 54px); font-weight: 700; line-height: 1.3; margin-bottom: 32px; }
  .sample-chat { display: grid; gap: 12px; padding: 18px; border: 1px solid #56756a; border-radius: 14px; background: #20483c; font-size: 14px; }
  .sample-header { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid #56756a; font-weight: 600; }
  .sample-avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #f0ddba; color: #3f392c; }
  .sample-incoming, .sample-outgoing { padding: 8px 12px; border-radius: 10px; }
  .sample-incoming { justify-self: start; background: #385e52; }
  .sample-outgoing { justify-self: end; background: #d8ebdb; color: #193b31; }


  @media (prefers-reduced-motion: no-preference) {
    .sign-in-inner { animation: rise-in 450ms cubic-bezier(.22, 1, .36, 1) both; }
    .preview-inner { animation: rise-in 600ms 80ms cubic-bezier(.22, 1, .36, 1) both; }
    .sample-incoming { animation: bubble-in 400ms 400ms ease-out both; }
    .sample-outgoing { animation: bubble-in 400ms 650ms ease-out both; }
    .sign-in-link { transition: background-color 180ms ease, transform 180ms ease; }
    .sign-in-link:hover { transform: translateY(-2px); }
    .sign-in-link svg { transition: transform 180ms ease; }
    .sign-in-link:hover svg { transform: translateX(4px); }
  }

  @keyframes rise-in {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes bubble-in {
    from { opacity: 0; transform: translateY(6px) scale(.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (max-width: 700px) {
    .login { grid-template-columns: minmax(0, 1fr); }
    .preview { display: none; }
  }
</style>
