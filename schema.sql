--
-- PostgreSQL database dump
--

\restrict gehYyRK6vWwFp83hcI98YO2mzDnTpfaLBf0haK4zSe88ViQZzCF3vwRATWaajIS

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fund_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_audit (
    id bigint NOT NULL,
    actor_id integer,
    action text NOT NULL,
    detail text NOT NULL,
    entity_type text,
    entity_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    member_id integer,
    cycle_id integer,
    related_transaction_id text,
    reason text,
    effective_date date,
    before_value jsonb,
    after_value jsonb
);


--
-- Name: fund_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_audit_id_seq OWNED BY public.fund_audit.id;


--
-- Name: fund_cash_handovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_cash_handovers (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    from_user_id integer NOT NULL,
    to_user_id integer NOT NULL,
    amount numeric NOT NULL,
    collection_date date NOT NULL,
    receipt_start text,
    receipt_end text,
    receipt_count integer DEFAULT 0 NOT NULL,
    reference text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'SUBMITTED'::text NOT NULL,
    submitted_by integer NOT NULL,
    accepted_by integer,
    accepted_at timestamp with time zone,
    rejected_by integer,
    rejected_at timestamp with time zone,
    rejection_reason text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_by integer,
    counted_amount numeric,
    received_by integer,
    CONSTRAINT fund_cash_handovers_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT fund_cash_handovers_check CHECK ((from_user_id <> to_user_id)),
    CONSTRAINT fund_cash_handovers_counted_amount_check CHECK ((counted_amount >= (0)::numeric)),
    CONSTRAINT fund_cash_handovers_receipt_count_check CHECK ((receipt_count >= 0)),
    CONSTRAINT fund_cash_handovers_status_check CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'VOID'::text])))
);


--
-- Name: fund_cash_handovers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_cash_handovers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_cash_handovers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_cash_handovers_id_seq OWNED BY public.fund_cash_handovers.id;


--
-- Name: fund_collector_weekly_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_collector_weekly_targets (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    collector_id integer NOT NULL,
    target_amount numeric DEFAULT 0 NOT NULL,
    set_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_collector_weekly_targets_target_amount_check CHECK ((target_amount >= (0)::numeric))
);


--
-- Name: fund_collector_weekly_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_collector_weekly_targets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_collector_weekly_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_collector_weekly_targets_id_seq OWNED BY public.fund_collector_weekly_targets.id;


--
-- Name: fund_cycle_member_share_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_cycle_member_share_history (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    member_id integer NOT NULL,
    previous_shares integer NOT NULL,
    new_shares integer NOT NULL,
    effective_date date NOT NULL,
    reason text NOT NULL,
    related_transfer_id integer,
    changed_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_cycle_member_share_history_check CHECK ((previous_shares <> new_shares)),
    CONSTRAINT fund_cycle_member_share_history_new_shares_check CHECK ((new_shares >= 0)),
    CONSTRAINT fund_cycle_member_share_history_previous_shares_check CHECK ((previous_shares >= 0))
);


--
-- Name: fund_cycle_member_share_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_cycle_member_share_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_cycle_member_share_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_cycle_member_share_history_id_seq OWNED BY public.fund_cycle_member_share_history.id;


