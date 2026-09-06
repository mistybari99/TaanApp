-- Additive migration for the cycle-based revolving fund model.
-- Safe to run against the existing fund schema: no historical rows are deleted.
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS nid text;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS member_id integer;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS cycle_id integer;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS related_transaction_id text;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS effective_date date;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS before_value jsonb;
ALTER TABLE fund_audit ADD COLUMN IF NOT EXISTS after_value jsonb;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS cycle_id integer;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS collection_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS shares integer NOT NULL DEFAULT 1;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS previous_due_applied numeric NOT NULL DEFAULT 0;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS current_period_applied numeric NOT NULL DEFAULT 0;
ALTER TABLE fund_settlements ADD COLUMN IF NOT EXISTS cycle_id integer;

CREATE TABLE IF NOT EXISTS fund_cycles (
  id serial PRIMARY KEY,
  cycle_number integer NOT NULL UNIQUE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  daily_per_share numeric NOT NULL DEFAULT 100,
  draw_frequency text NOT NULL DEFAULT 'WEEKLY',
  draw_day text NOT NULL DEFAULT 'FRIDAY',
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fund_cycles ADD COLUMN IF NOT EXISTS tracking_start_date date;

CREATE TABLE IF NOT EXISTS fund_cycle_members (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  shares integer NOT NULL DEFAULT 1,
  daily_contribution numeric NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, member_id)
);

CREATE TABLE IF NOT EXISTS fund_draws (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  draw_number integer NOT NULL,
  draw_date date NOT NULL,
  winner_member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  winning_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'RECORDED',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, draw_number)
);
ALTER TABLE fund_draws ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE TABLE IF NOT EXISTS fund_cycle_member_share_history (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  previous_shares integer NOT NULL CHECK (previous_shares >= 0),
  new_shares integer NOT NULL CHECK (new_shares >= 0),
  effective_date date NOT NULL,
  reason text NOT NULL,
  related_transfer_id integer,
  changed_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_shares <> new_shares)
);

CREATE TABLE IF NOT EXISTS fund_due_entries (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  reason text NOT NULL,
  idempotency_key text,
  created_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, member_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS fund_payments_cycle_date_idx ON fund_payments(cycle_id, collection_date);
CREATE INDEX IF NOT EXISTS fund_cycle_members_cycle_idx ON fund_cycle_members(cycle_id);
CREATE INDEX IF NOT EXISTS fund_draws_cycle_date_idx ON fund_draws(cycle_id, draw_date);
CREATE UNIQUE INDEX IF NOT EXISTS fund_cycles_one_active_idx ON fund_cycles(status) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS fund_settlements_cycle_idx ON fund_settlements(cycle_id, created_at);

CREATE TABLE IF NOT EXISTS fund_share_transfers (
  id serial PRIMARY KEY,
  transfer_id text NOT NULL UNIQUE,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  from_member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  to_member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  share_quantity integer NOT NULL CHECK (share_quantity > 0),
  accumulated_value numeric NOT NULL DEFAULT 0 CHECK (accumulated_value >= 0),
  transfer_date date NOT NULL,
  notes text NOT NULL DEFAULT '',
  override_winner boolean NOT NULL DEFAULT false,
  created_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_member_id <> to_member_id),
  UNIQUE(created_by, idempotency_key)
);

