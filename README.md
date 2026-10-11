# Smart Parking Management System (ระบบบริหารลานจอดรถอัจฉริยะ)

Full-stack parking platform: LPR/ANPR + general OCR (real plates, paper signs, windshield text, province reading),
entry/exit/payment kiosks, QR tickets, server-side fee engine, QR payment, information counter validation,
Merchant POS with verifiable receipts, members/passes, admin dashboard, centralized font & design configuration,
audit log, PDPA retention, offline-capable edge agent. All screens share one database and update in real time (Socket.IO).

## Layout
| Folder | What |
|---|---|
| `shared/` | Pure engines used by server, web and edge: Thai plate parsing + multi-source identification (`plate.ts`), 77 provinces + fuzzy matching, fee engine (`pricing.ts`), validation/stamp rules (`validation.ts`), design configuration model & resolver (`design/`), ESC/POS raster encoder |
| `server/` | Express 5 + Socket.IO + SQLite (`node:sqlite`). Schema in `src/db/schema.sql`, routes in `src/routes`, business logic in `src/services`, hardware/payment adapters in `src/adapters` |
| `web/` | React 19 (Vite). Admin, kiosks, customer QR site, counter, merchant portal/POS, customer display |
| `edge/` | Site agent: printer bridge (USB/LAN/serial/Bluetooth), barrier controllers (HTTP relay/TCP/serial/GPIO), RTSP/ONVIF snapshot + OCR, durable offline queue + idempotent sync |

## Run locally
```bash
npm install
npm run dev            # server :8080 + web :5173 (proxy)
# or production-like
npm run build && npm start   # serves web/dist from :8080
npm test
```
First start seeds demo data: `owner / admin1234` (or `ADMIN_PASSWORD`), staff users `admin manager info cashier staff auditor abc.owner abc.cashier fresh.owner` (password `demo1234`, PIN `1234`), demo device keys (`demo-entry-kiosk-key`, …). Set `SEED_DEMO=0` for an empty production database.

Kiosks/counters are bound to a device once: open `/setup?key=<device key>`.

## Key flows
1. **Entry** — camera/edge posts `POST /api/lpr/events` → all candidates stored with raw OCR + confidences → policy picks result (priority, thresholds) → kiosk shows plate/province → ticket printed (bitmap ESC/POS, QR with unguessable token) → barrier opens.
2. **Customer** — QR opens `/p/<token>`: live timer, fee, stamps, payment (amount always computed by server).
3. **Validation** — counter or payment kiosk scans `PV1.<receipt_no>.<token>` from a Merchant POS receipt; server verifies (exists, paid, not void/refunded, not used, merchant eligible, age, site) and applies rules; receipt marked used.
4. **Payment** — gateway webhook (verified signature / re-fetch) → PAID → grace period; overstay billed automatically.
5. **Exit** — camera reads plate+province → paid ⇒ barrier opens and session closes (QR revoked); unpaid ⇒ amount + QR on exit screen; mismatch ⇒ staff review with entry/exit images.

## Configuration
| Env | Meaning |
|---|---|
| `PORT`, `PUBLIC_URL` | listen port; base URL printed in ticket QR codes |
| `DATA_DIR` | SQLite DB, uploads, backups (mount a persistent disk here) |
| `ADMIN_PASSWORD` | initial owner password |
| `PAYMENT_PROVIDER` | `mock` (signed simulated webhooks, real PromptPay EMV QR) or `omise` (+ `OMISE_SECRET_KEY`) |
| `PROMPTPAY_ID` | PromptPay target for QR payloads |
| `ALLOW_MOCK_PAY=1` | allow the mock "simulate payment" endpoint in production (demo only) |
| `GOOGLE_FONTS_API_KEY` | optional, full Google Fonts search |

## Deploy on Render
`render.yaml` is a Blueprint (Singapore, starter plan, 5 GB disk at `/var/data`). SQLite needs the persistent disk — on the free plan the database resets on every deploy/restart.

## Hardware integration
* **Cameras**: LPR cameras push results (`/api/lpr/events/platerecognizer`, `/generic`, `/ocr`) with their device key; plain IP/RTSP/ONVIF cameras are polled/triggered by the edge agent (`POST http://127.0.0.1:9110/trigger/<cameraId>` from a loop detector) which runs OCR.
* **Printers**: browsers render tickets/receipts with the configured fonts → raster → `bridge` (edge agent on the kiosk PC), `lan` (server sends to host:9100) or `edge` (relayed via the site agent).
* **Barriers**: `http` relay URL, raw `tcp`, or `edge` (serial relay / GPIO).
* **Offline**: the edge agent keeps a durable queue and a cache of active/paid sessions; entries get offline tickets, exits follow `offlineExitPolicy`; everything is replayed idempotently via `/api/edge/sync`.

## Security & PDPA
Role-based permissions (Owner, Admin, Manager, Information, Cashier, Parking Staff, Auditor, merchant roles); second-person approval (username + PIN) for waivers, manual discounts, manual barrier, refunds, voids; audit log with before/after; LPR images stored privately and served only with `images.view` (access audited); retention job deletes images and anonymises plates after configured days; nightly SQLite backups.
