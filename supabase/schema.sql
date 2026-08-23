-- Inventory Management schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query)

create extension if not exists pgcrypto;

-- ============================================================
-- Profiles (one row per staff member, auto-created on invite)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Products (master list, matches your spreadsheet columns)
-- ============================================================
create table public.products (
  product_id text primary key,
  variety text not null,
  gsm numeric,
  size_cm text,
  size_in text,
  packet_weight numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Purchase Orders (placed with the mill, identified by their SO number)
-- ============================================================
create table public.purchase_orders (
  po_id bigint generated always as identity primary key,
  so_number text not null unique,
  order_placed_date date not null default current_date,
  so_date date,
  company text,                    -- Bill To: which of our own companies placed this PO ('Kalra Paper Impex' / 'Reliable Papers')
  source text,                     -- mill unit: 'JK Paper CPM' / 'JK Paper QSC' — drives whether QSC item fields apply
  ship_to text,                    -- free text: our customer this material is ultimately going to
  remarks text,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- one row per product on a PO — an SO number can cover many items.
-- these columns build up the agreed "actual price per kg" that a bill is reconciled against.
create table public.purchase_order_items (
  po_item_id bigint generated always as identity primary key,
  po_id bigint not null references public.purchase_orders (po_id),
  product_id text not null references public.products (product_id),
  ordered_qty_kg numeric not null check (ordered_qty_kg > 0),
  nsr_rate numeric,
  cash_discount_pct numeric not null default 2,
  customer_discount_per_kg numeric not null default 0,
  additional_discount_per_kg numeric not null default 0,
  additional_discount_ack_number text,
  additional_discount_ack_date date,
  freight_per_kg numeric not null default 0,
  insurance_per_kg numeric not null default 0.070,
  qsc_incidental_per_kg numeric not null default 0,       -- only applies when the PO's source is JK Paper QSC
  qsc_freight_discount_per_kg numeric not null default 0, -- only applies when the PO's source is JK Paper QSC
  closed boolean not null default false,
  closed_date date,
  closed_by uuid references public.profiles (id),
  note text,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Receipts (incoming stock)
-- ============================================================
create table public.receipts (
  receipt_id bigint generated always as identity primary key,
  date date not null default current_date,
  product_id text not null references public.products (product_id),
  packets numeric not null check (packets > 0),
  vehicle text,
  container_no text,
  remarks text,
  po_item_id bigint references public.purchase_order_items (po_item_id),
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Dispatches (outgoing stock)
-- ============================================================
create table public.dispatches (
  dispatch_id bigint generated always as identity primary key,
  date date not null default current_date,
  product_id text not null references public.products (product_id),
  packets numeric not null check (packets > 0),
  vehicle text,
  challan_no text,
  remarks text,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Holds (reserved stock, not yet dispatched)
-- ============================================================
create table public.holds (
  hold_id bigint generated always as identity primary key,
  product_id text not null references public.products (product_id),
  packets numeric not null check (packets > 0),
  held_by text not null,
  held_date date not null default current_date,
  note text,
  released boolean not null default false,
  released_date date,
  released_by uuid references public.profiles (id),
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Stock summary (computed, always in sync — nothing to edit by hand)
-- ============================================================
create view public.stock_summary
with (security_invoker = true) as
select
  p.product_id,
  p.variety,
  p.gsm,
  p.size_cm,
  p.size_in,
  p.packet_weight,
  p.active,
  coalesce(r.total_received, 0) as packets_received,
  coalesce(d.total_dispatched, 0) as packets_dispatched,
  coalesce(r.total_received, 0) - coalesce(d.total_dispatched, 0) as packets_in_stock,
  coalesce(h.total_held, 0) as packets_on_hold,
  (coalesce(r.total_received, 0) - coalesce(d.total_dispatched, 0)) - coalesce(h.total_held, 0) as packets_available,
  (coalesce(r.total_received, 0) - coalesce(d.total_dispatched, 0)) * p.packet_weight as quantity_kg,
  ((coalesce(r.total_received, 0) - coalesce(d.total_dispatched, 0)) - coalesce(h.total_held, 0)) * p.packet_weight as quantity_after_hold_kg
from public.products p
left join (
  select product_id, sum(packets) as total_received
  from public.receipts
  group by product_id
) r on r.product_id = p.product_id
left join (
  select product_id, sum(packets) as total_dispatched
  from public.dispatches
  group by product_id
) d on d.product_id = p.product_id
left join (
  select product_id, sum(packets) as total_held
  from public.holds
  where released = false
  group by product_id
) h on h.product_id = p.product_id;

-- ============================================================
-- Purchase order item status (computed, always in sync)
-- ============================================================
create view public.po_item_status
with (security_invoker = true) as
select
  poi.po_item_id,
  po.po_id,
  po.so_number,
  po.order_placed_date,
  po.so_date,
  po.company,
  po.source,
  po.ship_to,
  poi.product_id,
  p.variety,
  p.gsm,
  p.size_cm,
  p.size_in,
  p.packet_weight,
  poi.ordered_qty_kg,
  poi.nsr_rate,
  poi.cash_discount_pct,
  poi.customer_discount_per_kg,
  poi.additional_discount_per_kg,
  poi.freight_per_kg,
  poi.insurance_per_kg,
  poi.qsc_incidental_per_kg,
  poi.qsc_freight_discount_per_kg,
  poi.nsr_rate
    - (poi.nsr_rate * poi.cash_discount_pct / 100)
    - poi.customer_discount_per_kg
    - poi.additional_discount_per_kg
    + poi.freight_per_kg
    + poi.insurance_per_kg
    + case when po.source = 'JK Paper QSC' then poi.qsc_incidental_per_kg else 0 end
    - case when po.source = 'JK Paper QSC' then poi.qsc_freight_discount_per_kg else 0 end
    as actual_price_per_kg,
  poi.closed,
  poi.closed_date,
  coalesce(r.received_kg, 0) as received_kg,
  poi.ordered_qty_kg - coalesce(r.received_kg, 0) as balance_kg,
  poi.additional_discount_ack_number,
  poi.additional_discount_ack_date
from public.purchase_order_items poi
join public.purchase_orders po on po.po_id = poi.po_id
join public.products p on p.product_id = poi.product_id
left join (
  select rec.po_item_id, sum(rec.packets * pr.packet_weight) as received_kg
  from public.receipts rec
  join public.products pr on pr.product_id = rec.product_id
  where rec.po_item_id is not null
  group by rec.po_item_id
) r on r.po_item_id = poi.po_item_id;

-- ============================================================
-- Bills (mill invoices) and their reconciliation against NSR
-- ============================================================
create table public.bills (
  bill_id bigint generated always as identity primary key,
  bill_number text not null,
  bill_date date not null default current_date,
  gst_rate numeric not null default 18,
  remarks text,
  credit_note_number text,
  credit_note_amount numeric,
  credit_note_date date,
  settled boolean not null default false,
  settled_date date,
  settled_by uuid references public.profiles (id),
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- one row per product on a bill. The per-kg discounts/additions now live on the
-- PO item (agreed at ordering time) — a bill just states qty and what the mill billed.
create table public.bill_items (
  bill_item_id bigint generated always as identity primary key,
  bill_id bigint not null references public.bills (bill_id),
  po_item_id bigint not null references public.purchase_order_items (po_item_id),
  qty_kg numeric not null check (qty_kg > 0),
  mill_billed_amount numeric not null,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- per-item reconciliation: qty x the PO item's actual (agreed) price per kg, vs what the mill billed
create view public.bill_item_status
with (security_invoker = true) as
select
  bi.bill_item_id,
  b.bill_id,
  b.bill_number,
  b.bill_date,
  pis.po_item_id,
  pis.so_number,
  pis.company,
  pis.source,
  pis.ship_to,
  pis.product_id,
  pis.variety,
  pis.gsm,
  pis.size_cm,
  pis.size_in,
  pis.nsr_rate,
  pis.actual_price_per_kg,
  bi.qty_kg,
  bi.mill_billed_amount,
  bi.qty_kg * pis.actual_price_per_kg as expected_amount,
  bi.mill_billed_amount - (bi.qty_kg * pis.actual_price_per_kg) as variance
from public.bill_items bi
join public.bills b on b.bill_id = bi.bill_id
join public.po_item_status pis on pis.po_item_id = bi.po_item_id;

-- per-bill totals: GST applies once, on the summed variance — not per item
create view public.bill_summary
with (security_invoker = true) as
select
  b.bill_id,
  b.bill_number,
  b.bill_date,
  b.remarks,
  b.credit_note_number,
  b.credit_note_amount,
  b.credit_note_date,
  b.settled,
  coalesce(v.total_variance, 0) as total_variance,
  coalesce(v.total_variance, 0) * (b.gst_rate / 100) as gst_amount,
  coalesce(v.total_variance, 0) * (1 + b.gst_rate / 100) as net_claim,
  b.gst_rate
from public.bills b
left join (
  select bill_id, sum(variance) as total_variance
  from public.bill_item_status
  group by bill_id
) v on v.bill_id = b.bill_id;

-- ============================================================
-- KPI Purchases — fully separate module: goods bought from traders,
-- unrelated to the mill/SO/NSR purchase-order flow above. Does not
-- touch products, stock, purchase_orders, or bills.
-- ============================================================
create table public.traders (
  trader_id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.kpi_invoices (
  invoice_id bigint generated always as identity primary key,
  trader_id bigint not null references public.traders (trader_id),
  invoice_number text not null,
  invoice_date date not null default current_date,
  vehicle_number text,
  gst_rate numeric not null default 18,
  remarks text,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- item_no is not stored — it's just this item's position among the invoice's
-- items in entry order, computed for display (1, 2, 3, ...).
create table public.kpi_invoice_items (
  item_id bigint generated always as identity primary key,
  invoice_id bigint not null references public.kpi_invoices (invoice_id),
  item_description text not null,
  hsn_number text,
  unit text not null,
  quantity_units numeric not null check (quantity_units > 0),
  quantity_kg numeric not null check (quantity_kg > 0),
  price_per_kg numeric not null,
  amount numeric generated always as (quantity_kg * price_per_kg) stored,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.kpi_invoice_charges (
  charge_id bigint generated always as identity primary key,
  invoice_id bigint not null references public.kpi_invoices (invoice_id),
  description text not null,
  amount numeric not null,
  edited_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create view public.kpi_invoice_summary
with (security_invoker = true) as
select
  ki.invoice_id,
  ki.trader_id,
  t.name as purchased_from,
  ki.invoice_number,
  ki.invoice_date,
  ki.vehicle_number,
  ki.gst_rate,
  ki.remarks,
  coalesce(items.items_subtotal, 0) as items_subtotal,
  coalesce(charges.charges_total, 0) as charges_total,
  coalesce(items.items_subtotal, 0) + coalesce(charges.charges_total, 0) as taxable_amount,
  (coalesce(items.items_subtotal, 0) + coalesce(charges.charges_total, 0)) * (ki.gst_rate / 100) as gst_amount,
  (coalesce(items.items_subtotal, 0) + coalesce(charges.charges_total, 0)) * (1 + ki.gst_rate / 100) as total_amount
from public.kpi_invoices ki
join public.traders t on t.trader_id = ki.trader_id
left join (
  select invoice_id, sum(amount) as items_subtotal
  from public.kpi_invoice_items
  group by invoice_id
) items on items.invoice_id = ki.invoice_id
left join (
  select invoice_id, sum(amount) as charges_total
  from public.kpi_invoice_charges
  group by invoice_id
) charges on charges.invoice_id = ki.invoice_id;

-- ============================================================
-- Row Level Security
-- Simple model for a 10-person trusted internal team:
-- any signed-in user can read/write. Tighten later per-role if needed.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.traders enable row level security;
alter table public.kpi_invoices enable row level security;
alter table public.kpi_invoice_items enable row level security;
alter table public.kpi_invoice_charges enable row level security;
alter table public.receipts enable row level security;
alter table public.dispatches enable row level security;
alter table public.holds enable row level security;

create policy "profiles: read all" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

create policy "products: read" on public.products
  for select using (auth.role() = 'authenticated');
create policy "products: write" on public.products
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "purchase_orders: read" on public.purchase_orders
  for select using (auth.role() = 'authenticated');
create policy "purchase_orders: write" on public.purchase_orders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "purchase_order_items: read" on public.purchase_order_items
  for select using (auth.role() = 'authenticated');
create policy "purchase_order_items: write" on public.purchase_order_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "bills: read" on public.bills
  for select using (auth.role() = 'authenticated');
create policy "bills: write" on public.bills
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "bill_items: read" on public.bill_items
  for select using (auth.role() = 'authenticated');
create policy "bill_items: write" on public.bill_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "traders: read" on public.traders
  for select using (auth.role() = 'authenticated');
create policy "traders: write" on public.traders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "kpi_invoices: read" on public.kpi_invoices
  for select using (auth.role() = 'authenticated');
create policy "kpi_invoices: write" on public.kpi_invoices
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "kpi_invoice_items: read" on public.kpi_invoice_items
  for select using (auth.role() = 'authenticated');
create policy "kpi_invoice_items: write" on public.kpi_invoice_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "kpi_invoice_charges: read" on public.kpi_invoice_charges
  for select using (auth.role() = 'authenticated');
create policy "kpi_invoice_charges: write" on public.kpi_invoice_charges
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "receipts: read" on public.receipts
  for select using (auth.role() = 'authenticated');
create policy "receipts: write" on public.receipts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "dispatches: read" on public.dispatches
  for select using (auth.role() = 'authenticated');
create policy "dispatches: write" on public.dispatches
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "holds: read" on public.holds
  for select using (auth.role() = 'authenticated');
create policy "holds: write" on public.holds
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Grants
-- RLS policies above control *which rows* are visible; Postgres also
-- requires a plain GRANT before a role can query the object at all.
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;
grant select, insert, update, delete on public.bills to authenticated;
grant select, insert, update, delete on public.bill_items to authenticated;
grant select, insert, update, delete on public.traders to authenticated;
grant select, insert, update, delete on public.kpi_invoices to authenticated;
grant select, insert, update, delete on public.kpi_invoice_items to authenticated;
grant select, insert, update, delete on public.kpi_invoice_charges to authenticated;
grant select, insert, update, delete on public.receipts to authenticated;
grant select, insert, update, delete on public.dispatches to authenticated;
grant select, insert, update, delete on public.holds to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.stock_summary to authenticated;
grant select on public.po_item_status to authenticated;
grant select on public.bill_item_status to authenticated;
grant select on public.bill_summary to authenticated;
grant select on public.kpi_invoice_summary to authenticated;