--
-- Name: fund_cycle_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_cycle_members (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    member_id integer NOT NULL,
    shares integer DEFAULT 1 NOT NULL,
    daily_contribution numeric DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fund_cycle_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_cycle_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_cycle_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_cycle_members_id_seq OWNED BY public.fund_cycle_members.id;


--
-- Name: fund_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_cycles (
    id integer NOT NULL,
    cycle_number integer NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    daily_per_share numeric DEFAULT 100 NOT NULL,
    draw_frequency text DEFAULT 'WEEKLY'::text NOT NULL,
    draw_day text DEFAULT 'FRIDAY'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tracking_start_date date
);


--
-- Name: fund_cycles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_cycles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_cycles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_cycles_id_seq OWNED BY public.fund_cycles.id;


--
-- Name: fund_draw_disbursements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_draw_disbursements (
    id integer NOT NULL,
    draw_id integer NOT NULL,
    cycle_id integer NOT NULL,
    payer_user_id integer NOT NULL,
    winner_member_id integer NOT NULL,
    amount numeric NOT NULL,
    payout_date date NOT NULL,
    reference text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'PAID'::text NOT NULL,
    created_by integer NOT NULL,
    idempotency_key text,
    reversed_by integer,
    reversed_at timestamp with time zone,
    reversal_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_draw_disbursements_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT fund_draw_disbursements_status_check CHECK ((status = ANY (ARRAY['PAID'::text, 'REVERSED'::text])))
);


--
-- Name: fund_draw_disbursements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_draw_disbursements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_draw_disbursements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_draw_disbursements_id_seq OWNED BY public.fund_draw_disbursements.id;


--
-- Name: fund_draws; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_draws (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    draw_number integer NOT NULL,
    draw_date date NOT NULL,
    winner_member_id integer NOT NULL,
    winning_amount numeric NOT NULL,
    status text DEFAULT 'RECORDED'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text,
    tan_period_id integer,
    draw_slot integer,
    entitlement_id integer,
    entitlement_number integer
);


--
-- Name: fund_draws_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_draws_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_draws_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_draws_id_seq OWNED BY public.fund_draws.id;


--
-- Name: fund_due_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_due_entries (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    member_id integer NOT NULL,
    amount numeric NOT NULL,
    due_date date NOT NULL,
    reason text NOT NULL,
    idempotency_key text,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tan_period_id integer,
    CONSTRAINT fund_due_entries_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: fund_due_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_due_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_due_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_due_entries_id_seq OWNED BY public.fund_due_entries.id;


--
-- Name: fund_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_members (
    id integer NOT NULL,
    member_id text NOT NULL,
    name text NOT NULL,
    mobile text,
    address text DEFAULT ''::text NOT NULL,
    shares integer DEFAULT 1 NOT NULL,
    daily_amount numeric(12,2) NOT NULL,
    joining_date date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    pin_hash text,
    assigned_collector_id integer,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nid text,
    business_name text DEFAULT ''::text NOT NULL,
    public_member_id text
);


--
-- Name: fund_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_members_id_seq OWNED BY public.fund_members.id;


--
-- Name: fund_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_payments (
    id integer NOT NULL,
    receipt_id text NOT NULL,
    member_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    collector_id integer,
    verification_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'POSTED'::text NOT NULL,
    reversed_payment_id integer,
    correction_reason text,
    idempotency_key text,
    cycle_id integer,
    collection_date date DEFAULT CURRENT_DATE NOT NULL,
    shares integer DEFAULT 1 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    previous_due_applied numeric DEFAULT 0 NOT NULL,
    current_period_applied numeric DEFAULT 0 NOT NULL,
    tan_period_id integer,
    receiver_id integer,
    receipt_source text DEFAULT 'COLLECTOR'::text NOT NULL,
    advance_credit numeric DEFAULT 0 NOT NULL,
    CONSTRAINT fund_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: fund_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_payments_id_seq OWNED BY public.fund_payments.id;


--
-- Name: fund_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_sessions (
    token_hash text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fund_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_settings (
    id integer DEFAULT 1 NOT NULL,
    organization_name text NOT NULL,
    expected_members integer NOT NULL,
    default_daily_per_share numeric(12,2) NOT NULL,
    demo_mode boolean DEFAULT true NOT NULL,
    biometric_optional boolean DEFAULT true NOT NULL,
    CONSTRAINT fund_settings_id_check CHECK ((id = 1))
);


--
-- Name: fund_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_settlements (
    id integer NOT NULL,
    collector_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    reference text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text,
    cycle_id integer,
    CONSTRAINT fund_settlements_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: fund_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_settlements_id_seq OWNED BY public.fund_settlements.id;


--
-- Name: fund_share_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_share_transfers (
    id integer NOT NULL,
    transfer_id text NOT NULL,
    cycle_id integer NOT NULL,
    from_member_id integer NOT NULL,
    to_member_id integer NOT NULL,
    share_quantity integer NOT NULL,
    accumulated_value numeric DEFAULT 0 NOT NULL,
    transfer_date date NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    override_winner boolean DEFAULT false NOT NULL,
    created_by integer NOT NULL,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tan_period_id integer,
    CONSTRAINT fund_share_transfers_accumulated_value_check CHECK ((accumulated_value >= (0)::numeric)),
    CONSTRAINT fund_share_transfers_check CHECK ((from_member_id <> to_member_id)),
    CONSTRAINT fund_share_transfers_share_quantity_check CHECK ((share_quantity > 0))
);


--
-- Name: fund_share_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_share_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_share_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_share_transfers_id_seq OWNED BY public.fund_share_transfers.id;


--
-- Name: fund_tan_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_tan_configs (
    id integer NOT NULL,
    cycle_id integer NOT NULL,
    tan_start_date date NOT NULL,
    draws_per_week integer NOT NULL,
    total_shares integer NOT NULL,
    total_draw_dates integer NOT NULL,
    daily_per_share numeric NOT NULL,
    expected_daily_collection numeric NOT NULL,
    weekly_collection_unit numeric NOT NULL,
    per_draw_winner_amount numeric NOT NULL,
    status text DEFAULT 'LOCKED'::text NOT NULL,
    locked_by integer NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by integer,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pause_started_on date,
    pause_period_id integer,
    pause_reason text,
    paused_by integer,
    paused_at timestamp with time zone,
    resumed_by integer,
    resumed_at timestamp with time zone,
    CONSTRAINT fund_tan_configs_daily_per_share_check CHECK ((daily_per_share > (0)::numeric)),
    CONSTRAINT fund_tan_configs_draws_per_week_check CHECK ((draws_per_week > 0)),
    CONSTRAINT fund_tan_configs_expected_daily_collection_check CHECK ((expected_daily_collection > (0)::numeric)),
    CONSTRAINT fund_tan_configs_per_draw_winner_amount_check CHECK ((per_draw_winner_amount > (0)::numeric)),
    CONSTRAINT fund_tan_configs_status_check CHECK ((status = ANY (ARRAY['LOCKED'::text, 'PAUSED'::text, 'COMPLETED'::text]))),
    CONSTRAINT fund_tan_configs_total_draw_dates_check CHECK ((total_draw_dates > 0)),
    CONSTRAINT fund_tan_configs_total_shares_check CHECK ((total_shares > 0)),
    CONSTRAINT fund_tan_configs_weekly_collection_unit_check CHECK ((weekly_collection_unit > (0)::numeric))
);


--
-- Name: fund_tan_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_tan_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_tan_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_tan_configs_id_seq OWNED BY public.fund_tan_configs.id;


--
-- Name: fund_tan_member_draw_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_tan_member_draw_entitlements (
    id integer NOT NULL,
    tan_config_id integer NOT NULL,
    cycle_id integer NOT NULL,
    member_id integer NOT NULL,
    allocated_entitlements integer NOT NULL,
    consumed_entitlements integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_tan_member_draw_entitlements_allocated_entitlements_check CHECK ((allocated_entitlements >= 0)),
    CONSTRAINT fund_tan_member_draw_entitlements_check CHECK ((consumed_entitlements <= allocated_entitlements)),
    CONSTRAINT fund_tan_member_draw_entitlements_consumed_entitlements_check CHECK ((consumed_entitlements >= 0))
);


--
-- Name: fund_tan_member_draw_entitlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_tan_member_draw_entitlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_tan_member_draw_entitlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_tan_member_draw_entitlements_id_seq OWNED BY public.fund_tan_member_draw_entitlements.id;


--
-- Name: fund_tan_period_member_obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_tan_period_member_obligations (
    id integer NOT NULL,
    tan_period_id integer NOT NULL,
    cycle_id integer NOT NULL,
    member_id integer NOT NULL,
    shares_snapshot integer NOT NULL,
    required_amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_tan_period_member_obligations_required_amount_check CHECK ((required_amount >= (0)::numeric)),
    CONSTRAINT fund_tan_period_member_obligations_shares_snapshot_check CHECK ((shares_snapshot >= 0))
);


--
-- Name: fund_tan_period_member_obligations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_tan_period_member_obligations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_tan_period_member_obligations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_tan_period_member_obligations_id_seq OWNED BY public.fund_tan_period_member_obligations.id;


--
-- Name: fund_tan_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_tan_periods (
    id integer NOT NULL,
    tan_config_id integer NOT NULL,
    cycle_id integer NOT NULL,
    sequence_no integer NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    draw_date date NOT NULL,
    expected_collection numeric NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    completed_by integer,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_tan_periods_check1 CHECK ((draw_date = period_end)),
    CONSTRAINT fund_tan_periods_expected_collection_check CHECK ((expected_collection > (0)::numeric)),
    CONSTRAINT fund_tan_periods_period_end_check CHECK ((period_end >= (period_start + 6))),
    CONSTRAINT fund_tan_periods_sequence_no_check CHECK ((sequence_no > 0)),
    CONSTRAINT fund_tan_periods_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'COMPLETED'::text])))
);


--
-- Name: fund_tan_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_tan_periods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_tan_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_tan_periods_id_seq OWNED BY public.fund_tan_periods.id;


--
-- Name: fund_tan_schedule_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_tan_schedule_events (
    id integer NOT NULL,
    tan_config_id integer NOT NULL,
    tan_period_id integer,
    event_type text NOT NULL,
    effective_date date NOT NULL,
    days_shifted integer DEFAULT 0 NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    actor_id integer NOT NULL,
    before_value jsonb,
    after_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_tan_schedule_events_event_type_check CHECK ((event_type = ANY (ARRAY['PAUSED'::text, 'RESUMED'::text, 'RESCHEDULED'::text])))
);


--
-- Name: fund_tan_schedule_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_tan_schedule_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_tan_schedule_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_tan_schedule_events_id_seq OWNED BY public.fund_tan_schedule_events.id;


--
-- Name: fund_transfer_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_transfer_settlements (
    id integer NOT NULL,
    transfer_id integer NOT NULL,
    cycle_id integer NOT NULL,
    amount numeric NOT NULL,
    status text DEFAULT 'APPROVED'::text NOT NULL,
    approved_by integer,
    approved_at timestamp with time zone,
    notes text DEFAULT ''::text NOT NULL,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_transfer_settlements_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: fund_transfer_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_transfer_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_transfer_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_transfer_settlements_id_seq OWNED BY public.fund_transfer_settlements.id;


--
-- Name: fund_user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_user_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    permission text NOT NULL,
    cycle_id integer,
    expires_at timestamp with time zone,
    granted_by integer NOT NULL,
    revoked_by integer,
    revoked_at timestamp with time zone,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_user_permissions_permission_check CHECK ((permission = ANY (ARRAY['FULL_ACCESS'::text, 'PAYMENT_REVERSAL'::text, 'PAYOUT_APPROVAL'::text, 'PAYOUT_REVERSAL'::text, 'ADVANCE_ALLOCATION'::text, 'FINANCIAL_CORRECTION'::text, 'DRAW_DATE_CORRECTION'::text])))
);


--
-- Name: fund_user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_user_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_user_permissions_id_seq OWNED BY public.fund_user_permissions.id;


--
-- Name: fund_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_users (
    id integer NOT NULL,
    name text NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT fund_users_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'COLLECTOR'::text, 'CASH_RECEIVER'::text])))
);


