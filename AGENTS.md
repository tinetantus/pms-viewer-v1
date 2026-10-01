# Project instructions

Read PACKAGING_PROOF_SPEC.md, its active-work/handoff section, and Git status before editing. The repository copy is the canonical implementation tracker; the parent specification is the original reference.

Maintain the specification after each bounded slice. Preserve immutable originals, separate annotations, server-side access checks, and revision-bound approval. Use synthetic fixtures; never commit source artwork, generated crops, secrets, or database dumps.

Use Node 24 and npm workspaces with exact dependencies and the committed lockfile. Run npm run check for changes affecting the scaffold. Feature tests must exercise real behavior. Reserved service directories are not implemented services.
