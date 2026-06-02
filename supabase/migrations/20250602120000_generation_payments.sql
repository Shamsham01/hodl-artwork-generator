-- On-chain generation fee receipts (MultiversX USDC payments)
CREATE TABLE public.generation_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tx_hash TEXT UNIQUE NOT NULL,
  wallet_address TEXT NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  edition_count INT NOT NULL,
  amount_atomic TEXT NOT NULL,
  token_identifier TEXT NOT NULL DEFAULT 'USDC-c76f1f',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX generation_payments_wallet_idx ON public.generation_payments (wallet_address);
CREATE INDEX generation_payments_project_idx ON public.generation_payments (project_id);

ALTER TABLE public.generation_payments ENABLE ROW LEVEL SECURITY;

-- Service role (API) inserts and reads; no direct client access required.
CREATE POLICY "Service role full access on generation_payments"
  ON public.generation_payments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