--
-- Name: fund_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fund_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fund_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fund_users_id_seq OWNED BY public.fund_users.id;


--
-- Name: fund_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_audit ALTER COLUMN id SET DEFAULT nextval('public.fund_audit_id_seq'::regclass);


--
-- Name: fund_cash_handovers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers ALTER COLUMN id SET DEFAULT nextval('public.fund_cash_handovers_id_seq'::regclass);


--
-- Name: fund_collector_weekly_targets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets ALTER COLUMN id SET DEFAULT nextval('public.fund_collector_weekly_targets_id_seq'::regclass);


--
-- Name: fund_cycle_member_share_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_member_share_history ALTER COLUMN id SET DEFAULT nextval('public.fund_cycle_member_share_history_id_seq'::regclass);


--
-- Name: fund_cycle_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_members ALTER COLUMN id SET DEFAULT nextval('public.fund_cycle_members_id_seq'::regclass);


--
-- Name: fund_cycles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycles ALTER COLUMN id SET DEFAULT nextval('public.fund_cycles_id_seq'::regclass);


--
-- Name: fund_draw_disbursements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements ALTER COLUMN id SET DEFAULT nextval('public.fund_draw_disbursements_id_seq'::regclass);


--
-- Name: fund_draws id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws ALTER COLUMN id SET DEFAULT nextval('public.fund_draws_id_seq'::regclass);


