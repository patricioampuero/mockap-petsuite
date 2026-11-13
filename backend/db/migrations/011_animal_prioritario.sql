-- Animal prioritario: cada ONG puede destacar a uno (un caso urgente o que lleva mucho tiempo esperando).
-- Aparece primero en Adopciones. Solo uno por ONG: si todas pudieran marcar a todos, nadie destacaría.
alter table animales add column prioritario boolean not null default false;
create unique index animales_un_prioritario_por_ong on animales (ong_id) where prioritario;
