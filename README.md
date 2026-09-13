# IPD Summary Overview

ระบบติดตามภาพรวมผู้ป่วยในสำหรับงานปฏิบัติการและ DRG audit แบบ evidence-first ใช้ React/Vite + TypeScript, Node BFF, PostgreSQL สำหรับ audit state และ Nginx สำหรับ static SPA

โครงการนี้เป็น public-safe implementation: demo ใช้ synthetic fixtures เท่านั้น และไม่เก็บ HN/AN/VN จริง, SQL dump, catalog/code set เต็ม, PDF ต้นฉบับ หรือ credential ใด ๆ

## What is included

- Admission overview: search, ward/status/date filters, admit/discharge, finance pulse และ case selection
- Patient detail แบบ section/lazy boundary สำหรับ clinical, orders, lab, imaging, nursing, fluid balance, finance, DRG audit และ Markdown evidence
- BFF endpoints สำหรับ session, cases, audit events, AI artifacts และ attachments
- Opaque `caseRef` ใน URL/log; BFF เท่านั้นที่ map กลับไปยัง source-side AN
- Query registry แบบ allow-list, read-only, typed parameters, explicit columns และ bounded pagination
- DRG audit ledger ที่แยก raw/normalized input, evidence, candidate, validation, grouping trace และ discrepancy
- Local Docker topology: `web` → `api` → `postgres`; web เปิดที่ `http://localhost:3082`

## Quick start: synthetic demo

```powershell
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run dev
```

เปิด `http://localhost:5173` สำหรับ Vite dev server หรือใช้ production container ตาม deployment runbook

## Local Docker

คัดลอก `.env.example` เป็น `.env` แล้วเปลี่ยนค่าความลับทุกตัวก่อนใช้งาน:

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d
docker compose run --rm api node scripts/migrate.mjs
```

เปิด `http://localhost:3082` และตรวจ `http://localhost:3082/healthz` จาก web หรือ `http://localhost:8788/healthz` จาก API container

## BMS Marketplace handshake

ตั้ง `APP_MODE=bms`, BMS marketplace token และ secret ผ่าน environment/secret store เท่านั้น จากนั้น client ส่ง `POST /api/session/handshake` ด้วย session code ที่ได้รับจาก BMS URL ครั้งแรก BFF จะแลก session กับ PasteJSON endpoint, ตรวจ host/protocol/database type และเก็บข้อมูลไว้ใน encrypted HttpOnly cookie เท่านั้น

ห้ามส่ง session code ผ่าน query ต่อหลัง handshake, ห้ามใช้ localStorage/sessionStorage และห้ามเปิด public CORS proxy ไปยัง HOSxP รายละเอียดอยู่ที่ [docs/deployment.md](docs/deployment.md) และ [docs/architecture.md](docs/architecture.md)

## DRG audit contract

ระบบยึด version fence: Thai DRG 6.3.3, ICD-10/ICD-10-TM 2016 และ ICD-9-CM 2015 โดยเก็บ engine/API build แยกต่างหาก ผล grouper ที่ HTTP 200 แต่ไม่มี DRG/RW เป็น `empty` และไม่สร้างผลจำลอง ดู [docs/drg-audit-contract.md](docs/drg-audit-contract.md)

กฎสาธารณะใน repo นี้เป็น summary/schema/fixture เท่านั้น ไม่ใช่การแจกจ่าย DRG/ICD catalog หรือ proprietary rule file ฉบับเต็ม การออกแบบสอดคล้องกับเอกสาร DRG audit ใน Obsidian ที่ใช้เป็น reference ภายใน แต่ไม่ได้คัดลอกไฟล์ต้นฉบับเข้ามา

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check:public
docker compose config
docker compose build
```

Performance numbers ใน UI (`summary p95 ≤ 5s`, `detail p95 ≤ 3s`) เป็น release baseline จาก CMI runbook ไม่ใช่ SLA ถาวร

## Repository policy

ดู [SECURITY.md](SECURITY.md) สำหรับ public-repo boundary, incident/reporting และ go-live checklist reference ภายนอกต้องไม่ถูกแก้ไขโดยโครงการนี้
