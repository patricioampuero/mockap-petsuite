-- Pagos de los planes con Mercado Pago (Checkout Pro): se confirman solos cuando Mercado Pago informa el pago.
alter table pagos drop constraint pagos_canal_check;
alter table pagos add constraint pagos_canal_check check (canal in ('transferencia', 'orcob', 'mercadopago'));
