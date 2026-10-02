# Worker

PostgreSQL lease queue coordinator: apps/worker/index.ts. Fetches immutable originals into temporary directories, runs the Python processor with a minimal environment, uploads attempt-specific assets and publishes results only while owning the lease. One job per process; scale replicas for concurrency. See docs/operations.md for limits, retries and deployment isolation requirements.
