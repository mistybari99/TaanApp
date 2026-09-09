-- Additive migration for the cycle-based revolving fund model.
-- Safe to run against the existing fund schema: no historical rows are deleted.
ALTER TABLE fund_members ALTER COLUMN mobile DROP NOT NULL;
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS nid text;
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS business_name text NOT NULL DEFAULT '';
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS public_member_id text;
WITH existing_public_ids AS (
  SELECT COALESCE(MAX(substring(public_member_id FROM 5)::int), 0) AS max_id
  FROM fund_members
  WHERE public_member_id ~ '^IRF-[0-9]+$'
), missing_public_ids AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) + existing_public_ids.max_id AS next_id
  FROM fund_members CROSS JOIN existing_public_ids
  WHERE public_member_id IS NULL
)
UPDATE fund_members AS members
SET public_member_id = 'IRF-' || LPAD(missing_public_ids.next_id::text, 3, '0')
FROM missing_public_ids
WHERE members.id = missing_public_ids.id;
CREATE UNIQUE INDEX IF NOT EXISTS fund_members_public_member_id_idx
  ON fund_members(public_member_id) WHERE public_member_id IS NOT NULL;
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
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS tan_period_id integer;
ALTER TABLE fund_due_entries ADD COLUMN IF NOT EXISTS tan_period_id integer;
ALTER TABLE fund_draws ADD COLUMN IF NOT EXISTS tan_period_id integer;
ALTER TABLE fund_draws ADD COLUMN IF NOT EXISTS draw_slot integer;
ALTER TABLE fund_share_transfers ADD COLUMN IF NOT EXISTS tan_period_id integer;

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

