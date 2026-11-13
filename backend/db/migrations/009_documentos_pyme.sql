-- Documentos con que un negocio respalda su validación: patente comercial, resolución sanitaria y, si es una
-- empresa, la constitución de la sociedad. Uno por tipo; al subir otro se reemplaza y vuelve a revisión.
-- Son privados: solo los ve el negocio y el equipo de PetSuite (nunca se publican).
create table documentos_pyme (
  id           uuid primary key default gen_random_uuid(),
  pyme_id      uuid not null references pymes on delete cascade,
  tipo         text not null check (tipo in ('patente_comercial', 'resolucion_sanitaria', 'constitucion_sociedad')),
  nombre       text not null check (char_length(nombre) between 1 and 120),
  mime         text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  datos        bytea not null,
  bytes        integer not null check (bytes between 1 and 2000000),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo       text check (motivo is null or char_length(motivo) <= 500),
  subido_por   uuid references usuarios on delete set null,
  subido_en    timestamptz not null default now(),
  revisado_por uuid references usuarios on delete set null,
  revisado_en  timestamptz,
  unique (pyme_id, tipo)
);

alter table documentos_pyme enable row level security;
