-- ============================================
-- Finanças Sync — espaço por código, sem login
-- ============================================
-- Execute UMA vez no SQL Editor do Supabase
-- (Dashboard → SQL Editor → New query → colar → Run)
--
-- Como funciona:
--   * space_id = SHA-256 hex do código (nunca expõe o código em si)
--   * os dados são criptografados no cliente (AES-256-GCM); o servidor
--     guarda APENAS o payload cifrado (salt + iv + ciphertext)
--   * acesso SOMENTE via RPC (SECURITY DEFINER) — anon/authenticated
--     não têm permissão de ler/escrever a tabela diretamente

create table if not exists public.space_snapshots (
  space_id text primary key,
  salt text not null,
  data_enc text not null,
  iv text not null,
  version integer not null default 1,
  item_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.space_save(
  p_space_id text, p_salt text, p_iv text, p_data_enc text, p_item_count integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  -- validação mínima (zero trust no servidor também)
  if p_space_id is null or length(p_space_id) < 16 then
    return json_build_object('ok', false, 'error', 'space_id inválido');
  end if;
  if p_salt is null or length(p_salt) < 16 then
    return json_build_object('ok', false, 'error', 'salt inválido');
  end if;
  if p_iv is null or length(p_iv) < 12 then
    return json_build_object('ok', false, 'error', 'iv inválido');
  end if;
  if p_data_enc is null or length(p_data_enc) < 8 then
    return json_build_object('ok', false, 'error', 'dados vazios');
  end if;

  insert into public.space_snapshots (space_id, salt, iv, data_enc, version, item_count, updated_at)
  values (p_space_id, p_salt, p_iv, p_data_enc, 1, p_item_count, v_now)
  on conflict (space_id) do update
  set salt = excluded.salt,
      iv = excluded.iv,
      data_enc = excluded.data_enc,
      version = public.space_snapshots.version + 1,
      item_count = excluded.item_count,
      updated_at = v_now;

  return json_build_object('ok', true, 'updated_at', v_now);
end;
$$;

create or replace function public.space_get(p_space_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select * into v_row from public.space_snapshots where space_id = p_space_id;
  if v_row is null or v_row.space_id is null then
    return json_build_object('ok', true, 'exists', false);
  end if;
  return json_build_object(
    'ok', true, 'exists', true,
    'salt', v_row.salt,
    'iv', v_row.iv,
    'data_enc', v_row.data_enc,
    'version', v_row.version,
    'item_count', v_row.item_count,
    'updated_at', v_row.updated_at
  );
end;
$$;

-- acesso apenas via RPC — anon/authenticated não tocam a tabela
revoke all on table public.space_snapshots from anon, authenticated;
grant execute on function public.space_save(text, text, text, text, integer) to anon;
grant execute on function public.space_get(text) to anon;
