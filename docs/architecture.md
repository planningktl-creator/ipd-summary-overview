# Architecture

```text
Browser
  │ same-origin HTTPS / encrypted HttpOnly cookie
  ▼
Nginx static SPA :8080  ── /api/ ──▶  Node BFF :8788  ──▶  app PostgreSQL
                                      │
                                      └── allow-listed BMS SQL ──▶ HOSxP/BMS API
```

## Boundaries

### Web

React/Vite renders a responsive operations console. It calls same-origin `/api/*`, never stores BMS session/token in localStorage or sessionStorage, and displays masked/synthetic identifiers according to the source boundary.

### BFF

The BFF is the trust boundary for handshake, authorization, case reference resolution, query registry, pagination, AI redaction, audit events and attachment sanitization. `caseRef` contains a sealed `{hospitalCode, an, expiresAt}` payload and is never replaced by the source AN in URL/log output.

### Data providers

`DemoProvider` is isolated synthetic data for local/CI. `BmsProvider` calls only registered, explicit-column read queries and never falls back to demo data when BMS fails. A BMS response is mapped to the public contract; raw source identifiers remain internal.

### Audit repository

Memory storage is available for demo/test. With `DATABASE_URL`, `PostgresAuditRepository` stores hashed case references and encrypts audit ledger, AI output and Markdown content. Access logs contain actor/action/case hash/timestamp/outcome/correlation ID only.

## Request lifecycle

1. BMS session code is accepted once at `/api/session/handshake`.
2. BFF validates the pasted session payload, HTTPS/host allow-list and PostgreSQL database type.
3. Session secrets are sealed into an HttpOnly cookie with expiry.
4. A list query runs through the registry with bounded limit and typed parameters.
5. The BFF creates an opaque `caseRef`; detail queries resolve it internally and fetch only the selected case.
6. Audit ledger is initialized with raw/normalized input, validation and rule path. Human events and AI artifacts are appended separately.

## Failure semantics

- expired/malformed cookie: `401 SESSION_REQUIRED`
- disallowed role: `403 ROLE_FORBIDDEN`
- source failure: explicit error, never demo fallback
- HTTP 200 grouper with absent DRG/RW: `responseStatus=empty`
- disabled/unconfigured AI: `503`, never fabricated output
- unavailable clinical section: partial/missing contract, not inferred values
