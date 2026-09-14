# IPD Summary Overview — Live Deployment Findings

วันที่ตรวจ: 2026-09-14 (Asia/Bangkok)

เอกสารนี้สรุปผลจากการตรวจ deployment URL, repository และ BMS session flow ที่ได้รับมา โดยไม่บันทึก session ID, token, HN, AN, ชื่อผู้ป่วย หรือ response ที่มีข้อมูลผู้ป่วยจริง

## ขอบเขตที่ตรวจ

- Deployment URL: `https://ipd-summary-dashboard-10929.kube.bmscloud.in.th/`
- Repository: <https://github.com/planningktl-creator/ipd-summary-overview>
- Branch: `main`
- Release commit: `816d8ed` — `fix: bootstrap BMS session from marketplace URL`
- Session ID ที่ใช้ตรวจถูกละเว้นจากเอกสารนี้และไม่ควรนำกลับมาใช้ซ้ำ

## ผลตรวจ deployment ปัจจุบัน

| รายการ | ผลที่พบ |
| --- | --- |
| หน้า root | `HTTP 200`, `Content-Type: text/html`, server ระบุเป็น `openresty` |
| JavaScript bundle | ยังเป็น bundle เก่า `index-fDV6OeFk.js` |
| BMS URL bootstrap | ไม่พบ `bms-session-id` ใน bundle |
| Handshake client | ไม่พบ `/api/session/handshake` ใน bundle |
| List snapshot | ไม่พบ `admissionSnapshot` ใน bundle |
| `GET /api/session` | ได้ SPA HTML ไม่ใช่ JSON |
| `GET /api/session/handshake` | ได้ SPA HTML ไม่ใช่ JSON |
| `GET /healthz` | ได้ SPA HTML ไม่ใช่ health response |
| `POST /api/session/handshake` | `405 Not Allowed` |

คำสั่ง curl ที่ได้รับมาเป็น document GET จึงยืนยันได้เพียงว่า static HTML ถูกส่งออกมา ไม่ได้ยืนยันว่า BFF/API หรือ BMS handshake ใช้งานได้

## สาเหตุหลัก

Deployment ที่ตรวจอยู่เป็น static web artifact หรือ web-only container และยังไม่ได้ expose/route Node BFF ให้กับ `/api/*` จึงเกิด SPA fallback เมื่อเรียก API

ใน repository มี topology สองแบบ:

1. Root `Dockerfile` เป็น Marketplace-compatible SPA image ที่รัน Nginx static เท่านั้น
2. `docker-compose.yaml` เป็น topology เต็มที่แยก `web`, `api` และ `postgres`

ดังนั้นการ push GitHub อย่างเดียวไม่ทำให้โดเมน live เปลี่ยน เพราะ repository นี้ยังไม่มี CD workflow สำหรับสร้าง image และ deploy เข้า BMS/Kubernetes โดยอัตโนมัติ

## สิ่งที่แก้ในโค้ดแล้ว

ใน `apps/web/src/api.ts` เพิ่มการทำงานดังนี้:

1. อ่าน `bms-session-id` จาก URL ครั้งแรก
2. ลบค่าออกจาก address bar/history ก่อนส่ง request ต่อ เพื่อไม่ให้ติดไปกับ referrer หรือ URL ภายหลัง
3. ส่งค่าให้ `POST /api/session/handshake` เพียงครั้งเดียว
4. ใช้ encrypted HttpOnly cookie ต่อกับ `GET /api/session` และ `GET /api/cases`
5. ไม่ใช้ localStorage หรือ sessionStorage

เพิ่ม regression test ที่ `apps/web/src/api.test.tsx` และ browser smoke ที่ `scripts/browser_smoke.py` โดยใช้ synthetic session เท่านั้น

## สถานะการตรวจใน repository

ผ่านแล้ว:

- TypeScript typecheck
- ESLint
- Unit/API/component tests: 12 tests ผ่าน
- Production build
- Public safety scan
- Docker Compose build ของ web และ API
- Browser smoke: handshake, URL cleanup, admission list, browser storage และ console/network safety
- GitHub CI run `34778950289`: success

## สิ่งที่ต้องทำก่อนใช้งาน live

### ทางเลือกที่แนะนำ: deploy แยก service

ตั้ง routing ให้เป็น:

```text
/       -> web:8080
/api/*  -> api:8788
api     -> application PostgreSQL
```

พร้อมตั้งค่า `APP_MODE=bms`, BMS allow-list, marketplace token และ production secrets ผ่าน secret store เท่านั้น

### Acceptance test หลัง redeploy

ใช้ fresh BMS session เท่านั้น แล้วตรวจว่า:

1. เปิด Marketplace URL ที่มี `bms-session-id`
2. browser เรียก `POST /api/session/handshake` สำเร็จ
3. URL หลังโหลดไม่มี `bms-session-id`
4. `GET /api/session` คืน JSON เฉพาะ status/actor metadata และไม่มี token
5. `GET /api/cases` คืน JSON และแต่ละ row มี `admissionSnapshot`
6. หน้า list แสดงเตียง/ห้อง, แพทย์รับไว้, สิทธิ์, PDx, การเงิน และสรุปจำหน่าย
7. ตรวจ query cardinality, latency และ HOSxP read-only กับ DBA/data owner

หาก BMS Marketplace รองรับได้เพียง container เดียว ต้องมีการตัดสินใจแยกต่างหากว่าจะสร้าง single-container web+API image หรือใช้ API service ภายนอก ไม่ควรเปลี่ยน topology โดยไม่มี platform/DBA sign-off

## Security note

Session ID ที่ถูกส่งมาในแชตควรถูก revoke/rotate ก่อนใช้งานจริง แม้การตรวจ live ครั้งนี้จะได้รับ `405` และไม่ได้ยืนยันการทำ BMS handshake สำเร็จก็ตาม ห้ามใส่ session, token, credential, patient data หรือ response จริงลงใน public repository, screenshot, issue หรือเอกสาร deployment

