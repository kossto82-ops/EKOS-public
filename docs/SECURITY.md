# Enterprise Security, Auth & Compliance

**Purpose:** This document specifies the identity, access, encryption, auditing, and compliance guidelines for the Enterprise Knowledge Platform. It defines security controls required for production deployment.
**Owner:** Chief Information Security Officer (CISO) / Security Architect
**Last Updated:** 2026-06-30
**Status:** Approved Template

---

## 1. Identity & Access Management (SSO)

The platform relies on enterprise Identity Providers (IdP) to handle user credentials.
- **Protocol**: OIDC (OpenID Connect) or SAML 2.0.
- **Token Format**: Cryptographically signed JSON Web Tokens (JWT) using RS256 algorithms.
- **Session Limits**: Active sessions are restricted to a maximum duration (e.g., 8 hours), requiring re-authentication through company Single Sign-On (SSO) workflows.

> **Current implementation status:** the target state above (signed JWTs from a real
> IdP) is not yet wired up — see `docs/KNOWN_LIMITATIONS.md`. What exists today:
> `src/server/middleware/auth.ts` requires every `/api/db/*` and AI route to carry an
> `Authorization: Bearer <id>` header, resolves that id against the same
> role/department source of truth the client uses, and enforces the RBAC matrix below
> server-side (401 for an unrecognized id, 403 for a recognized id without the
> permission). The `<id>` itself is unsigned — it is not a JWT and carries no
> cryptographic proof — so this stops "any anonymous caller can do anything" but does
> not yet stop identity spoofing by a party who already knows a valid user id.
>
> **Update (2026-08-13):** a real authentication mode now exists behind
> configuration. When corporate OAuth2 client credentials are set, the backend
> runs an authorization-code + PKCE BFF login (`src/server/routes/auth.ts`),
> validates the caller by **token introspection** and holds the tokens in a
> server-side session (signed `httpOnly` cookie; tokens encrypted at rest). Note
> the mechanism differs from the "RS256 JWT" wording above: the corporate
> authorization server issues **opaque tokens verified by introspection**, not
> signed JWTs — functionally equivalent against spoofing. See
> `docs/AUTH_INTEGRATION_PLAN.md`. The frontend wiring (Phase 2c) is the remaining
> step before this mode is the default; until then the interim unsigned-id scheme
> above is what a default deployment uses.

---

## 2. Role-Based Access Control (RBAC) Matrix

Access to views, documents, and system configurations is strictly governed by user security roles.

| User Role | View Documents | Ingest Sources | Alter Governance | Download Attachments | Access Audit Logs |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **System Administrator**| Yes | Yes | Yes | Yes | Yes |
| **Governance Officer** | Yes | No | Yes | No | Yes |
| **Knowledge Manager** | Yes | Yes | No | Yes | No |
| **Standard Employee** | Yes | No | No | Yes | No |
| **Guest User** | Partial | No | No | No | No |

> **Current implementation status:** the five personas above are an aspirational
> enterprise role set and do **not** match the prototype. The roles actually
> implemented, ascending in permission, are **Agent → Operator → TeamLeader →
> LocationManager → Administrator**, plus an IT-department flag (`departmentIds`
> includes `'it'` or `'*'`). All rules live once in `src/utils/rbac.ts`
> (`canAccessTab` / `canPerformGovernanceAction`) and are enforced on both client and
> server. The real permission matrix:
>
> | Capability | Agent | Operator | TeamLeader | LocationManager | Administrator | IT dept |
> | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
> | Use Assistant / Queue / Sources | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
> | `upload_kb` (create/delete docs & sources) | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
> | `manage_users` | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
> | `manage_rates` (brand/pricing writes) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
> | `view_review_queue` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
> | Settings tab | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
> | Governance tab | ❌ | ❌ | ❌ | ✅ (read-only) | ✅ | ❌ |
> | Sync tab | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
>
> See [ARCHITECTURE.md §5.2](./ARCHITECTURE.md) for the tab matrix and [DECISIONS.md](./DECISIONS.md) ADR-011 for the server-side enforcement decision.

