# Drizzle Kit 0.31.11 PostgreSQL fixture

Generated on 2026-10-13 with npm-published `drizzle-kit@0.31.11` and
`drizzle-orm@0.45.4`, on Node 22.23.3. This purpose-built schema contains no
application/customer data. SQL and journal bytes are retained exactly as
produced; snapshots are omitted because neither auditor nor ORM reader uses
them. Generation requires no database connection.

## Reproduce in a temporary directory

```sh
npm init -y
npm install --save-exact drizzle-kit@0.31.11 drizzle-orm@0.45.4
```

Create `schema.ts`:

```ts
import { index, integer, pgEnum, pgTable, serial, text } from 'drizzle-orm/pg-core';
export const accountState = pgEnum('account_state', ['active', 'disabled']);
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  state: accountState('state').notNull().default('active'),
});
export const entries = pgTable('entries', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  body: text('body').notNull(),
}, (table) => [index('entries_account_idx').on(table.accountId)]);
```

```sh
npx drizzle-kit generate --dialect postgresql --schema ./schema.ts --out ./drizzle --name initial
```

Add `displayName: text('display_name'),` to `accounts`, then run:

```sh
npx drizzle-kit generate --dialect postgresql --schema ./schema.ts --out ./drizzle --name display_name
```

Fresh runs have different journal timestamps and snapshot UUIDs. Do not
normalize or regenerate the committed journal during tests. The frozen fixture
is checked by `tests/upstream-semantics.test.ts`; Kit is not a project runtime
or development dependency. PostgreSQL execution is not claimed by this fixture.
