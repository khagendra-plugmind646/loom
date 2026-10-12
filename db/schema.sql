-- Loomzk admin database: a private copy of everything Loomzk stores on-chain.
-- Written only by the indexer (`pnpm indexer`), read only by the admin (/admin, psql, TablePlus).
-- Safe to run repeatedly. Amounts are raw base units: stablecoins have 6 decimals, SOL has 9
-- (use the *_readable views for human units).

CREATE TABLE IF NOT EXISTS protocol (
  program_id                text PRIMARY KEY,
  cluster                   text NOT NULL,
  admin                     text NOT NULL,
  treasury                  text NOT NULL,
  paused                    boolean NOT NULL,
  liquidation_threshold_bps integer NOT NULL,
  liquidation_penalty_bps   integer NOT NULL,
  max_price_age_secs        integer NOT NULL,
  max_confidence_bps        integer NOT NULL,
  min_principal             numeric(20, 0) NOT NULL,
  max_principal             numeric(20, 0) NOT NULL,
  next_loan_id              bigint NOT NULL,
  stats                     jsonb NOT NULL,
  synced_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reserves (
  address         text PRIMARY KEY,
  mint            text NOT NULL,
  coin            text,
  vault           text NOT NULL,
  total_funded    numeric(20, 0) NOT NULL,
  total_withdrawn numeric(20, 0) NOT NULL,
  total_disbursed numeric(20, 0) NOT NULL,
  total_repaid    numeric(20, 0) NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loans (
  address                   text PRIMARY KEY,
  loan_id                   bigint NOT NULL,
  borrower                  text NOT NULL,
  recipient                 text NOT NULL,
  mint                      text NOT NULL,
  coin                      text,
  principal                 numeric(20, 0) NOT NULL,
  total_due                 numeric(20, 0) NOT NULL,
  repaid                    numeric(20, 0) NOT NULL,
  collateral_lamports       numeric(20, 0) NOT NULL,
  open_price                numeric(20, 0) NOT NULL,
  open_price_expo           integer NOT NULL,
  opened_at                 timestamptz NOT NULL,
  maturity_at               timestamptz NOT NULL,
  closed_at                 timestamptz,
  status                    text NOT NULL,
  liquidation_threshold_bps integer NOT NULL,
  zk_opted_in               boolean NOT NULL,
  credit_leaf_index         bigint,
  -- Filled from the LoanLiquidated event once the loan is settled.
  settled_to_treasury_lamports numeric(20, 0),
  settled_to_borrower_lamports numeric(20, 0),
  settlement_signature      text,
  synced_at                 timestamptz NOT NULL DEFAULT now()
);
-- Time-based interest (added later; ADD COLUMN keeps existing databases working).
-- rate_bps = 0 marks loans opened with the old flat 12% fee.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_bps integer NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS principal_repaid numeric(20, 0) NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_accrued numeric(20, 0) NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS credit_certificate text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS from_pool boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans (borrower);
CREATE INDEX IF NOT EXISTS loans_status_idx ON loans (status);

CREATE TABLE IF NOT EXISTS pools (
  address         text PRIMARY KEY,
  mint            text NOT NULL,
  coin            text,
  cash            numeric(20, 0) NOT NULL,
  principal_out   numeric(20, 0) NOT NULL,
  total_shares    numeric(20, 0) NOT NULL,
  total_deposited numeric(20, 0) NOT NULL,
  total_withdrawn numeric(20, 0) NOT NULL,
  interest_earned numeric(20, 0) NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lender_positions (
  address   text PRIMARY KEY,
  owner     text NOT NULL,
  mint      text NOT NULL,
  coin      text,
  shares    numeric(20, 0) NOT NULL,
  deposited numeric(20, 0) NOT NULL,
  withdrawn numeric(20, 0) NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  address        text PRIMARY KEY,
  holder         text NOT NULL,
  nullifier_hash text NOT NULL,
  root           text NOT NULL,
  min_principal  numeric(20, 0) NOT NULL,
  issued_at      timestamptz NOT NULL,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Every event the program emitted, one row per event (a transaction can emit several).
CREATE TABLE IF NOT EXISTS events (
  signature  text NOT NULL,
  idx        integer NOT NULL,
  slot       bigint NOT NULL,
  block_time timestamptz,
  name       text NOT NULL,
  loan       text,
  data       jsonb NOT NULL,
  PRIMARY KEY (signature, idx)
);
CREATE INDEX IF NOT EXISTS events_loan_idx ON events (loan);
CREATE INDEX IF NOT EXISTS events_time_idx ON events (block_time DESC);

-- Written by the web app itself (also created on first use by app/lib/db-server.ts).
CREATE TABLE IF NOT EXISTS support_messages (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, wallet text, coin text, amount text,
  contact text NOT NULL, message text NOT NULL, handled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), rating integer, area text NOT NULL, message text NOT NULL,
  contact text, wallet text, page text
);
CREATE TABLE IF NOT EXISTS faucet_claims (
  wallet text PRIMARY KEY, claimed_at timestamptz NOT NULL DEFAULT now(), count integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sync_state (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dropped and recreated so column changes apply on the next indexer run.
DROP VIEW IF EXISTS loans_readable;
CREATE VIEW loans_readable AS
SELECT
  loan_id,
  status,
  coin,
  rate_bps / 100.0                              AS rate_pct,
  credit_certificate IS NOT NULL                AS credit_rate,
  from_pool,
  round(principal / 1e6, 2)                     AS principal,
  round(total_due / 1e6, 2)                     AS total_due,
  round(repaid / 1e6, 2)                        AS repaid,
  -- older flat-fee loans (rate_bps = 0) never split principal and interest
  round(CASE WHEN rate_bps = 0 THEN greatest(repaid - principal, 0) ELSE repaid - principal_repaid END / 1e6, 2) AS interest_paid,
  round(collateral_lamports / 1e9, 9)           AS collateral_sol,
  round(settled_to_treasury_lamports / 1e9, 9)  AS settled_to_treasury_sol,
  round(settled_to_borrower_lamports / 1e9, 9)  AS settled_to_borrower_sol,
  round(open_price * power(10::numeric, open_price_expo), 4) AS open_price_usd,
  opened_at,
  maturity_at,
  closed_at,
  borrower,
  recipient,
  address
FROM loans;
