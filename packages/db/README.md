# Database

node-postgres pool and transactional helpers; immutable versioned SQL in migrations/. Better Auth manages its own tables using the pinned migration API. Run npm run db:migrate before web/worker startup. Composite foreign keys and project row locks enforce revision/project boundaries. Never edit an already-applied migration.
