# Electronic-signature rules

This is a candidate subtree for the existing Realtime Database rules. It has no project or deployment configuration. Replace only the live rules' entire `electronicSignature` branch with this candidate after verifying the current live rules and checking that no ancestor grants broader access.

Assign these independent Firebase Auth custom claims only to user IDs approved by the owner:

| Claim | Capability |
| --- | --- |
| `esignOperator` | Read company signature and stamp images and append the operator's own generation events |
| `esignSettingsAdmin` | Read, replace, and remove company images |
| `esignAuditReader` | Read the signature log |

No account is granted a claim by this change. An operator receives reusable image bytes as part of browser-side rendering. A generated event has a server timestamp and a validated operator ID. The event records a client-reported generation, and cannot attest to signer approval or download.

Run `npm test`, then run `npm run test:esign-rules` against a local Firebase Realtime Database emulator. The test defaults to `127.0.0.1:9199`. Set `FIREBASE_DATABASE_EMULATOR_HOST` if running the emulator on a different local port. It loads rules and clears only the synthetic `demo-vip-sales-esign` namespace. Java and the Firebase Local Emulator Suite are needed for this suite.

For rollout, verify the proposed capability assignments and preserve a copy of the current rules. Ensure the approved accounts have refreshed Firebase ID tokens, verify the new frontend with the candidate rules in a test environment, then coordinate the frontend release and rule publication. The old frontend cannot write the new log schema and needs to be reloaded. Existing records remain readable to approved audit readers.
