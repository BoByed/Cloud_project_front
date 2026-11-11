<script lang="ts">
  import { chatEngine } from '../services/chat-engine.svelte.js';

  // Official seeded demo accounts in chat-api (fixtures)
  const defaultDevUsers = [
    { user_id: '11111111-1111-4111-8111-111111111111', display_name: 'Demo A' },
    { user_id: '22222222-2222-4222-8222-222222222222', display_name: 'Demo B' }
  ];

  let displayUsers = $derived(
    chatEngine.devUsers.length > 0 ? chatEngine.devUsers : defaultDevUsers
  );

  let isLoggingIn = $state(false);
  let loginError = $state<string | null>(null);

  async function handleDevLogin(userId: string) {
    isLoggingIn = true;
    loginError = null;
    try {
      await chatEngine.loginWithDevUser(userId);
    } catch (err) {
      loginError = err instanceof Error ? err.message : 'เข้าสู่ระบบจำลองไม่สำเร็จ';
    } finally {
      isLoggingIn = false;
    }
  }
</script>

<div class="login-wrapper">
  <div class="login-card">
    <!-- Brand Logo -->
    <div class="brand-badge">
      <svg viewBox="0 0 36 36" width="56" height="56" fill="none">
        <defs>
          <linearGradient id="login-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0084ff" />
            <stop offset="60%" stop-color="#0099ff" />
            <stop offset="100%" stop-color="#a033ff" />
          </linearGradient>
        </defs>
        <path
          d="M18 2C9.163 2 2 8.716 2 17c0 4.717 2.33 8.914 6 11.667V34l5.127-2.82c1.554.43 3.193.667 4.873.667 8.837 0 16-6.716 16-15S26.837 2 18 2z"
          fill="url(#login-grad)"
        />
        <path
          d="M10 20.5l5.5-5.8 4 4 6.5-6.2-5.5 5.8-4-4-6.5 6.2z"
          fill="#ffffff"
        />
      </svg>
    </div>

    <h2 class="login-title">Messenger Demo</h2>
    <p class="login-desc">Cloud Computing — Local-First Messaging Platform (v1)</p>

    {#if loginError}
      <div class="login-error-pill">
        <span>⚠️ {loginError}</span>
      </div>
    {/if}

    <!-- Section: Local Multi-User Switcher (M1/M2) -->
    <div class="dev-login-section">
      <div class="section-title">
        <span>เข้าใช้งานด้วยบัญชีจำลอง (Local Multi-User Demo)</span>
      </div>

      <div class="users-list">
        {#each displayUsers as user}
          <button
            type="button"
            class="user-login-row"
            disabled={isLoggingIn}
            onclick={() => handleDevLogin(user.user_id)}
          >
            <div class="user-avatar-circle">
              {user.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div class="user-text">
              <span class="user-name">{user.display_name}</span>
              <span class="user-sub">คลิกเพื่อเข้าสู่ระบบทันที (Local Mock)</span>
            </div>
            <span class="arrow-icon">→</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="divider">
      <span>หรือ</span>
    </div>

    <!-- Section: AWS Cognito Production Login -->
    <div class="cognito-section">
      <button
        type="button"
        class="cognito-btn"
        disabled={isLoggingIn}
        onclick={() => chatEngine.loginWithCognitoRedirect()}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>เข้าสู่ระบบด้วย AWS Cognito (/auth/login)</span>
      </button>
      <span class="cognito-note">
        (สำหรับสภาพแวดล้อม AWS Cloud Computing เมื่อเชื่อมต่อกับ Cognito User Pool)
      </span>
    </div>
  </div>
</div>

<style>
  .login-wrapper {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-app);
    padding: 20px;
    user-select: none;
  }

  .login-card {
    width: 100%;
    max-width: 440px;
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
  }

  .brand-badge {
    margin-bottom: 16px;
  }

  .login-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .login-desc {
    font-size: 13px;
    color: var(--text-secondary);
    text-align: center;
    margin-bottom: 24px;
  }

  .login-error-pill {
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    background-color: rgba(250, 56, 62, 0.12);
    color: var(--status-red);
    font-size: 12px;
    margin-bottom: 16px;
    text-align: center;
  }

  .dev-login-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .users-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .user-login-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background-color: var(--bg-input);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .user-login-row:hover:not(:disabled) {
    border-color: var(--brand-blue);
    background-color: var(--item-active);
    transform: translateY(-1px);
  }

  .user-login-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .user-avatar-circle {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--brand-gradient);
    color: white;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .user-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .user-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .user-sub {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .arrow-icon {
    font-size: 16px;
    color: var(--brand-blue);
    font-weight: 600;
  }

  .divider {
    width: 100%;
    display: flex;
    align-items: center;
    margin: 20px 0 16px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background-color: var(--border);
  }

  .divider span {
    padding: 0 12px;
  }

  .cognito-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .cognito-btn {
    width: 100%;
    padding: 10px 16px;
    border-radius: 10px;
    border: none;
    background-color: var(--bg-input);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.15s ease;
  }

  .cognito-btn:hover:not(:disabled) {
    background-color: var(--item-hover);
  }

  .cognito-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cognito-note {
    font-size: 11px;
    color: var(--text-secondary);
    text-align: center;
    line-height: 1.3;
  }
</style>
