-- Fichas con información pública: negocios reales que aún no se inscriben en PetSuite. Aparecen en Explorar
-- con sus datos públicos (nombre, dirección, teléfono y rubro), en gris y sin sello, hasta que su dueño las reclame.

-- origen: 'registro' = lo inscribió su dueño; 'publica' = se armó con datos públicos y no tiene dueño todavía.
alter table pymes add column origen text not null default 'registro' check (origen in ('registro', 'publica'));
-- De dónde salieron los datos de una ficha pública (por ejemplo, el sitio web del negocio).
alter table pymes add column fuente text;

-- Una ficha pública no tiene dueño ni RUT; un negocio inscrito siempre los tiene.
alter table pymes alter column propietario_id drop not null;
alter table pymes alter column rut_empresa drop not null;
alter table pymes add constraint pymes_registro_completo check (origen = 'publica' or (propietario_id is not null and rut_empresa is not null));
alter table pymes add constraint pymes_publica_con_fuente check (origen = 'registro' or (fuente is not null and propietario_id is null));
-- Nunca se valida sin su dueño: la ficha pública queda pendiente hasta que alguien la reclame.
alter table pymes add constraint pymes_publica_sin_validar check (origen = 'registro' or estado_verificacion = 'pendiente');

create index pymes_publicas_idx on pymes (comuna_id, rubro) where origen = 'publica';