--
-- Name: fund_due_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries ALTER COLUMN id SET DEFAULT nextval('public.fund_due_entries_id_seq'::regclass);


--
-- Name: fund_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_members ALTER COLUMN id SET DEFAULT nextval('public.fund_members_id_seq'::regclass);


--
-- Name: fund_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments ALTER COLUMN id SET DEFAULT nextval('public.fund_payments_id_seq'::regclass);


--
-- Name: fund_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_settlements ALTER COLUMN id SET DEFAULT nextval('public.fund_settlements_id_seq'::regclass);


--
-- Name: fund_share_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers ALTER COLUMN id SET DEFAULT nextval('public.fund_share_transfers_id_seq'::regclass);


--
-- Name: fund_tan_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs ALTER COLUMN id SET DEFAULT nextval('public.fund_tan_configs_id_seq'::regclass);


--
-- Name: fund_tan_member_draw_entitlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements ALTER COLUMN id SET DEFAULT nextval('public.fund_tan_member_draw_entitlements_id_seq'::regclass);


--
-- Name: fund_tan_period_member_obligations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations ALTER COLUMN id SET DEFAULT nextval('public.fund_tan_period_member_obligations_id_seq'::regclass);


--
-- Name: fund_tan_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods ALTER COLUMN id SET DEFAULT nextval('public.fund_tan_periods_id_seq'::regclass);


--
-- Name: fund_tan_schedule_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_schedule_events ALTER COLUMN id SET DEFAULT nextval('public.fund_tan_schedule_events_id_seq'::regclass);


--
-- Name: fund_transfer_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements ALTER COLUMN id SET DEFAULT nextval('public.fund_transfer_settlements_id_seq'::regclass);


--
-- Name: fund_user_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions ALTER COLUMN id SET DEFAULT nextval('public.fund_user_permissions_id_seq'::regclass);


--
-- Name: fund_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_users ALTER COLUMN id SET DEFAULT nextval('public.fund_users_id_seq'::regclass);


--
-- Name: fund_audit fund_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_audit
    ADD CONSTRAINT fund_audit_pkey PRIMARY KEY (id);


--
-- Name: fund_cash_handovers fund_cash_handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_pkey PRIMARY KEY (id);


--
-- Name: fund_collector_weekly_targets fund_collector_weekly_targets_cycle_id_collector_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets
    ADD CONSTRAINT fund_collector_weekly_targets_cycle_id_collector_id_key UNIQUE (cycle_id, collector_id);


--
-- Name: fund_collector_weekly_targets fund_collector_weekly_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets
    ADD CONSTRAINT fund_collector_weekly_targets_pkey PRIMARY KEY (id);


--
-- Name: fund_cycle_member_share_history fund_cycle_member_share_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_member_share_history
    ADD CONSTRAINT fund_cycle_member_share_history_pkey PRIMARY KEY (id);


--
-- Name: fund_cycle_members fund_cycle_members_cycle_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_members
    ADD CONSTRAINT fund_cycle_members_cycle_id_member_id_key UNIQUE (cycle_id, member_id);


--
-- Name: fund_cycle_members fund_cycle_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_members
    ADD CONSTRAINT fund_cycle_members_pkey PRIMARY KEY (id);


--
-- Name: fund_cycle_members fund_cycle_members_shares_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_cycle_members
    ADD CONSTRAINT fund_cycle_members_shares_check CHECK ((shares >= 0)) NOT VALID;


--
-- Name: fund_cycles fund_cycles_cycle_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycles
    ADD CONSTRAINT fund_cycles_cycle_number_key UNIQUE (cycle_number);


