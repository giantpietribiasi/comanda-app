-- Ejecutar completo en el SQL Editor de Supabase (Project > SQL Editor > New query)

create table if not exists app_data (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into app_data (id, data)
values (1, '{
  "menuItems": [],
  "orders": [],
  "inventory": [],
  "currentTicket": {"items": []},
  "settings": {"pin": null},
  "users": [],
  "activityLog": []
}'::jsonb)
on conflict (id) do nothing;

alter table app_data enable row level security;

-- Estas políticas permiten que cualquiera con la URL de tu app lea y escriba los datos.
-- Es lo mismo que "sin login" a nivel base de datos: la protección de acceso la da
-- el PIN dentro de la app y el hecho de que la URL no es pública/indexada.
create policy "Permitir lectura" on app_data
  for select using (true);

create policy "Permitir escritura" on app_data
  for update using (true) with check (true);

-- Habilita que los cambios se reflejen en tiempo real entre PC y celular
alter publication supabase_realtime add table app_data;
