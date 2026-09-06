-- Additive migration for the cycle-based revolving fund model.
-- Safe to run against the existing fund schema: no historical rows are deleted.
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE fund_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS cycle_id integer;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS collection_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS shares integer NOT NULL DEFAULT 1;
ALTER TABLE fund_payments ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

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

CREATE INDEX IF NOT EXISTS fund_payments_cycle_date_idx ON fund_payments(cycle_id, collection_date);
CREATE INDEX IF NOT EXISTS fund_cycle_members_cycle_idx ON fund_cycle_members(cycle_id);
CREATE INDEX IF NOT EXISTS fund_draws_cycle_date_idx ON fund_draws(cycle_id, draw_date);