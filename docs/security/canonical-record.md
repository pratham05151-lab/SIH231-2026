# Canonical Record Format

The local prototype canonicalizes records as compact UTF-8 JSON with sorted object
keys. Production should additionally adopt a formally specified canonical JSON format,
RFC 3339 UTC timestamps, and fixed decimal normalization across languages.

```text
image_hash = SHA-256(original image bytes)
record_hash = SHA-256(canonical record UTF-8 bytes)
signature = Ed25519 sign(record_hash)
audit_hash = SHA-256(canonical audit event)
```

The signed record includes the image hash, kit-profile version, model version,
calibration score, quality verdict, timestamp, optional location, and previous record
hash. It never includes a private key. Source images are immutable; UI crops and
annotated derivatives are separately named and never overwrite their source. The local
prototype's Ed25519 key is kept under the ignored `.colortrace-data/` directory and is
not hardware protected. Do not use this key or its records as production evidence.
