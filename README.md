# CloudChat Frontend (LINE เถื่อน) — Cloud Native Web Client

เว็บแอปพลิเคชันส่วนหน้าสำหรับระบบ CloudChat (LINE เถื่อน) พัฒนาด้วย Svelte 5, SvelteKit (Static Adapter), TypeScript และ Vite ตามข้อกำหนดสถาปัตยกรรมคลาวด์ในเอกสารวิชา Cloud Computing (อ้างอิง Notion: [LINE เถื่อน - Cloud Computing](https://app.notion.com/p/LINE-Cloud-Computing-40376688030080eab849d47ee2c5ba29) และ [ตารางสรุป Terraform](https://app.notion.com/p/Terraform-415766880300808e8ff1cf16502336dd))

---

## 1. คุณสมบัติ Cloud Native (Cloud-Native Architecture)

- **Single Page Application (SPA)**: สร้างไฟล์แบบ Static (`adapter-static`) เพื่อนำไปเก็บใน Private S3 Bucket หลัง CloudFront OAC ได้อย่างมีประสิทธิภาพ
- **Single-Origin Edge Routing**: บน AWS สถาปัตยกรรมจะใช้ CloudFront เป็น Origin เดียว:
  - `/*` (Static assets) → Private S3 Bucket (ผ่าน Origin Access Control - OAC)
  - `/api/*`, `/auth/*`, `/health/*` → Application Load Balancer (ALB) เชื่อมต่อไปยัง ECS Fargate (`chat-api`)
  - WebSocket `/api/v1/ws` → ALB ส่งตรงไปยัง Go WebSocket Server ภายใต้ subprotocol `chat.v1`
- **12-Factor Containerization**:
  - Multi-stage `Dockerfile`:
    - **Stage 1 (Builder)**: Node 22 Alpine ทำการ install dependencies และ `npm run build`
    - **Stage 2 (Runner)**: `nginxinc/nginx-unprivileged:alpine` ทำงานแบบ **Non-root user** (UID 101) ปลอดภัยตามมาตรฐาน Least Privilege
  - ปรับแต่ง Nginx (`nginx.conf`):
    - รองรับ SPA Fallback (`try_files $uri $uri/ /index.html`)
    - รองรับ Reverse Proxy ไปยัง `chat-api:8080` สำหรับ `/api/`, `/auth/`, `/health/`
    - รองรับ WebSocket Handshake พร้อม Upgrade headers
    - ป้องกันความปลอดภัยด้วย HTTP Security Headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`)
    - แคชไฟล์ `_app/immutable/*` ตลอด 1 ปี (Immutable Caching) และไม่แคช `index.html` เพื่อให้อัปเดตเวอร์ชันได้ทันที
    - มี Liveness / Readiness Probe ที่ `/healthz` สำหรับ ECS / Kubernetes / Docker Healthcheck
- **Terraform Infrastructure as Code (`infra/`)**:
  - โค้ด Terraform สำหรับสร้าง Private S3 Bucket, CloudFront OAC, และ CloudFront Distribution ที่ผสานทั้ง S3 และ ALB ตามตารางสรุป Terraform
- **CI/CD Pipeline**: GitHub Actions (`.github/workflows/frontend-ci.yml`) ตรวจสอบ type check (`tsc --noEmit`), build static site และทดสอบ build Docker container อัตโนมัติ

---

## 2. การเชื่อมต่อกับ `chat-api` (Backend Integration)

ระบบรองรับการเชื่อมต่อกับ `chat-api` 2 รูปแบบอย่างราบรื่น:

### 1) โหมดทดสอบ Local (Local Multi-User Demo - M1/M2)
- Seeded demo users ของระบบ:
  - **Demo A**: `11111111-1111-4111-8111-111111111111`
  - **Demo B**: `22222222-2222-4222-8222-222222222222`
- เมื่อเลือกเข้าใช้งานด้วย Demo A หรือ Demo B:
  - Frontend จะแนบ Header `X-Local-Test-User-ID: <user_id>` ไปกับทุก HTTP request โดยอัตโนมัติ
  - Frontend จะตั้ง Cookie `local_test_user_id=<user_id>` ซึ่งทั้ง Vite dev proxy, Nginx container, และ Go backend จะส่งต่อไปยัง WebSocket handshake `/api/v1/ws` ทำให้สามารถต่อ WebSocket และคุยตอบโต้แบบเรียลไทม์ได้ทันที

### 2) โหมด Production (AWS Cognito OAuth2 & Sessions - M3+)
- เมื่อคลิก "เข้าสู่ระบบด้วย AWS Cognito":
  - เบราว์เซอร์จะ Redirect ไปที่ `/auth/login` (Cognito Hosted UI)
  - หลัง Authentication สำเร็จ Cognito callback จะส่งกลับมาที่ `/auth/callback` ซึ่งเซิร์ฟเวอร์จะตั้ง Secure, HttpOnly cookie (`__Host-chat_session`)
  - Frontend จะดึง Session และ CSRF Token ผ่าน `GET /api/v1/session`
  - คำขอแก้ไขข้อมูล (`POST /api/v1/...`) จะแนบ Header `X-CSRF-Token` โดยอัตโนมัติ

---

## 3. การรันระบบ (How to Run)

### วิธีที่ 1: รันแบบ Full Cloud-Native Stack ด้วย Docker Compose (แนะนำ)
รันคำสั่งจาก root ของโปรเจกต์:

```sh
docker compose up --build
```

ระบบจะเปิดบริการทั้งหมดขึ้นมาพร้อมกัน:
- **Frontend**: `http://localhost:3000` (Nginx Container)
- **Chat API & WebSocket**: `http://localhost:8080` (Go Server)
- **Transactional Outbox Worker**: Go Worker
- **PostgreSQL**: `localhost:5432`
- **Valkey (Redis Pub/Sub)**: `localhost:6379`
- **SeaweedFS (S3 Media Store)**: `http://localhost:8333`
- ระบบรัน Migration และ Seed ข้อมูลให้อัตโนมัติ

### วิธีที่ 2: รัน Frontend แยกในโหมด Development (Vite)
1. เปิด `chat-api` และ dependencies ให้พร้อม (ดูวิธีใน `chat-api/README.md`)
2. ติดตั้ง dependencies และเริ่ม Vite dev server:
   ```sh
   cd frontend
   npm install
   npm run dev
   ```
3. เข้าใช้งานที่ `http://localhost:5173` (Vite จะทำ Reverse Proxy คำขอ `/api`, `/auth`, `/health`, และ `/api/v1/ws` ไปยัง `http://localhost:8080` พร้อม Forward User identity อัตโนมัติ)

---

## 4. โครงสร้างไฟล์สำคัญ

```
frontend/
├── Dockerfile                      # Cloud-native multi-stage container build
├── nginx.conf                      # Production Nginx reverse proxy, SPA fallback, security & caching
├── .dockerignore                   # Docker build context exclusions
├── .github/workflows/
│   └── frontend-ci.yml             # GitHub Actions CI workflow (Check, Build, Docker)
├── infra/                          # Terraform IaC for Frontend & Edge
│   ├── main.tf                     # S3 Bucket, CloudFront OAC, CloudFront Distribution
│   ├── variables.tf                # AWS accounts, regions, ALB endpoints
│   ├── outputs.tf                  # Distribution domain and S3 bucket details
│   └── README.md                   # Infrastructure deployment guide
├── src/
│   ├── lib/
│   │   ├── components/             # Svelte UI components (Chat, Sidebar, Login, Drawer)
│   │   ├── services/
│   │   │   ├── http-client.ts      # HTTP Client with CSRF, Local Identity & Error Handling
│   │   │   ├── ws-client.ts        # chat.v1 WebSocket client with heartbeats & jitter reconnect
│   │   │   └── chat-engine.svelte.ts # Reactive message sync, recovery engine & outbox
│   │   ├── storage/indexeddb.ts    # Browser IndexedDB local persistence
│   │   └── types/contract.ts       # Type definitions & sequence BigInt helpers
│   └── routes/                     # SvelteKit SPA entry points
├── svelte.config.js                # SvelteKit config with @sveltejs/adapter-static
└── vite.config.ts                  # Vite config with backend proxy and header forwarding
```