CREATE TABLE IF NOT EXISTS fund_transfer_settlements (
  id serial PRIMARY KEY,
  transfer_id integer NOT NULL UNIQUE REFERENCES fund_share_transfers(id) ON DELETE RESTRICT,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'APPROVED',
  approved_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  notes text NOT NULL DEFAULT '',
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(approved_by, idempotency_key)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_share_transfers_id_cycle_key') THEN
    ALTER TABLE fund_share_transfers ADD CONSTRAINT fund_share_transfers_id_cycle_key UNIQUE (id, cycle_id);
  END IF;
END $$;

-- New writes must carry their cycle and must point at a member enrolled in that cycle.
-- NOT VALID preserves any legacy rows while enforcing all future rows immediately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_payments_cycle_member_fkey') THEN
    ALTER TABLE fund_payments ADD CONSTRAINT fund_payments_cycle_member_fkey
      FOREIGN KEY (cycle_id, member_id) REFERENCES fund_cycle_members(cycle_id, member_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_payments_cycle_required_check') THEN
    ALTER TABLE fund_payments ADD CONSTRAINT fund_payments_cycle_required_check
      CHECK (cycle_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_settlements_cycle_required_check') THEN
    ALTER TABLE fund_settlements ADD CONSTRAINT fund_settlements_cycle_required_check
      CHECK (cycle_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_settlements_cycle_fkey') THEN
    ALTER TABLE fund_settlements ADD CONSTRAINT fund_settlements_cycle_fkey
      FOREIGN KEY (cycle_id) REFERENCES fund_cycles(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_draws_cycle_winner_fkey') THEN
    ALTER TABLE fund_draws ADD CONSTRAINT fund_draws_cycle_winner_fkey
      FOREIGN KEY (cycle_id, winner_member_id) REFERENCES fund_cycle_members(cycle_id, member_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_transfer_settlements_transfer_cycle_fkey') THEN
    ALTER TABLE fund_transfer_settlements ADD CONSTRAINT fund_transfer_settlements_transfer_cycle_fkey
      FOREIGN KEY (transfer_id, cycle_id) REFERENCES fund_share_transfers(id, cycle_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_share_transfers_from_cycle_member_fkey') THEN
    ALTER TABLE fund_share_transfers ADD CONSTRAINT fund_share_transfers_from_cycle_member_fkey
      FOREIGN KEY (cycle_id, from_member_id) REFERENCES fund_cycle_members(cycle_id, member_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_share_transfers_to_cycle_member_fkey') THEN
    ALTER TABLE fund_share_transfers ADD CONSTRAINT fund_share_transfers_to_cycle_member_fkey
      FOREIGN KEY (cycle_id, to_member_id) REFERENCES fund_cycle_members(cycle_id, member_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_cycle_members_shares_check') THEN
    ALTER TABLE fund_cycle_members ADD CONSTRAINT fund_cycle_members_shares_check CHECK (shares >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_transfer_settlements_status_check') THEN
    ALTER TABLE fund_transfer_settlements ADD CONSTRAINT fund_transfer_settlements_status_check
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'VOID')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_draws_status_check') THEN
    ALTER TABLE fund_draws ADD CONSTRAINT fund_draws_status_check
      CHECK (status IN ('RECORDED', 'VOID')) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fund_payments_collector_idempotency_idx
  ON fund_payments(collector_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fund_settlements_collector_idempotency_idx
  ON fund_settlements(collector_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fund_draws_cycle_idempotency_idx
  ON fund_draws(cycle_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fund_reversal_original_idx
  ON fund_payments(reversed_payment_id) WHERE reversed_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fund_due_entries_idempotency_idx
  ON fund_due_entries(cycle_id, member_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS fund_share_transfers_cycle_date_idx ON fund_share_transfers(cycle_id, transfer_date, created_at);
CREATE INDEX IF NOT EXISTS fund_share_transfers_from_idx ON fund_share_transfers(cycle_id, from_member_id, created_at);
CREATE INDEX IF NOT EXISTS fund_share_transfers_to_idx ON fund_share_transfers(cycle_id, to_member_id, created_at);
CREATE INDEX IF NOT EXISTS fund_transfer_settlements_cycle_idx ON fund_transfer_settlements(cycle_id, created_at);
CREATE INDEX IF NOT EXISTS fund_cycle_member_share_history_lookup_idx
  ON fund_cycle_member_share_history(cycle_id, member_id, effective_date, created_at);
CREATE INDEX IF NOT EXISTS fund_due_entries_member_date_idx
  ON fund_due_entries(cycle_id, member_id, due_date, created_at);