--
-- Name: fund_cycles fund_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycles
    ADD CONSTRAINT fund_cycles_pkey PRIMARY KEY (id);


--
-- Name: fund_draw_disbursements fund_draw_disbursements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_pkey PRIMARY KEY (id);


--
-- Name: fund_draws fund_draws_cycle_id_draw_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws
    ADD CONSTRAINT fund_draws_cycle_id_draw_number_key UNIQUE (cycle_id, draw_number);


--
-- Name: fund_draws fund_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws
    ADD CONSTRAINT fund_draws_pkey PRIMARY KEY (id);


--
-- Name: fund_draws fund_draws_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_draws
    ADD CONSTRAINT fund_draws_status_check CHECK ((status = ANY (ARRAY['RECORDED'::text, 'VOID'::text]))) NOT VALID;


--
-- Name: fund_due_entries fund_due_entries_cycle_id_member_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries
    ADD CONSTRAINT fund_due_entries_cycle_id_member_id_idempotency_key_key UNIQUE (cycle_id, member_id, idempotency_key);


--
-- Name: fund_due_entries fund_due_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries
    ADD CONSTRAINT fund_due_entries_pkey PRIMARY KEY (id);


--
-- Name: fund_members fund_members_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_members
    ADD CONSTRAINT fund_members_member_id_key UNIQUE (member_id);


--
-- Name: fund_members fund_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_members
    ADD CONSTRAINT fund_members_pkey PRIMARY KEY (id);


--
-- Name: fund_payments fund_payments_cycle_required_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_payments
    ADD CONSTRAINT fund_payments_cycle_required_check CHECK ((cycle_id IS NOT NULL)) NOT VALID;


--
-- Name: fund_payments fund_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_pkey PRIMARY KEY (id);


--
-- Name: fund_payments fund_payments_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_receipt_id_key UNIQUE (receipt_id);


--
-- Name: fund_payments fund_payments_receipt_source_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_payments
    ADD CONSTRAINT fund_payments_receipt_source_check CHECK ((receipt_source = ANY (ARRAY['COLLECTOR'::text, 'OWNER_DIRECT'::text, 'CASH_RECEIVER_DIRECT'::text]))) NOT VALID;


--
-- Name: fund_sessions fund_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_sessions
    ADD CONSTRAINT fund_sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: fund_settings fund_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_settings
    ADD CONSTRAINT fund_settings_pkey PRIMARY KEY (id);


--
-- Name: fund_settlements fund_settlements_cycle_required_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_settlements
    ADD CONSTRAINT fund_settlements_cycle_required_check CHECK ((cycle_id IS NOT NULL)) NOT VALID;


--
-- Name: fund_settlements fund_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_settlements
    ADD CONSTRAINT fund_settlements_pkey PRIMARY KEY (id);


--
-- Name: fund_share_transfers fund_share_transfers_created_by_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_created_by_idempotency_key_key UNIQUE (created_by, idempotency_key);


--
-- Name: fund_share_transfers fund_share_transfers_id_cycle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_id_cycle_key UNIQUE (id, cycle_id);


--
-- Name: fund_share_transfers fund_share_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_pkey PRIMARY KEY (id);


--
-- Name: fund_share_transfers fund_share_transfers_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_transfer_id_key UNIQUE (transfer_id);


--
-- Name: fund_tan_configs fund_tan_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs
    ADD CONSTRAINT fund_tan_configs_pkey PRIMARY KEY (id);


--
-- Name: fund_tan_member_draw_entitlements fund_tan_member_draw_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements
    ADD CONSTRAINT fund_tan_member_draw_entitlements_pkey PRIMARY KEY (id);


--
-- Name: fund_tan_member_draw_entitlements fund_tan_member_draw_entitlements_tan_config_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements
    ADD CONSTRAINT fund_tan_member_draw_entitlements_tan_config_id_member_id_key UNIQUE (tan_config_id, member_id);


--
-- Name: fund_tan_period_member_obligations fund_tan_period_member_obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations
    ADD CONSTRAINT fund_tan_period_member_obligations_pkey PRIMARY KEY (id);


--
-- Name: fund_tan_period_member_obligations fund_tan_period_member_obligations_tan_period_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations
    ADD CONSTRAINT fund_tan_period_member_obligations_tan_period_id_member_id_key UNIQUE (tan_period_id, member_id);


--
-- Name: fund_tan_periods fund_tan_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_pkey PRIMARY KEY (id);


--
-- Name: fund_tan_periods fund_tan_periods_tan_config_id_draw_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_tan_config_id_draw_date_key UNIQUE (tan_config_id, draw_date);


--
-- Name: fund_tan_periods fund_tan_periods_tan_config_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_tan_config_id_period_start_key UNIQUE (tan_config_id, period_start);


--
-- Name: fund_tan_periods fund_tan_periods_tan_config_id_sequence_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_tan_config_id_sequence_no_key UNIQUE (tan_config_id, sequence_no);


--
-- Name: fund_tan_schedule_events fund_tan_schedule_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_schedule_events
    ADD CONSTRAINT fund_tan_schedule_events_pkey PRIMARY KEY (id);


