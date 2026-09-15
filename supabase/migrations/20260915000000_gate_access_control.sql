-- Gate-based vehicle access control
-- The uploaded image batch is assigned to one gate.
-- A recognized plate becomes authorized for that gate.

create table if not exists public.gates (
  code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.gates (code, name) values
  ('1A', 'Cổng 1A'),
  ('3', 'Cổng 3'),
  ('4A', 'Cổng 4A'),
  ('VG1', 'VG1'),
  ('V2', 'Cổng V2'),
  ('V3', 'Cổng V3'),
  ('V3A', 'V3A'),
  ('VG4', 'VG4'),
  ('V4A', 'V4A'),
  ('V5', 'Cổng V5'),
  ('V5A', 'V5A'),
  ('V5B', 'V5B'),
  ('V6', 'Cổng V6'),
  ('1D', 'Cổng 1D')
on conflict (code) do update set name = excluded.name, active = true;

alter table public.plate_records
  add column if not exists gate_code text,
  add column if not exists gate_name text;

create index if not exists plate_records_gate_plate_created_idx
  on public.plate_records (gate_code, plate, created_at desc);

create table if not exists public.authorized_plates (
  plate text not null,
  gate_code text not null references public.gates(code) on update cascade,
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plate, gate_code)
);

create index if not exists authorized_plates_gate_active_idx
  on public.authorized_plates (gate_code, active, valid_from, valid_until);

alter table public.gates enable row level security;
alter table public.authorized_plates enable row level security;

-- Web2 uses the publishable/anon key for read-only gate checks.
drop policy if exists "Public can read active gates" on public.gates;
create policy "Public can read active gates"
on public.gates
for select
to anon, authenticated
using (active = true);

drop policy if exists "Public can check authorized plates" on public.authorized_plates;
create policy "Public can check authorized plates"
on public.authorized_plates
for select
to anon, authenticated
using (active = true);

-- Existing plate rows remain valid; new rows are gate-aware.
comment on column public.plate_records.gate_code is 'Gate code assigned when the image batch is uploaded';
comment on column public.plate_records.gate_name is 'Display name of the gate at upload time';
