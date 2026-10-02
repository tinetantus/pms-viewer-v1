# Deployment configuration

Use the repository root as Docker build context. `Dockerfile.web` builds Next.js and retains migration tooling; `Dockerfile.worker` installs the pinned Python processor. Separate Railway config files select each Dockerfile. Web alone runs migrations and exposes readiness.

These files have not been built with Docker or deployed. Follow ../docs/operations.md for variables, isolation, release gates, restore and rollback. The user will supply Git/Railway destinations.
