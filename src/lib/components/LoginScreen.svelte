<script lang="ts">
  import BrandMark from './BrandMark.svelte';
  import { chatEngine } from '../services/chat-engine.svelte.js';
  import { httpClient, ApiError } from '../services/http-client.js';

  let { localDemo = false }: { localDemo?: boolean } = $props();
  let mode = $state<'login' | 'signup' | 'confirm'>('login');
  let email = $state('');
  let password = $state('');
  let name = $state('');
  let code = $state('');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  async function resendCode() {
    if (busy || !email.trim()) {
      error = 'กรุณากรอกอีเมล';
      return;
    }
    busy = true;
    error = '';
    message = '';
    try {
      await httpClient.resendSignupCode(email.trim());
      message = 'ส่งรหัสยืนยันอีกครั้งแล้ว';
    } catch (err) {
      error = err instanceof Error ? err.message : 'ส่งรหัสไม่สำเร็จ กรุณาลองอีกครั้ง';
    } finally {
      busy = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    message = '';
    try {
      if (mode === 'signup') {
        await httpClient.signup(email.trim(), password, name.trim());
        mode = 'login';
        message = 'สร้างบัญชีแล้ว กรุณาเข้าสู่ระบบ';
        await chatEngine.loginWithPassword(email.trim(), password);
        password = '';
      } else if (mode === 'confirm') {
        await httpClient.confirmSignup(email.trim(), code);
        code = '';
        mode = 'login';
        message = 'ยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบ';
      } else {
        await chatEngine.loginWithPassword(email.trim(), password);
        password = '';
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        mode = 'confirm';
        error = 'กรุณาใส่รหัสยืนยันที่ส่งไปยังอีเมลของคุณ';
      } else {
        error = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง';
      }
    } finally {
      busy = false;
    }
  }

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
      <h1 id="login-title">{mode === 'signup' ? 'สร้างบัญชี' : mode === 'confirm' ? 'ยืนยันอีเมล' : 'เข้าสู่ระบบ'}</h1>
      <p class="intro">{mode === 'signup' ? 'สร้างบัญชี Cloud Chat เพื่อเริ่มคุยกับเพื่อน' : mode === 'confirm' ? 'กรอกรหัสยืนยันที่ส่งไปยังอีเมลของคุณ' : 'เข้าสู่บัญชี Cloud Chat เพื่อเปิดข้อความและคุยกับเพื่อนต่อ'}</p>

      {#if chatEngine.authError}
        <p class="login-error" role="alert">เชื่อมต่อเพื่อเข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง</p>
      {/if}

      {#if error}<p class="login-error" role="alert">{error}</p>{/if}
      {#if message}<p class="notice" role="status">{message}</p>{/if}
      <form onsubmit={submit}>
        {#if mode === 'signup'}
          <label for="name">ชื่อที่แสดง</label>
          <input id="name" type="text" bind:value={name} maxlength="100" autocomplete="name" required />
        {/if}
        <label for="email">อีเมล</label>
        <input id="email" type="email" bind:value={email} maxlength="254" autocomplete="email" required />
        {#if mode === 'confirm'}
          <label for="code">รหัสยืนยัน</label>
          <input id="code" type="text" bind:value={code} inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
        {:else}
          <label for="password">รหัสผ่าน</label>
          <input id="password" type="password" bind:value={password} autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} minlength="8" maxlength="256" required />
          {#if mode === 'signup'}<p class="hint">อย่างน้อย 8 ตัวอักษร พร้อมตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และสัญลักษณ์</p>{/if}
        {/if}
        <button class="sign-in-link" type="submit" disabled={busy}>
          {busy ? 'กำลังดำเนินการ…' : mode === 'signup' ? 'สร้างบัญชี' : mode === 'confirm' ? 'ยืนยันอีเมล' : 'เข้าสู่ระบบ'}
        </button>
      </form>
      <div class="auth-switch">
        {#if mode === 'confirm'}
          <button type="button" disabled={busy} onclick={resendCode}>ส่งรหัสอีกครั้ง</button>
        {/if}
        {#if mode === 'login'}
          <button type="button" onclick={() => { mode = 'signup'; error = ''; message = ''; }}>สร้างบัญชีใหม่</button>
        {:else}
          <button type="button" onclick={() => { mode = 'login'; password = ''; error = ''; message = ''; }}>กลับไปเข้าสู่ระบบ</button>
        {/if}
      </div>

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
  form { display: grid; gap: 10px; }
  label { font-size: 14px; font-weight: 600; }
  input { width: 100%; min-height: 48px; padding: 10px 12px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-input); color: var(--text-primary); font: inherit; }
  input:focus-visible, button:focus-visible { outline: 3px solid #76bfa8; outline-offset: 2px; }
  .sign-in-link { width: 100%; border: 0; cursor: pointer; justify-content: center; font-family: inherit; }
  .sign-in-link:disabled { opacity: .65; cursor: wait; }
  .hint, .notice { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
  .notice { margin-bottom: 14px; }
  .auth-switch { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 18px; }
  .auth-switch button { padding: 4px 0; border: 0; background: none; color: var(--text-primary); font: inherit; text-decoration: underline; cursor: pointer; }
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
