# ColorTrace Architecture

## Product boundary

ColorTrace records and verifies a **presumptive field-test result** from an existing
colorimetric kit. It does not identify a substance definitively, replace a laboratory
analysis, or itself establish legal admissibility.

## Runtime topology

```text
Android field app
  CameraX -> CV quality and calibration -> replaceable local model -> decision engine
  -> canonical record -> SHA-256 -> Android Keystore signature -> encrypted Room queue
  -> HTTPS sync

FastAPI API
  OAuth/OIDC + RBAC -> validation -> PostgreSQL/PostGIS + S3-compatible originals
  -> append-only hash-linked audit events -> Redis/WebSocket event fan-out

Next.js supervisor platform
  query cache -> dashboard, review queue, map, passport, verification, audit timeline
```

## Trust model

The original image is stored before any derivative is produced. Its SHA-256 digest is
part of a deterministic canonical record. The field app signs the record hash with an
Android Keystore-held private key; the API verifies with the enrolled public key. Audit
events link to the preceding event hash. A valid chain indicates tamper evidence is
intact, not that a result is scientifically or legally conclusive.

## Modules and ownership

| Module | Responsibility | Boundary |
| --- | --- | --- |
| `mobile/cv` | Reference card, ROI, blur, glare, exposure, perspective checks | No drug-specific rules |
| `mobile/ai` | Invoke validated replaceable LiteRT/ONNX model | Model output is not final result |
| `mobile/decision` | Combine quality, calibration, configured delta-E rules and model confidence | Emits result and reasons |
| `backend/api` | Authenticated synchronization and retrieval | Rejects invalid schema/signature/role |
| `backend/verification` | Image, record, signature and chain verification | Read-only verification result |
| `web` | Authorized operational views | Never makes authorization decisions alone |

## Offline sync protocol

1. The device creates an immutable record plus original image and audit event locally.
2. The local queue records an idempotency key, upload state, retry count, and next retry.
3. On connectivity, the client sends record metadata and signature first.
4. The API validates schema, kit/model versions, signature, and idempotency key.
5. The client uploads the immutable original using a scoped upload URL.
6. The API verifies the image digest, commits the record and emits `test.synced`.
7. The client marks the queue entry synchronized only after the signed server receipt.

## RBAC

Field officers create and view their own records. Supervisors view assigned
organizations and review inconclusive or integrity-flagged records. Auditors can view
passport and audit data but cannot alter kit configuration. Administrators manage
operators, kits, model releases, and policies. All server endpoints enforce scope.