### 2.1 Department-Scoped Access Controls (DAC)

In addition to RBAC roles, the platform enforces fine-grained **Department-Scoped Access Controls (DAC)**. This restricts access to internal knowledge assets based on the active user's department assignment:
- **Global Scope**: Documents or knowledge sources with `scope: 'global'` or `departmentScope: 'global'` are accessible to all verified users across the organization.
- **Specific Scope**: Documents or knowledge sources marked with `departmentScope: 'specific'` are dynamically filtered and only visible to users whose assigned `departmentIds` intersect with the document's authorized `departmentIds` array.
- **Dynamic Ingestion Tagging**: New documents uploaded by standard agents/employees are automatically tagged as department-specific (`departmentScope: 'specific'`) and scoped strictly to the uploading user's active department, preventing unauthorized cross-department exposure by default.
- **Specialized Call Center Environment**: Supports dedicated workspaces (such as `'call_center'`) with tailored operational procedures (e.g., inbound opening scripts, client interaction protocols, hold-time thresholds) that remain completely isolated from other corporate departments unless explicitly globally shared.

---

## 3. Cryptographic Standards

- **Data In Transit**: TLS 1.3 enforced for all client-to-server and server-to-server integrations. Preceding legacy protocols (TLS 1.0, 1.1) must be systematically rejected.
- **Data At Rest**: Operational databases, vector storage files, and server logs must employ AES-256 block encryption.
- **Key Rotation**: Cryptographic keys, token-signing certificates, and internal microservice secrets must undergo automatic rotation on scheduled intervals (e.g., every 90 days) via enterprise secret managers.
- **Client Credential Protection**: Raw API keys and authorization secrets are strictly prohibited from being persisted in unencrypted client-side storages (such as `localStorage` or `sessionStorage`). Any stored configuration objects must exclude raw secret tokens, which are managed server-side only.

> **Current implementation status:** several of the controls above are real today, not
> just targets:
> - **Provider keys encrypted at rest** — AI provider API keys are stored AES-256-CBC
>   encrypted (`src/server/crypto.ts`), keyed from `ENCRYPTION_SECRET`; decrypt-failure
>   fails closed (never treats ciphertext as a usable key). See [DECISIONS.md](./DECISIONS.md) ADR-010.
> - **Keys never echoed** — `GET /api/db/governance/ai-config` masks the key
>   (`••••••••` + last 4, or `••••••••env`); a blank/masked key on write preserves the
>   stored value instead of overwriting it.
> - **SSRF / key-exfiltration guard (S2)** — when a caller supplies a
>   `customEndpointUrl`, the server-stored/env provider key is **not** sent to that
>   caller-controlled endpoint; a caller endpoint must bring its own key. This closes an
>   exfiltration + server-side request forgery vector in `src/server/aiClient.ts`.
> - **Provider-call timeouts (S2)** — every outbound LLM/provider fetch is wrapped in a
>   30s `AbortController` timeout; raw upstream (Azure/Graph/provider) error bodies are
>   logged server-side but never relayed to the client.
> - **Prompt-injection guardrail (S1/S2)** — on `/api/kb-chat` and `/api/copilot-draft`
>   a non-negotiable grounding instruction is reasserted **last** in the prompt so a
>   client-supplied `systemPromptOverride` cannot countermand it.
>
> Still target-only: TLS version pinning, at-rest DB/log encryption, and scheduled key
> rotation via a secret manager — see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

---

## 4. Compliance Auditing

All system interactions must produce structured, non-repudiable audit trails:
1. **Audit Scope**: Record actor identifier, timestamp, transaction ID, target document ID, and operation status (success/failure).
2. **Immutability**: Audit logs must be dispatched to isolated, read-only system storage platforms to prevent modifications.
3. **Regulatory Requirements**: Logging structures are modeled to fulfill standard criteria under SOC2 Type II, ISO 27001, GDPR, and HIPAA compliance frameworks.
