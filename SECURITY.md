# Security policy

## Public repository boundary

โครงการนี้ public ได้เฉพาะ source code, schema, summarized DRG rules, error/warning mapping และ synthetic fixtures เท่านั้น ห้าม commit:

- ผู้ป่วยจริง, HN/AN/VN, ชื่อ, diagnosis note, lab/image, SQL result หรือ database dump
- BMS session code, marketplace token, database password, AI key, cookie หรือ private key
- DRG/ICD catalog/code set/PDF หรือไฟล์ต้นฉบับที่มีข้อจำกัดการเผยแพร่
- internal hostname, private API endpoint หรือ environment ที่ผูกกับโรงพยาบาลจริง

`check-public.mjs` ตรวจ secret pattern, numeric patient identifier, SQL dump และ identifiers ที่อยู่ใน pasted reference เมื่อไฟล์อ้างอิงนั้นมีอยู่ในเครื่อง ส่วน CI ใช้ gitleaks เพิ่มอีกชั้นหนึ่ง

## Security controls

- BMS session อยู่ใน encrypted, HttpOnly, SameSite cookie; ไม่ใช้ browser storage
- `caseRef` เป็น opaque encrypted reference; access log เก็บ hash เท่านั้น
- BMS SQL เป็น registry แบบ read-only และ typed parameters; ไม่มี user-supplied SQL, `SELECT *`, unbounded page หรือ fan-out ที่ทำให้ cardinality แตก
- Postgres เก็บ audit payload/AI artifact/Markdown content เป็น ciphertext; clinical data ที่จำเป็นต้องเก็บต้องผ่าน data-owner approval
- Markdown รับ text/ขนาดจำกัด, filename ปลอดภัย, sanitize HTML/script และ path traversal
- AI output เป็น candidate เท่านั้น, evidence-first, human review required; inferred ไม่สามารถเลื่อนเป็น code จริง
- HTTP 200 ที่ไม่มี DRG/RW เป็น `empty`; ห้ามสร้าง mock grouper result
- Docker ใช้ non-root, read-only filesystem, `cap_drop: ALL`, `no-new-privileges`, tmpfs และ healthcheck
- Nginx ปิด framing, MIME sniffing, referrer leakage และกำหนด CSP/security headers

## Go-live gates

1. Platform/DBA/data-owner อนุมัติ BMS host, query registry, retention และ encryption key
2. Staging ใช้ anonymized database และ fresh BMS session เท่านั้น
3. Run `npm run check:public` หลังสร้าง artifact และตรวจ working tree/history ก่อน push
4. ตรวจ RBAC/session expiry, PostgreSQL readiness, image authorization, sanitizer, DRG version fence, neutral query และ empty grouper contract
5. ยืนยัน baseline summary p95 ≤ 5 วินาที และ detail p95 ≤ 3 วินาทีใน staging

## Reporting

หากพบ credential, PHI, private endpoint หรือ security defect ให้หยุดการเผยแพร่ artifact และแจ้งผู้ดูแล repository ผ่านช่องทางภายในขององค์กรพร้อมระบุ commit ที่เกี่ยวข้อง อย่าแนบข้อมูลผู้ป่วยหรือ token ใน issue สาธารณะ
