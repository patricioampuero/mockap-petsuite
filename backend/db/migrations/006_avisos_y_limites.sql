-- Aviso al tutor cuando alguien escribe desde la medalla QR, y límites de solicitudes contra la fuerza bruta.

-- Nuevo tipo de correo: el aviso de un mensaje recibido desde la ficha pública.
alter table correos drop constraint correos_tipo_check;
alter table correos add constraint correos_tipo_check
  check (tipo in ('bienvenida', 'verificacion', 'restablecer', 'cuenta_creada', 'cuenta_equipo', 'aprobacion', 'convenio', 'cobranza', 'privacidad', 'premio', 'aviso_qr'));

-- Un evento por intento contado (contraseña incorrecta, correo enviado, mensaje desde un QR).
-- Solo se guarda la huella SHA-256 de la clave: nunca el correo, el token de la medalla ni la IP.
create table limites_solicitudes (
  clave_hash  bytea not null,
  ocurrido_en timestamptz not null
);
create index limites_solicitudes_clave_idx on limites_solicitudes (clave_hash, ocurrido_en);
create index limites_solicitudes_fecha_idx on limites_solicitudes (ocurrido_en);

-- Como el resto de las tablas: sin acceso por la API pública de Supabase; el backend accede como dueño.
alter table limites_solicitudes enable row level security;
