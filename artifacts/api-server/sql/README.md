# Database setup (fresh database)

Run in this order:

1. `base-schema.sql` — base tables, exported from the live database (structure only, no data).
2. `base-seed.sql` — the one settings row the app expects.
3. `fund-cycles.sql` — cycle, TAN, transfer, draw and custody tables and constraints.

Then run the tests:

    DATABASE_URL=postgres://... pnpm --filter @workspace/api-server run test:fund