--
-- Name: fund_transfer_settlements fund_transfer_settlements_approved_by_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_approved_by_idempotency_key_key UNIQUE (approved_by, idempotency_key);


--
-- Name: fund_transfer_settlements fund_transfer_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_pkey PRIMARY KEY (id);


--
-- Name: fund_transfer_settlements fund_transfer_settlements_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'VOID'::text]))) NOT VALID;


--
-- Name: fund_transfer_settlements fund_transfer_settlements_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_transfer_id_key UNIQUE (transfer_id);


--
-- Name: fund_user_permissions fund_user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions
    ADD CONSTRAINT fund_user_permissions_pkey PRIMARY KEY (id);


--
-- Name: fund_users fund_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_users
    ADD CONSTRAINT fund_users_pkey PRIMARY KEY (id);


--
-- Name: fund_users fund_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_users
    ADD CONSTRAINT fund_users_username_key UNIQUE (username);


--
-- Name: fund_cash_handovers_cycle_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_cash_handovers_cycle_created_idx ON public.fund_cash_handovers USING btree (cycle_id, created_at DESC);


--
-- Name: fund_cash_handovers_from_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_cash_handovers_from_idempotency_idx ON public.fund_cash_handovers USING btree (from_user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_cash_handovers_to_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_cash_handovers_to_status_idx ON public.fund_cash_handovers USING btree (to_user_id, status, created_at DESC);


--
-- Name: fund_collector_weekly_targets_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_collector_weekly_targets_cycle_idx ON public.fund_collector_weekly_targets USING btree (cycle_id, collector_id);


--
-- Name: fund_cycle_member_share_history_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_cycle_member_share_history_lookup_idx ON public.fund_cycle_member_share_history USING btree (cycle_id, member_id, effective_date, created_at);


--
-- Name: fund_cycle_members_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_cycle_members_cycle_idx ON public.fund_cycle_members USING btree (cycle_id);


--
-- Name: fund_cycles_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_cycles_one_active_idx ON public.fund_cycles USING btree (status) WHERE (status = 'ACTIVE'::text);


--
-- Name: fund_draw_disbursements_active_draw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_draw_disbursements_active_draw_idx ON public.fund_draw_disbursements USING btree (draw_id) WHERE (status = 'PAID'::text);


--
-- Name: fund_draw_disbursements_cycle_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_draw_disbursements_cycle_date_idx ON public.fund_draw_disbursements USING btree (cycle_id, payout_date, created_at);


--
-- Name: fund_draw_disbursements_payer_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_draw_disbursements_payer_idempotency_idx ON public.fund_draw_disbursements USING btree (payer_user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_draws_cycle_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_draws_cycle_date_idx ON public.fund_draws USING btree (cycle_id, draw_date);


--
-- Name: fund_draws_cycle_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_draws_cycle_idempotency_idx ON public.fund_draws USING btree (cycle_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_draws_entitlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_draws_entitlement_idx ON public.fund_draws USING btree (entitlement_id);


--
-- Name: fund_draws_tan_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_draws_tan_period_idx ON public.fund_draws USING btree (tan_period_id);


--
-- Name: fund_draws_tan_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_draws_tan_slot_idx ON public.fund_draws USING btree (tan_period_id, draw_slot) WHERE ((tan_period_id IS NOT NULL) AND (draw_slot IS NOT NULL));


--
-- Name: fund_due_entries_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_due_entries_idempotency_idx ON public.fund_due_entries USING btree (cycle_id, member_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_due_entries_member_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_due_entries_member_date_idx ON public.fund_due_entries USING btree (cycle_id, member_id, due_date, created_at);


--
-- Name: fund_due_entries_tan_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_due_entries_tan_period_idx ON public.fund_due_entries USING btree (tan_period_id);


--
-- Name: fund_members_public_member_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_members_public_member_id_idx ON public.fund_members USING btree (public_member_id) WHERE (public_member_id IS NOT NULL);


--
-- Name: fund_payments_actor_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_payments_actor_idempotency ON public.fund_payments USING btree (collector_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_payments_collector_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_payments_collector_idempotency_idx ON public.fund_payments USING btree (collector_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_payments_cycle_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_payments_cycle_date_idx ON public.fund_payments USING btree (cycle_id, collection_date);


--
-- Name: fund_payments_receiver_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_payments_receiver_cycle_idx ON public.fund_payments USING btree (receiver_id, cycle_id, status);


--
-- Name: fund_payments_tan_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_payments_tan_period_idx ON public.fund_payments USING btree (tan_period_id);


--
-- Name: fund_reversal_original_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_reversal_original_idx ON public.fund_payments USING btree (reversed_payment_id) WHERE (reversed_payment_id IS NOT NULL);


--
-- Name: fund_settlements_actor_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_settlements_actor_idempotency ON public.fund_settlements USING btree (collector_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_settlements_collector_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_settlements_collector_idempotency_idx ON public.fund_settlements USING btree (collector_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: fund_settlements_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_settlements_cycle_idx ON public.fund_settlements USING btree (cycle_id, created_at);


--
-- Name: fund_share_transfers_cycle_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_share_transfers_cycle_date_idx ON public.fund_share_transfers USING btree (cycle_id, transfer_date, created_at);


--
-- Name: fund_share_transfers_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_share_transfers_from_idx ON public.fund_share_transfers USING btree (cycle_id, from_member_id, created_at);


--
-- Name: fund_share_transfers_tan_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_share_transfers_tan_period_idx ON public.fund_share_transfers USING btree (tan_period_id);


--
-- Name: fund_share_transfers_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_share_transfers_to_idx ON public.fund_share_transfers USING btree (cycle_id, to_member_id, created_at);


--
-- Name: fund_tan_configs_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_tan_configs_cycle_idx ON public.fund_tan_configs USING btree (cycle_id, id DESC);


--
-- Name: fund_tan_member_draw_entitlements_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_tan_member_draw_entitlements_member_idx ON public.fund_tan_member_draw_entitlements USING btree (cycle_id, member_id);


--
-- Name: fund_tan_obligations_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_tan_obligations_member_idx ON public.fund_tan_period_member_obligations USING btree (cycle_id, member_id, tan_period_id);


--
-- Name: fund_tan_schedule_events_config_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_tan_schedule_events_config_idx ON public.fund_tan_schedule_events USING btree (tan_config_id, created_at DESC);


--
-- Name: fund_transfer_settlements_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_transfer_settlements_cycle_idx ON public.fund_transfer_settlements USING btree (cycle_id, created_at);


--
-- Name: fund_user_permissions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fund_user_permissions_active_idx ON public.fund_user_permissions USING btree (user_id, permission, COALESCE(cycle_id, 0)) WHERE (revoked_at IS NULL);


--
-- Name: fund_user_permissions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_user_permissions_lookup_idx ON public.fund_user_permissions USING btree (user_id, permission, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: fund_audit fund_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_audit
    ADD CONSTRAINT fund_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.fund_users(id);


--
-- Name: fund_cash_handovers fund_cash_handovers_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_counted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cash_handovers fund_cash_handovers_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cash_handovers
    ADD CONSTRAINT fund_cash_handovers_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_collector_weekly_targets fund_collector_weekly_targets_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets
    ADD CONSTRAINT fund_collector_weekly_targets_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_collector_weekly_targets fund_collector_weekly_targets_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets
    ADD CONSTRAINT fund_collector_weekly_targets_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_collector_weekly_targets fund_collector_weekly_targets_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_collector_weekly_targets
    ADD CONSTRAINT fund_collector_weekly_targets_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cycle_member_share_history fund_cycle_member_share_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_member_share_history
    ADD CONSTRAINT fund_cycle_member_share_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_cycle_member_share_history fund_cycle_member_share_history_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_member_share_history
    ADD CONSTRAINT fund_cycle_member_share_history_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_cycle_member_share_history fund_cycle_member_share_history_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_member_share_history
    ADD CONSTRAINT fund_cycle_member_share_history_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_cycle_members fund_cycle_members_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_members
    ADD CONSTRAINT fund_cycle_members_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_cycle_members fund_cycle_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_cycle_members
    ADD CONSTRAINT fund_cycle_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_draw_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES public.fund_draws(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_draw_disbursements fund_draw_disbursements_winner_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draw_disbursements
    ADD CONSTRAINT fund_draw_disbursements_winner_member_id_fkey FOREIGN KEY (winner_member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_draws fund_draws_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws
    ADD CONSTRAINT fund_draws_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_draws fund_draws_cycle_winner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws
    ADD CONSTRAINT fund_draws_cycle_winner_fkey FOREIGN KEY (cycle_id, winner_member_id) REFERENCES public.fund_cycle_members(cycle_id, member_id) NOT VALID;


--
-- Name: fund_draws fund_draws_winner_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_draws
    ADD CONSTRAINT fund_draws_winner_member_id_fkey FOREIGN KEY (winner_member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_due_entries fund_due_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries
    ADD CONSTRAINT fund_due_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_due_entries fund_due_entries_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries
    ADD CONSTRAINT fund_due_entries_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_due_entries fund_due_entries_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_due_entries
    ADD CONSTRAINT fund_due_entries_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_members fund_members_assigned_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_members
    ADD CONSTRAINT fund_members_assigned_collector_id_fkey FOREIGN KEY (assigned_collector_id) REFERENCES public.fund_users(id);


--
-- Name: fund_payments fund_payments_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES public.fund_users(id);


--
-- Name: fund_payments fund_payments_cycle_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_cycle_member_fkey FOREIGN KEY (cycle_id, member_id) REFERENCES public.fund_cycle_members(cycle_id, member_id) NOT VALID;


--
-- Name: fund_payments fund_payments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id);


--
-- Name: fund_payments fund_payments_receiver_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_receiver_fkey FOREIGN KEY (receiver_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT NOT VALID;


--
-- Name: fund_payments fund_payments_reversed_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_payments
    ADD CONSTRAINT fund_payments_reversed_payment_id_fkey FOREIGN KEY (reversed_payment_id) REFERENCES public.fund_payments(id);


--
-- Name: fund_sessions fund_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_sessions
    ADD CONSTRAINT fund_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.fund_users(id);


--
-- Name: fund_settlements fund_settlements_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_settlements
    ADD CONSTRAINT fund_settlements_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES public.fund_users(id);


--
-- Name: fund_settlements fund_settlements_cycle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_settlements
    ADD CONSTRAINT fund_settlements_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) NOT VALID;


--
-- Name: fund_share_transfers fund_share_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_share_transfers fund_share_transfers_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_share_transfers fund_share_transfers_from_cycle_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_from_cycle_member_fkey FOREIGN KEY (cycle_id, from_member_id) REFERENCES public.fund_cycle_members(cycle_id, member_id) NOT VALID;


--
-- Name: fund_share_transfers fund_share_transfers_from_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_from_member_id_fkey FOREIGN KEY (from_member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_share_transfers fund_share_transfers_to_cycle_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_to_cycle_member_fkey FOREIGN KEY (cycle_id, to_member_id) REFERENCES public.fund_cycle_members(cycle_id, member_id) NOT VALID;


--
-- Name: fund_share_transfers fund_share_transfers_to_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_share_transfers
    ADD CONSTRAINT fund_share_transfers_to_member_id_fkey FOREIGN KEY (to_member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_configs fund_tan_configs_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs
    ADD CONSTRAINT fund_tan_configs_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_configs fund_tan_configs_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs
    ADD CONSTRAINT fund_tan_configs_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_configs fund_tan_configs_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs
    ADD CONSTRAINT fund_tan_configs_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_configs fund_tan_configs_pause_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_configs
    ADD CONSTRAINT fund_tan_configs_pause_period_id_fkey FOREIGN KEY (pause_period_id) REFERENCES public.fund_tan_periods(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_member_draw_entitlements fund_tan_member_draw_entitlements_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements
    ADD CONSTRAINT fund_tan_member_draw_entitlements_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_member_draw_entitlements fund_tan_member_draw_entitlements_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements
    ADD CONSTRAINT fund_tan_member_draw_entitlements_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_member_draw_entitlements fund_tan_member_draw_entitlements_tan_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_member_draw_entitlements
    ADD CONSTRAINT fund_tan_member_draw_entitlements_tan_config_id_fkey FOREIGN KEY (tan_config_id) REFERENCES public.fund_tan_configs(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_period_member_obligations fund_tan_period_member_obligations_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations
    ADD CONSTRAINT fund_tan_period_member_obligations_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_period_member_obligations fund_tan_period_member_obligations_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations
    ADD CONSTRAINT fund_tan_period_member_obligations_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.fund_members(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_period_member_obligations fund_tan_period_member_obligations_tan_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_period_member_obligations
    ADD CONSTRAINT fund_tan_period_member_obligations_tan_period_id_fkey FOREIGN KEY (tan_period_id) REFERENCES public.fund_tan_periods(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_periods fund_tan_periods_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_periods fund_tan_periods_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_periods fund_tan_periods_tan_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_periods
    ADD CONSTRAINT fund_tan_periods_tan_config_id_fkey FOREIGN KEY (tan_config_id) REFERENCES public.fund_tan_configs(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_schedule_events fund_tan_schedule_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_schedule_events
    ADD CONSTRAINT fund_tan_schedule_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_schedule_events fund_tan_schedule_events_tan_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_schedule_events
    ADD CONSTRAINT fund_tan_schedule_events_tan_config_id_fkey FOREIGN KEY (tan_config_id) REFERENCES public.fund_tan_configs(id) ON DELETE RESTRICT;


--
-- Name: fund_tan_schedule_events fund_tan_schedule_events_tan_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_tan_schedule_events
    ADD CONSTRAINT fund_tan_schedule_events_tan_period_id_fkey FOREIGN KEY (tan_period_id) REFERENCES public.fund_tan_periods(id) ON DELETE RESTRICT;


--
-- Name: fund_transfer_settlements fund_transfer_settlements_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_transfer_settlements fund_transfer_settlements_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_transfer_settlements fund_transfer_settlements_transfer_cycle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_transfer_cycle_fkey FOREIGN KEY (transfer_id, cycle_id) REFERENCES public.fund_share_transfers(id, cycle_id) NOT VALID;


--
-- Name: fund_transfer_settlements fund_transfer_settlements_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transfer_settlements
    ADD CONSTRAINT fund_transfer_settlements_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.fund_share_transfers(id) ON DELETE RESTRICT;


--
-- Name: fund_user_permissions fund_user_permissions_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions
    ADD CONSTRAINT fund_user_permissions_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.fund_cycles(id) ON DELETE RESTRICT;


--
-- Name: fund_user_permissions fund_user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions
    ADD CONSTRAINT fund_user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_user_permissions fund_user_permissions_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions
    ADD CONSTRAINT fund_user_permissions_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- Name: fund_user_permissions fund_user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_user_permissions
    ADD CONSTRAINT fund_user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.fund_users(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict gehYyRK6vWwFp83hcI98YO2mzDnTpfaLBf0haK4zSe88ViQZzCF3vwRATWaajIS

