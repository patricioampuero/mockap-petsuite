-- Fotos subidas por los usuarios (por ahora, las de sus mascotas). Se guardan en la base porque la app las reduce a
-- unos 150 KB antes de subirlas; si el volumen crece, se pueden mover a Supabase Storage sin cambiar las pantallas.
create table imagenes (
  id         uuid primary key default gen_random_uuid(),
  dueno_id   uuid not null references usuarios on delete cascade,
  tipo       text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp')),
  datos      bytea not null,
  bytes      integer not null check (bytes between 1 and 600000),
  creado_en  timestamptz not null default now()
);
create index imagenes_dueno_idx on imagenes (dueno_id);

alter table imagenes enable row level security;
