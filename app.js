-- ═══════════════════════════════════════════════════════════
--  VER LOS AMIGOS DE UN AMIGO — "Ya lo pisé"
--  Ejecutar ENTERO en el SQL Editor de Supabase.
--
--  Por qué hace falta: la política de seguridad de 'friendships'
--  solo te deja leer TUS propias amistades (correcto). Para poder
--  ver los amigos de OTRA persona (y solicitarles amistad) se usa
--  una función especial que salta esa restricción de forma
--  controlada: solo te deja ver los amigos de alguien si tú ya
--  eres su amigo. Eso es lo que crea este script.
-- ═══════════════════════════════════════════════════════════

-- ── 1. are_friends(): ¿son amigos aceptados estos dos? ──────
-- (La crea por si no existía; si ya existe, la reemplaza igual)
CREATE OR REPLACE FUNCTION public.are_friends(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.estado = 'aceptado'
      AND (
        (f.follower_id = a AND f.following_id = b) OR
        (f.follower_id = b AND f.following_id = a)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.are_friends(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated;

-- ── 2. friends_of(): los amigos de 'target' ─────────────────
-- Solo devuelve resultados si quien pregunta es amigo de 'target'.
CREATE OR REPLACE FUNCTION public.friends_of(target uuid)
RETURNS TABLE (id uuid, username text, avatar_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.are_friends(auth.uid(), target) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT p.id, p.username, p.avatar_url
    FROM public.friendships f
    JOIN public.profiles p
      ON p.id = CASE WHEN f.follower_id = target THEN f.following_id ELSE f.follower_id END
    WHERE f.estado = 'aceptado'
      AND (f.follower_id = target OR f.following_id = target)
      AND p.id <> target;
END;
$$;
REVOKE ALL ON FUNCTION public.friends_of(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.friends_of(uuid) TO authenticated;

-- ── 3. Comprobar que funciona ───────────────────────────────
-- Pon el id de un amigo tuyo en lugar de 'ID-DE-TU-AMIGO' y
-- ejecuta esto estando logueada; debería devolver sus amigos:
--   SELECT * FROM public.friends_of('ID-DE-TU-AMIGO');
--
-- Para encontrar el id de un usuario por su nombre:
--   SELECT id, username FROM public.profiles WHERE username = 'sunombre';
