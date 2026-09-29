# ColorTrace

ColorTrace is a local prototype with a supervisor console and a guided field capture
workflow for recording, reviewing, and verifying **presumptive** colorimetric
field-test results.

## Run locally

```powershell
npm start
```

Open `http://localhost:4173`.

## Public website

The shareable website is a static demonstration with the same dashboard and capture
workflow. Its sample records are fictional. New captures are quality-screened,
hashed, and signed in the browser, then kept in that browser's IndexedDB. Images and
locations are not uploaded; location access is disabled. Cross-device synchronization,
shared accounts, and live server events are not configured. Build with
`npm run build:public`; the deployable site is written to `dist/`.

To publish, authenticate with the Vercel CLI, link this directory to the intended
Vercel project, and run `vercel --prod`. A custom global domain can then be attached
in that project's domain settings. No hosting account or domain is configured in
this repository.

The demo ships with fictional kit profiles and synthetic records. Online captures are
SHA-256 hashed and signed by the local service. Offline captures are stored in the
browser's IndexedDB queue, signed on-device with a non-exportable Web Crypto Ed25519
key, and uploaded with the original image when sync is requested. The service
independently verifies the offline signature and image digest before recording a server
receipt. Server records, images, and the local demo signing key live under
`.colortrace-data/`, which is ignored by Git.

This service is suitable for a local demonstration only. It has no production
authentication, Android Keystore binding, database, encrypted image storage, or
independent model validation. The online signing key is a local demo key. Browser
offline keys use IndexedDB and are not hardware protected. The synthetic outcome switch
is not a validated model. New image captures remain inconclusive by default; image
checks are capture-quality heuristics only.

The platform records a presumptive field-test result and does not replace laboratory
confirmatory testing or establish legal admissibility.

## Included in this increment

- Searchable supervisor dashboard with live-style event stream
- Test Passport detail drawer with capture, calibration, and provenance data
- Guided camera and image-upload capture with focus, exposure, glare, and resolution checks
- Local persistence for records and uploaded originals
- Actual SHA-256 image and canonical record digests, Ed25519 signing, and verification
- Hash-linked audit events and an event stream for live dashboard updates
- Offline queue state and a synchronization receipt flow
- Architecture, API, data-model, event, and cryptographic record specifications

The production target is documented in `docs/architecture/overview.md`. The prototype
uses Node.js built-in modules and requires no dependency installation.
