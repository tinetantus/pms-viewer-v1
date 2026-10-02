# Tests

`npm test` exercises coordinate transforms and optional-AI boundaries with mock transport. `.venv/Scripts/python.exe tests/processor_test.py` exercises six synthetic PDF rendering/comparison cases. `npm run test:integration` uses real local sessions, database, uploads and worker to test access, immutable finalization, issue verification and approval gates. Then run `node --env-file=.env --import tsx tests/collaboration.test.ts` for invitations/account control/comments/anchors and `npm run test:browser` for Chrome UI checks.

The live integration checks require web, worker and local PostgreSQL. They refuse non-local targets and create disposable fixtures. Credentials/artwork/screenshots remain in ignored local-data/artifacts directories.

Optional private sample check: after importing samples with scripts/import-local-samples.mjs, preserve the associated local-data/test-accounts.json as local-data/sample-accounts.json; run `node tests/sample-check.mjs`. It renders four supplied pairs at fit and 400%, records bounded canvas sizes and queues comparisons. It is not a colour certification or a comprehensive diff accuracy benchmark.

After a fresh integration run, run findings.test.ts, anchor-workflow.test.ts and recovery.test.ts using `node --env-file=.env --import tsx tests/<name>`. They validate finding links/mentions/access removal, worker-proposed anchors with human rejection, and lease recovery/retry/cancellation. `node tests/dialog-check.mjs` checks focus trapping and restoration in Chrome. Run collaboration before findings, and findings before anchor-workflow. These suites mutate disposable fixtures; start a new integration fixture set for a clean rerun.