-- A locked TAN schedule is additive to the legacy cycle/draw model. Legacy
-- cycles remain valid with a NULL tan config and NULL tan_period_id values.
CREATE TABLE IF NOT EXISTS fund_tan_configs (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  tan_start_date date NOT NULL,
  draws_per_week integer NOT NULL CHECK (draws_per_week > 0),
  total_shares integer NOT NULL CHECK (total_shares > 0),
  total_draw_dates integer NOT NULL CHECK (total_draw_dates > 0),
  daily_per_share numeric NOT NULL CHECK (daily_per_share > 0),
  expected_daily_collection numeric NOT NULL CHECK (expected_daily_collection > 0),
  weekly_collection_unit numeric NOT NULL CHECK (weekly_collection_unit > 0),
  per_draw_winner_amount numeric NOT NULL CHECK (per_draw_winner_amount > 0),
  status text NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED','PAUSED','COMPLETED')),
  locked_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  locked_at timestamptz NOT NULL DEFAULT now(),
  completed_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  pause_started_on date,
  pause_period_id integer,
  pause_reason text,
  paused_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  paused_at timestamptz,
  resumed_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  resumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fund_tan_configs DROP CONSTRAINT IF EXISTS fund_tan_configs_status_check;
ALTER TABLE fund_tan_configs
  ADD CONSTRAINT fund_tan_configs_status_check CHECK (status IN ('LOCKED','PAUSED','COMPLETED'));
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS pause_started_on date;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS pause_period_id integer;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS paused_by integer;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS resumed_by integer;
ALTER TABLE fund_tan_configs ADD COLUMN IF NOT EXISTS resumed_at timestamptz;
ALTER TABLE fund_tan_configs DROP CONSTRAINT IF EXISTS fund_tan_configs_cycle_id_key;
CREATE INDEX IF NOT EXISTS fund_tan_configs_cycle_idx ON fund_tan_configs(cycle_id, id DESC);

CREATE TABLE IF NOT EXISTS fund_tan_periods (
  id serial PRIMARY KEY,
  tan_config_id integer NOT NULL REFERENCES fund_tan_configs(id) ON DELETE RESTRICT,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  period_start date NOT NULL,
  period_end date NOT NULL,
  draw_date date NOT NULL,
  expected_collection numeric NOT NULL CHECK (expected_collection > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED')),
  completed_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tan_config_id, sequence_no),
  UNIQUE(tan_config_id, period_start),
  UNIQUE(tan_config_id, draw_date),
  CHECK (period_end >= period_start + 6),
  CHECK (draw_date = period_end)
);
ALTER TABLE fund_tan_periods DROP CONSTRAINT IF EXISTS fund_tan_periods_period_end_check;
ALTER TABLE fund_tan_periods
  ADD CONSTRAINT fund_tan_periods_period_end_check CHECK (period_end >= period_start + 6);
ALTER TABLE fund_tan_configs
  DROP CONSTRAINT IF EXISTS fund_tan_configs_pause_period_id_fkey;
ALTER TABLE fund_tan_configs
  ADD CONSTRAINT fund_tan_configs_pause_period_id_fkey
  FOREIGN KEY (pause_period_id) REFERENCES fund_tan_periods(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS fund_tan_schedule_events (
  id serial PRIMARY KEY,
  tan_config_id integer NOT NULL REFERENCES fund_tan_configs(id) ON DELETE RESTRICT,
  tan_period_id integer REFERENCES fund_tan_periods(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('PAUSED','RESUMED','RESCHEDULED')),
  effective_date date NOT NULL,
  days_shifted integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  actor_id integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fund_tan_schedule_events_config_idx
  ON fund_tan_schedule_events(tan_config_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fund_tan_period_member_obligations (
  id serial PRIMARY KEY,
  tan_period_id integer NOT NULL REFERENCES fund_tan_periods(id) ON DELETE RESTRICT,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  shares_snapshot integer NOT NULL CHECK (shares_snapshot >= 0),
  required_amount numeric NOT NULL CHECK (required_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tan_period_id, member_id)
);

-- One draw right is created for each share in a locked TAN. Draw wins consume
-- rights without reducing the member's actual share balance.
CREATE TABLE IF NOT EXISTS fund_tan_member_draw_entitlements (
  id serial PRIMARY KEY,
  tan_config_id integer NOT NULL REFERENCES fund_tan_configs(id) ON DELETE RESTRICT,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  allocated_entitlements integer NOT NULL CHECK (allocated_entitlements >= 0),
  consumed_entitlements integer NOT NULL DEFAULT 0 CHECK (consumed_entitlements >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tan_config_id, member_id),
  CHECK (consumed_entitlements <= allocated_entitlements)
);

ALTER TABLE fund_draws ADD COLUMN IF NOT EXISTS entitlement_id integer;
ALTER TABLE fund_draws ADD COLUMN IF NOT EXISTS entitlement_number integer;
CREATE INDEX IF NOT EXISTS fund_tan_member_draw_entitlements_member_idx
  ON fund_tan_member_draw_entitlements(cycle_id, member_id);
CREATE INDEX IF NOT EXISTS fund_draws_entitlement_idx ON fund_draws(entitlement_id);

INSERT INTO fund_tan_member_draw_entitlements(tan_config_id,cycle_id,member_id,allocated_entitlements)
SELECT cfg.id,cfg.cycle_id,cm.member_id,cm.shares
FROM fund_tan_configs cfg
JOIN fund_cycle_members cm ON cm.cycle_id=cfg.cycle_id
ON CONFLICT(tan_config_id,member_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_tan_periods_start_saturday_check') THEN
    ALTER TABLE fund_tan_periods
      ADD CONSTRAINT fund_tan_periods_start_saturday_check
      CHECK (EXTRACT(DOW FROM period_start) = 6) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_tan_periods_end_friday_check') THEN
    ALTER TABLE fund_tan_periods
      ADD CONSTRAINT fund_tan_periods_end_friday_check
      CHECK (EXTRACT(DOW FROM period_end) = 5) NOT VALID;
  END IF;
END $$;

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
CREATE UNIQUE INDEX IF NOT EXISTS fund_draws_tan_slot_idx
  ON fund_draws(tan_period_id, draw_slot)
  WHERE tan_period_id IS NOT NULL AND draw_slot IS NOT NULL;
CREATE TABLE IF NOT EXISTS fund_draw_disbursements (
  id serial PRIMARY KEY,
  draw_id integer NOT NULL REFERENCES fund_draws(id) ON DELETE RESTRICT,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  payer_user_id integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  winner_member_id integer NOT NULL REFERENCES fund_members(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  payout_date date NOT NULL,
  reference text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'REVERSED')),
  created_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  idempotency_key text,
  reversed_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fund_draw_disbursements_payer_idempotency_idx
  ON fund_draw_disbursements(payer_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
ALTER TABLE fund_draw_disbursements DROP CONSTRAINT IF EXISTS fund_draw_disbursements_draw_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS fund_draw_disbursements_active_draw_idx
  ON fund_draw_disbursements(draw_id)
  WHERE status='PAID';
CREATE INDEX IF NOT EXISTS fund_draw_disbursements_cycle_date_idx
  ON fund_draw_disbursements(cycle_id, payout_date, created_at);
CREATE INDEX IF NOT EXISTS fund_payments_tan_period_idx ON fund_payments(tan_period_id);
CREATE INDEX IF NOT EXISTS fund_due_entries_tan_period_idx ON fund_due_entries(tan_period_id);
CREATE INDEX IF NOT EXISTS fund_draws_tan_period_idx ON fund_draws(tan_period_id);
CREATE INDEX IF NOT EXISTS fund_share_transfers_tan_period_idx ON fund_share_transfers(tan_period_id);
CREATE INDEX IF NOT EXISTS fund_tan_obligations_member_idx
  ON fund_tan_period_member_obligations(cycle_id, member_id, tan_period_id);
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

-- Cash custody is additive to the legacy collector settlement model.
-- Existing payments and settlements remain readable and historical.
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS receiver_id integer;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS receipt_source text NOT NULL DEFAULT 'COLLECTOR';
-- Direct Owner/Cash Receiver receipts have no collector attribution. Legacy
-- rows remain unchanged while new direct receipts may leave collector_id NULL.
ALTER TABLE fund_payments ALTER COLUMN collector_id DROP NOT NULL;
UPDATE fund_payments SET receiver_id = collector_id WHERE receiver_id IS NULL;
ALTER TABLE fund_payments DROP CONSTRAINT IF EXISTS fund_payments_receipt_source_check;
ALTER TABLE fund_payments ADD CONSTRAINT fund_payments_receipt_source_check
  CHECK (receipt_source IN ('COLLECTOR', 'OWNER_DIRECT', 'CASH_RECEIVER_DIRECT')) NOT VALID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_payments_receiver_fkey') THEN
    ALTER TABLE fund_payments ADD CONSTRAINT fund_payments_receiver_fkey
      FOREIGN KEY (receiver_id) REFERENCES fund_users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS fund_payments_receiver_cycle_idx ON fund_payments(receiver_id, cycle_id, status);

CREATE TABLE IF NOT EXISTS fund_cash_handovers (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  from_user_id integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  to_user_id integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  collection_date date NOT NULL,
  receipt_start text,
  receipt_end text,
  receipt_count integer NOT NULL DEFAULT 0 CHECK (receipt_count >= 0),
  reference text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'SUBMITTED',
  submitted_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  accepted_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  accepted_at timestamptz,
  counted_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  counted_amount numeric CHECK (counted_amount >= 0),
  received_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  rejected_by integer REFERENCES fund_users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id),
  CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'VOID'))
);
UPDATE fund_cash_handovers
SET counted_by = accepted_by,
    counted_amount = amount,
    received_by = accepted_by
WHERE status = 'ACCEPTED' AND accepted_by IS NOT NULL
  AND (counted_by IS NULL OR counted_amount IS NULL OR received_by IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS fund_cash_handovers_from_idempotency_idx
  ON fund_cash_handovers(from_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS fund_cash_handovers_cycle_created_idx
  ON fund_cash_handovers(cycle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fund_cash_handovers_to_status_idx
  ON fund_cash_handovers(to_user_id, status, created_at DESC);

-- A cycle-level weekly handover target is a benchmark, not a payment restriction.
-- Collectors may still record payments for every member; accepted handovers are
-- measured against this target for the current Saturday-Friday period.
CREATE TABLE IF NOT EXISTS fund_collector_weekly_targets (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES fund_cycles(id) ON DELETE RESTRICT,
  collector_id integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  target_amount numeric NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  set_by integer NOT NULL REFERENCES fund_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, collector_id)
);
CREATE INDEX IF NOT EXISTS fund_collector_weekly_targets_cycle_idx
  ON fund_collector_weekly_targets(cycle_id, collector_id);

-- Expand the legacy user role check without rewriting existing Owner/Collector users.
ALTER TABLE fund_users DROP CONSTRAINT IF EXISTS fund_users_role_check;
ALTER TABLE fund_users ADD CONSTRAINT fund_users_role_check
  CHECK (role IN ('OWNER', 'COLLECTOR', 'CASH_RECEIVER'));