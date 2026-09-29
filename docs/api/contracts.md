# API and Event Contracts

All writes require OAuth 2.0 access tokens and an idempotency key. Production schemas
are Pydantic models; this document fixes the public shape before implementation.

## Test synchronization

`POST /v1/tests`

```json
{
  "test_id": "CT-2026-000184",
  "kit": { "id": "DEMO-COLOR-001", "profile_version": "1.2.0" },
  "result": "INCONCLUSIVE",
  "result_basis": { "model_confidence": 0.71, "calibration_quality": 0.67, "quality": "PASS" },
  "captured_at": "2026-09-28T10:12:44Z",
  "location": { "lat": 28.6139, "lng": 77.2090, "accuracy_m": 8.2 },
  "image_sha256": "hex digest",
  "canonical_record_sha256": "hex digest",
  "previous_audit_hash": "previous record digest or null",
  "signature": { "algorithm": "ECDSA_P256_SHA256", "key_id": "device-key-id", "value": "base64" },
  "provenance": { "model_version": "demo-mobile-0.4.1", "calibration_version": "cal-v0.8", "app_version": "0.1.0" }
}
```

Responses: `201` accepted, `409` duplicate idempotency key with different digest,
`422` invalid schema or cryptographic material, `403` forbidden scope.

The local prototype also exposes `POST /api/tests/sync` for a browser queued record.
The request carries the immutable original image, canonical record, raw Ed25519 public
key, device signature, image digest, and local audit event. The service recomputes the
image and record digests, verifies the device signature and local audit hash, then
appends a synchronization receipt. It does not trust the client-supplied quality or
classification as a validated analytical result.

## Read endpoints

- `GET /v1/dashboard/summary`
- `GET /v1/tests?query=&result=&sync_status=`
- `GET /v1/tests/{test_id}/passport`
- `POST /v1/tests/{test_id}/verify`
- `GET /v1/tests/{test_id}/audit`

## WebSocket events

`test.created`, `test.synced`, `test.review_required`, `test.verification_completed`,
and `audit.integrity_failed` all include `event_id`, `occurred_at`, `test_id`,
`organization_id`, `actor_type`, and a minimal non-sensitive payload. Clients are
authorized by organization and event payloads never contain images or raw coordinates.
