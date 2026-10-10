-- Minimal rows the app assumes exist on a fresh database.
-- Safe to re-run; never overwrites an existing settings row.
INSERT INTO fund_settings (id, organization_name, expected_members, default_daily_per_share)
VALUES (1, 'ISLAMIYA Revolving Fund', 31, 100)
ON CONFLICT (id) DO NOTHING;
