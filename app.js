// ═══════════════════════════════════════════════════════════
//  SEGURIDAD + FIXES INTEGRADOS (antes en app.patch.js) prueba
// ═══════════════════════════════════════════════════════════
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function getInitials(name) {
  return esc((name || '?').split(' ').map(w => w[0] || '').join('').toUpperCase().substring(0, 2));
}

// Guardar nombre de usuario (el HTML llama a esta función)
async function guardarNombre() {
  const row = document.getElementById('u-edit-row');
  const v   = document.getElementById('u-inp').value.trim();
  row.style.display = 'none';
  row.setAttribute('data-open', '0');
  if (!v || !state?.user) return;
  if (v.length < 3 || !/^[a-zA-Z0-9_. -]+$/.test(v)) {
    toast('El nombre debe tener 3+ caracteres (letras, números, espacios, guiones)', 'info');
    return;
  }
  const { error } = await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  if (error) {
    toast(error.code === '23505' ? 'Ese nombre ya está en uso' : 'No se pudo guardar el nombre', 'error');
    return;
  }
  if (state.profile) state.profile.username = v;
  document.getElementById('u-name').textContent  = v;
  document.getElementById('av-init').textContent = v.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
}

// Filtros del feed (Descubriendo / Eventos / Rutas)
let feedFilter = 'descubriendo';
function setFeedFilter(filter) {
  feedFilter = filter;
  const isGlobalCache = state.feedCache?.mode === "global";
  document.querySelectorAll('.feed-filter-btn').forEach(b => {
    const active = b.dataset.filter === filter;
    b.style.backgroundColor = active ? '#2272e8' : 'rgba(255,255,255,0.08)';
    b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
  });
  if (filter === 'rutas') return void renderRutasFeed();
  if (filter === 'privado') return void renderPrivadoFeed();
  if (filter === 'global' && !isGlobalCache) return void loadGlobalFeed();
  if (filter !== 'global' && isGlobalCache) return void loadFeed(!0);
  if ((filter === 'descubriendo' || filter === 'eventos') && (state._feedMode === 'rutas' || state._feedMode === 'privado')) { return void loadFeed(); }
  applyFeedFilter();
}

// Pestaña "🔒 Privado": SOLO tus cosas guardadas en privado (nadie más las ve)
async function renderPrivadoFeed() {
  state._feedMode = 'privado';
  clearGlobalRanking();
  const sr = document.getElementById('stories-row');
  if (sr) { sr.innerHTML = ''; sr.style.display = 'none'; }
  const sent = document.getElementById('feed-sentinel');
  if (sent) sent.textContent = '';
  const fp = document.getElementById('feed-posts');
  if (!fp || !state.user) return;
  fp.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 8px"></div>Cargando privados...</div>';

  const pcols = 'id,user_id,municipio,storage_path,thumb_path,descripcion,rating,visibilidad,created_at,batch_id';
  let rp = await db.from('photos').select(pcols).eq('user_id', state.user.id).order('created_at', { ascending: !1 }).limit(200);
  if (rp.error && /rating|batch_id|thumb_path|column|schema cache/i.test(rp.error.message || '')) {
    rp = await db.from('photos').select('id,user_id,municipio,storage_path,descripcion,visibilidad,created_at').eq('user_id', state.user.id).order('created_at', { ascending: !1 }).limit(200);
  }
  if (feedFilter !== 'privado') return;
  const ph = (rp.data || []).filter(p => !['amigos', 'publico'].includes(p.visibilidad));

  const groups = {}, order = [];
  const keyOf = p => p.batch_id ? 'b:' + p.batch_id : 't:' + p.user_id + ':' + normalizeMuni(p.municipio) + ':' + String(p.created_at || '').slice(0, 16);
  ph.forEach(p => { const k = keyOf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
  const profById = {};
  if (state.profile) profById[state.user.id] = { id: state.user.id, username: state.profile.username, avatar_url: state.profile.avatar_url };
  const posts = order.map(k => {
    const g = groups[k].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const imgs = g.filter(x => x.storage_path && x.storage_path !== 'text_only');
    const rep = imgs[0] || g[0];
    const newest = g.reduce((m, x) => x.created_at > m ? x.created_at : m, g[0].created_at);
    return { id: 'pv_' + k, _batchKey: k, _batchId: rep.batch_id || null, user_id: rep.user_id, municipio: rep.municipio, visibilidad: rep.visibilidad, created_at: newest, profiles: profById[rep.user_id] || null, _fotos: imgs, _foto: rep };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (feedFilter !== 'privado') return;
  if (!posts.length) {
    fp.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6">🔒 No tienes nada en privado.<br>Al subir una foto, elige <b>🔒 Privado</b> y solo tú la verás (aquí).</div>';
    return;
  }
  await renderFeedPosts(posts, {}, {}, Object.values(profById), !1);
}

// Regenera miniaturas de las fotos de ruta antiguas (subidas sin thumb_path),
// para que se vean ligeras e iguales que en descubriendo.
async function backfillRutaThumbs(btn) {
  if (!state.user) return;
  if (btn) { btn.disabled = !0; btn.textContent = "Optimizando..."; }
  try {
    const { data } = await db.from("photos").select("id,storage_path,thumb_path,municipio")
      .eq("user_id", state.user.id).like("municipio", "🥾%").neq("storage_path", "text_only");
    const pend = (data || []).filter(p => !p.thumb_path && p.storage_path);
    if (!pend.length) { toast("Tus fotos de ruta ya están optimizadas ✅", "info"); return; }
    let done = 0;
    for (const p of pend) {
      try {
        const { data: sg } = await db.storage.from("evidencias").createSignedUrl(p.storage_path, 600);
        if (!sg?.signedUrl) continue;
        const blob = await (await fetch(sg.signedUrl)).blob();
        const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        const td = await dataUrlToThumb(dataUrl, 960, 0.78);
        if (!td) continue;
        const tb = await (await fetch(td)).blob();
        const tp = p.storage_path.replace(/\.(jpg|jpeg|png)$/i, "") + "_thumb.jpg";
        const { error: te } = await db.storage.from("evidencias").upload(tp, tb, { contentType: "image/jpeg", cacheControl: "3600", upsert: !0 });
        if (te) continue;
        await db.from("photos").update({ thumb_path: tp }).eq("id", p.id);
        done++;
        if (btn) btn.textContent = "Optimizando... " + done + "/" + pend.length;
      } catch (e) { console.error("backfill thumb:", e); }
    }
    try { _signedCache.clear(); } catch (_) {}
    state.feedCache = null;
    toast("Optimizadas " + done + " foto(s) de ruta 📸", "success");
    if (feedFilter === "rutas") renderRutasFeed();
  } catch (e) { toast("Error: " + (e.message || e), "error"); }
  finally { if (btn) { btn.disabled = !1; btn.textContent = "⚙️ Optimizar mis fotos de ruta antiguas"; } }
}

// Pestaña "🥾 Rutas" del feed: solo fotos de rutas (municipio "🥾 ...")
async function renderRutasFeed() {
  state._feedMode = 'rutas';
  clearGlobalRanking();
  const sr = document.getElementById('stories-row');
  if (sr) { sr.innerHTML = ''; sr.style.display = 'none'; }
  const sent = document.getElementById('feed-sentinel');
  if (sent) sent.textContent = '';
  const fp = document.getElementById('feed-posts');
  if (!fp) return;
  fp.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 8px"></div>Cargando rutas...</div>';

  // Rutas (de BD si hace falta) → conjunto de municipios con ruta
  let rutas = getRutas();
  if (!state.rutas || !state.rutas.length) {
    try { const { data } = await db.from('rutas').select('nombre,km,muni,url').order('km', { ascending: !1 }); if (data && data.length) { state.rutas = data; rutas = data; } } catch (_) {}
  }
  if (feedFilter !== 'rutas') return;
  const rutaMunis = new Set(rutas.map(r => normalizeMuni(r.muni)).filter(Boolean));

  // Autores (amigos + yo) y perfiles
  let authors, profiles;
  if (state.feedCache?.authors) { authors = state.feedCache.authors; profiles = state.feedCache.friendProfiles || []; }
  else {
    const { data: fs } = await db.from('friendships').select('follower_id,following_id').or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq('estado', 'aceptado');
    const fids = [...new Set((fs || []).map(f => f.follower_id === state.user.id ? f.following_id : f.follower_id))];
    authors = [...new Set([...fids, state.user.id])].filter(id => !state.blockedIds?.has(id));
    const { data: pr } = fids.length ? await db.from('profiles').select('id,username,avatar_url').in('id', fids) : { data: [] };
    profiles = pr || [];
  }
  const profById = {}; profiles.forEach(p => profById[p.id] = p);
  if (state.profile) profById[state.user.id] = { id: state.user.id, username: state.profile.username, avatar_url: state.profile.avatar_url };

  // Fotos/registros de RUTAS (municipio = "🥾 NombreRuta")
  const pcols = 'id,user_id,municipio,storage_path,thumb_path,descripcion,rating,visibilidad,created_at,batch_id';
  let rp = await db.from('photos').select(pcols).in('user_id', authors).like('municipio', '🥾%').order('created_at', { ascending: !1 }).limit(120);
  if (rp.error && /rating|batch_id|thumb_path|column|schema cache/i.test(rp.error.message || '')) {
    rp = await db.from('photos').select('id,user_id,municipio,storage_path,descripcion,visibilidad,created_at').in('user_id', authors).like('municipio', '🥾%').order('created_at', { ascending: !1 }).limit(120);
  }
  const visible = e => ['amigos', 'publico'].includes(e.visibilidad);
  const ph = (rp.data || []).filter(visible).filter(p => !state.blockedIds?.has(p.user_id));

  // Agrupar por lote de subida
  const groups = {}, order = [];
  const keyOf = p => p.batch_id
    ? 'b:' + p.batch_id
    : 't:' + p.user_id + ':' + normalizeMuni(p.municipio) + ':' + String(p.created_at || '').slice(0, 16);
  ph.forEach(p => { const k = keyOf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
  const posts = order.map(k => {
    const g = groups[k].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const imgs = g.filter(x => x.storage_path && x.storage_path !== 'text_only');
    const rep = imgs[0] || g[0];
    const newest = g.reduce((m, x) => x.created_at > m ? x.created_at : m, g[0].created_at);
    return { id: 'pb_' + k, _batchKey: k, _batchId: rep.batch_id || null, user_id: rep.user_id, municipio: rep.municipio, visibilidad: rep.visibilidad, created_at: newest, profiles: profById[rep.user_id] || null, _fotos: imgs, _foto: rep };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (feedFilter !== 'rutas') return;

  if (!posts.length) {
    fp.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6">🥾 Aún no hay fotos de rutas.<br>Sube una foto al conquistar un municipio con ruta y aparecerá aquí.</div>';
    return;
  }
  // Solo fotos, con el mismo formato del feed (carrusel, likes, comentarios)
  await renderFeedPosts(posts, {}, {}, profiles, !1);
  // Si tienes fotos de ruta antiguas sin miniatura, ofrece optimizarlas
  const myNoThumb = ph.some(p => p.user_id === state.user.id && !p.thumb_path && p.storage_path && p.storage_path !== 'text_only');
  if (myNoThumb && feedFilter === 'rutas') {
    document.getElementById('feed-posts')?.insertAdjacentHTML('afterbegin',
      '<div style="margin:0 12px 12px;padding:11px 13px;background:rgba(232,184,32,0.1);border:1px solid rgba(232,184,32,0.3);border-radius:12px;font-size:12px;color:#e8c98a">Algunas fotos de ruta antiguas no están optimizadas y pueden verse más pesadas.<br><button onclick="backfillRutaThumbs(this)" style="margin-top:8px;padding:8px 14px;background:#e8b820;color:#1a1a1a;border:none;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">⚙️ Optimizar mis fotos de ruta antiguas</button></div>');
  }
}

function applyFeedFilter() {
  if (feedFilter === 'rutas') return; // la pestaña de rutas se pinta aparte
  const posts = document.querySelectorAll('.feed-post');
  if (feedFilter === 'global') {
    posts.forEach(p => p.style.display = '');
    const em = document.querySelector('.feed-empty-msg');
    if (em) em.style.display = 'none';
    return;
  }
  let visibles = 0;
  posts.forEach(post => {
    const locEl  = post.querySelector('.post-location');
    const muniEl = post.querySelector('.post-muni');
    const muni   = (locEl?.textContent || muniEl?.textContent || '').trim();
    const isEvento = muni.includes('🎉');
    let show = true;
    if (feedFilter === 'descubriendo') show = !isEvento;
    else if (feedFilter === 'eventos')  show = isEvento;
    post.style.display = show ? '' : 'none';
    if (show) visibles++;
  });
  const feedPosts = document.getElementById('feed-posts');
  let emptyMsg = feedPosts?.querySelector('.feed-empty-msg');
  if (!visibles && feedPosts && posts.length) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'feed-empty-msg';
      emptyMsg.style.cssText = 'text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px';
      feedPosts.appendChild(emptyMsg);
    }
    emptyMsg.textContent = feedFilter === 'eventos' ? '🎉 Aún no hay fotos de eventos' : '';
    emptyMsg.style.display = 'block';
  } else if (emptyMsg) emptyMsg.style.display = 'none';
}

// Tocar una @mención: abrir perfil o enviar solicitud
async function openMentionProfile(username) {
  if (!state?.user || !username) return;
  const { data: profile } = await db.from('profiles')
    .select('id, username, avatar_url').ilike('username', username).single();
  if (!profile) { toast('@' + username + ' no encontrado', 'error'); return; }
  if (profile.id === state.user.id) return;
  const { data: fs } = await db.from('friendships').select('estado')
    .or('and(follower_id.eq.' + state.user.id + ',following_id.eq.' + profile.id + '),' +
        'and(follower_id.eq.' + profile.id + ',following_id.eq.' + state.user.id + ')')
    .limit(1);
  const rel = fs?.[0];
  if (rel?.estado === 'aceptado') openFriendProfile(profile.id, profile.username);
  else if (rel?.estado === 'pendiente') toast('Ya tienes una solicitud pendiente con @' + profile.username, 'info');
  else if (await confirmar('¿Enviar solicitud de amistad a @' + profile.username + '?', { titulo: 'Solicitud de amistad', ok: 'Enviar' })) {
    await db.from('friendships').insert({ follower_id: state.user.id, following_id: profile.id, estado: 'pendiente' });
    toast('Solicitud enviada a @' + profile.username, 'success');
  }
}
// Compresión de imágenes antes de subir (3-8MB → 150-400KB).
// createImageBitmap con imageOrientation:'from-image' aplica la orientación
// EXIF UNA sola vez (igual que un <img>): la foto de la cámara sale derecha
// y las de galería, que ya están bien, NO se rotan de más.
async function compressImage(file, maxDim = 1600, quality = 0.82) {
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
  if (!bmp) {
    // Sin createImageBitmap: devolvemos el original sin tocar.
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = () => res(null); r.readAsDataURL(file); });
    return { base64: dataUrl, mime: file.type || 'image/jpeg', compressed: false };
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const out = canvas.toDataURL('image/jpeg', quality);
  return { base64: out, mime: 'image/jpeg', compressed: true };
}

// Genera una miniatura (~480px) a partir de un dataURL ya existente.
// Se usa para subir un "thumb" ligero que alimenta el feed y la galería.
async function dataUrlToThumb(dataUrl, maxDim = 960, quality = 0.78) {
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl;
    });
    if (!img.width) return null;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } catch (e) { return null; }
}

// Caché en memoria de URLs firmadas del bucket "evidencias".
// Evita volver a firmar la misma ruta una y otra vez en cada re-render
// (la firma vale 1 h; la cacheamos ~55 min para ir sobre seguro).
const _signedCache = new Map(); // path -> { url, exp }
async function signPaths(paths) {
  const out = {};
  const now = Date.now();
  const need = [];
  for (const p of [...new Set((paths || []).filter(p => p && p !== 'text_only'))]) {
    const c = _signedCache.get(p);
    if (c && c.exp > now) out[p] = c.url;
    else need.push(p);
  }
  // Firmamos en bloques de 100 (límite por llamada) para no perder fotos
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    try {
      const { data, error } = await db.storage.from('evidencias').createSignedUrls(chunk, 3600);
      if (error) { console.warn('signPaths chunk:', error); continue; }
      (data || []).forEach(s => {
        if (s.signedUrl && s.path) { out[s.path] = s.signedUrl; _signedCache.set(s.path, { url: s.signedUrl, exp: now + 3300e3 }); }
      });
    } catch (e) { console.warn('signPaths:', e); }
  }
  return out;
}

// Zoom del mapa: volar hasta un municipio / resetear
function zoomToMuni(muni) {
  if (!state.mapZoom || !state.mapDims) return;
  const sel = (window.CSS && CSS.escape) ? CSS.escape(muni) : muni;
  const node = document.querySelector('.muni-path[data-name="' + sel + '"]');
  if (!node) return;
  const b = node.getBBox();
  const { W, H } = state.mapDims;
  // Un poco más de aire alrededor del municipio (antes 0.5) para que la
  // "vista de detalle" no quede tan pegada al borde.
  const scale = Math.min(8, Math.max(2, 0.62 / Math.max(b.width / W, b.height / H)));
  const tx = W / 2 - scale * (b.x + b.width / 2);
  const ty = H / 2 - scale * (b.y + b.height / 2);
  d3.select('#map-svg').transition().duration(750).ease(d3.easeCubicOut)
    .call(state.mapZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}
function resetMapZoom() {
  if (!state.mapZoom) return;
  d3.select('#map-svg').transition().duration(500)
    .call(state.mapZoom.transform, d3.zoomIdentity);
}

// ── "Modo detalle" de un municipio: agranda + apaga el resto del mapa ──
// (foco/spotlight) + tarjeta flotante con la info, y permite desagrandar
// tocando la X, el propio municipio otra vez, o el mar de alrededor.
function spotlightMuni(name) {
  d3.selectAll('.muni-path')
    .transition().duration(300)
    .style('opacity', function() { return d3.select(this).attr('data-name') === name ? 1 : 0.25; })
    .style('filter', function() { return d3.select(this).attr('data-name') === name ? 'url(#glow-select)' : 'saturate(0.35)'; });
}
function clearMuniSpotlight() {
  d3.selectAll('.muni-path')
    .transition().duration(300)
    .style('opacity', 1)
    .style('filter', null);
}
function selectMuniOnMap(name) {
  if (!name) return;
  // Si ya está agrandado este mismo municipio, un segundo toque lo desagranda
  if (state.mapZoomedMuni === name) { unzoomMuni(); return; }
  d3.selectAll('.muni-path').classed('selected', false);
  const sel = (window.CSS && CSS.escape) ? CSS.escape(name) : name;
  d3.select('.muni-path[data-name="' + sel + '"]').classed('selected', true);
  state.selectedMuni = name;
  state.mapZoomedMuni = name;
  spotlightMuni(name);
  zoomToMuni(name);
  showMuniBar(name);
  showMuniZoomCard(name);
  const rb = document.getElementById('map-reset-zoom');
  if (rb) rb.style.display = 'flex';
}
function unzoomMuni() {
  state.mapZoomedMuni = null;
  clearMuniSpotlight();
  resetMapZoom();
  hideMuniZoomCard();
}
// ⛔ Mini-mapa del municipio: DESACTIVADO temporalmente.
//    Para volver a activarlo, pon esta constante a true. No hay nada más que tocar:
//    el código del mini-mapa (getMuniMapaData / buildMuniDetailSvg / renderMuniZoomMapPreview)
//    sigue intacto más abajo.
const MUNI_MINIMAPA_ACTIVO = false;

// Tarjeta flotante con la ficha rápida del municipio agrandado
function showMuniZoomCard(name) {
  const mc = document.getElementById('map-cont');
  if (!mc) return;
  let card = document.getElementById('muni-zoom-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'muni-zoom-card';
    card.style.cssText = 'position:absolute;left:10px;right:10px;top:10px;z-index:5;'
      + 'background:rgba(10,16,24,0.86);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);'
      + 'border-radius:16px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;'
      + 'box-shadow:0 10px 26px rgba(0,0,0,0.35);opacity:0;transform:translateY(-8px);transition:opacity .25s ease,transform .25s ease';
    mc.appendChild(card);
  }
  const t = (state.municipiosData && state.municipiosData[name]) || { tipo: isCoast(name) ? 'costa' : 'montaña' };
  const i = t.tipo === 'costa';
  const visited = !!state.visited[name];
  const pills = [];
  if (t.comarca) pills.push('Comarca de ' + esc(t.comarca));
  if (t.poblacion) pills.push(t.poblacion.toLocaleString('es-ES') + ' hab.');
  if (t.area_km2) pills.push(t.area_km2 + ' km²');
  card.innerHTML =
    '<div style="flex:1;min-width:0">'
      + (MUNI_MINIMAPA_ACTIVO ? '<div id="muni-zoom-map" style="display:none;margin-bottom:10px"></div>' : '')
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="font-family:\'Playfair Display\',serif;font-weight:700;font-size:16px;color:#fff">' + esc(name) + '</span>'
        + '<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;background:' + (i ? 'rgba(56,138,221,0.25);color:#85B7EB' : 'rgba(29,158,117,0.25);color:#5DCAA5') + '">' + (i ? '🌊 Costa' : '⛰️ Montaña') + '</span>'
        + (visited ? '<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(34,176,80,0.2);color:#22b050">✓ Conquistado</span>' : '')
      + '</div>'
      + (pills.length ? '<div style="margin-top:5px;font-size:12px;color:rgba(255,255,255,0.55)">' + pills.join(' · ') + '</div>' : '')
      + '<div style="display:flex;gap:8px;margin-top:10px">'
        + '<button onclick="closeMuniZoomCard_openFicha()" style="padding:7px 13px;background:#22b050;color:#fff;border:none;border-radius:999px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Ver ficha completa</button>'
      + '</div>'
    + '</div>'
    + '<button onclick="unzoomMuni()" aria-label="Desagrandar municipio" style="flex-shrink:0;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.08);border:none;color:#fff;cursor:pointer;font-size:15px;line-height:1">✕</button>';
  requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; });
  if (MUNI_MINIMAPA_ACTIVO) renderMuniZoomMapPreview(name);
}
function hideMuniZoomCard() {
  const card = document.getElementById('muni-zoom-card');
  if (!card) return;
  card.style.opacity = '0'; card.style.transform = 'translateY(-8px)';
  setTimeout(() => { card && card.remove && card.style.opacity === '0' && card.remove(); }, 260);
}
function closeMuniZoomCard_openFicha() {
  const name = state.mapZoomedMuni || state.selectedMuni;
  if (name) openMuniModal(name);
}

// ── Mapa "bonito" real (calles/agua/verde de OSM) por municipio ──
// Los datos vienen precalculados en la tabla muni_mapas (ver
// fetch_muni_mapas.mjs); aquí solo se leen, se cachean en memoria y se
// pintan recortados con la silueta real del municipio.
// (el caché de mapas bonitos por municipio se inicializa de forma
// perezosa dentro de getMuniMapaData, ver abajo — así no se accede a
// `state` antes de que exista, ya que `state` se declara más abajo)
async function getMuniMapaData(name) {
  if (!state.muniMapasCache) state.muniMapasCache = {};
  if (Object.prototype.hasOwnProperty.call(state.muniMapasCache, name)) return state.muniMapasCache[name];
  try {
    const { data, error } = await db.from('muni_mapas').select('geojson').eq('municipio', name).maybeSingle();
    if (error) throw error;
    state.muniMapasCache[name] = data ? data.geojson : null;
  } catch (e) {
    console.warn('getMuniMapaData:', e);
    state.muniMapasCache[name] = null;
  }
  return state.muniMapasCache[name];
}
const POI_ICONOS = {
  museo: '🏛️', mirador: '🌄', monumento: '🏰',
  cafeteria: '☕', restaurante: '🍽️', bar: '🍷', iglesia: '⛪'
};
function buildMuniDetailSvg(name, geojson, recos) {
  const feature = state.muniFeatures && state.muniFeatures[name];
  if (!feature) return '';
  const W = 320, H = 180, pad = 6;
  const proj = d3.geoMercator().fitExtent([[pad, pad], [W - pad, H - pad]], feature);
  const path = d3.geoPath(proj);
  const clipId = 'clip-muni-' + name.replace(/[^a-zA-Z0-9]/g, '');
  const boundaryD = path(feature);
  let roads = '', water = '', green = '', pois = '';
  ((geojson && geojson.features) || []).forEach(f => {
    if (f.properties.layer === 'poi') {
      const xy = proj(f.geometry.coordinates);
      if (!xy) return;
      const icon = POI_ICONOS[f.properties.categoria] || '📍';
      pois += '<g transform="translate(' + xy[0] + ',' + xy[1] + ')">'
        + '<circle r="6.5" fill="rgba(10,16,24,0.72)" stroke="rgba(255,255,255,0.45)" stroke-width="0.6"/>'
        + '<text text-anchor="middle" dominant-baseline="central" font-size="7.5" y="0.5">' + icon + '</text></g>';
      return;
    }
    const d = path(f);
    if (!d) return;
    if (f.properties.layer === 'road') {
      const w = ['motorway', 'trunk', 'primary'].includes(f.properties.highway) ? 1.3 : 0.65;
      roads += '<path d="' + d + '" fill="none" stroke="#f3ead9" stroke-width="' + w + '" stroke-linecap="round" opacity="0.9"/>';
    } else if (f.properties.layer === 'water') {
      if (f.geometry.type === 'Polygon') {
        water += '<path d="' + d + '" fill="#4d87bf" stroke="#3a6fa3" stroke-width="0.4" opacity="0.9"/>';
      } else {
        // Ríos/arroyos: son líneas, no áreas — nunca rellenar (si no, el
        // navegador "cierra" el trazo solo y pinta manchas azules falsas)
        water += '<path d="' + d + '" fill="none" stroke="#4d87bf" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>';
      }
    } else if (f.properties.layer === 'green') {
      if (f.geometry.type === 'Polygon') {
        green += '<path d="' + d + '" fill="#1d7a4a" opacity="0.35"/>';
      }
      // (si llegara como línea sin cerrar, se ignora: no hay un "borde de
      // bosque" fiable que dibujar sin relleno, mejor omitirlo que inventarlo)
    }
  });
  // Recomendaciones (tuyas / de amigos, con GPS) — pin dorado destacado,
  // por encima de todo lo demás para que se note que son "tus sitios"
  let recosSvg = '';
  (recos || []).forEach(r => {
    if (r.lat == null || r.lng == null) return;
    const xy = proj([r.lng, r.lat]);
    if (!xy) return;
    const icon = r.tipo === 'comida' ? '🍽️' : '📍';
    recosSvg += '<g transform="translate(' + xy[0] + ',' + (xy[1] - 8) + ')">'
      + '<path d="M0,16 C0,16 -7,7.5 -7,2 A7,7 0 1,1 7,2 C7,7.5 0,16 0,16 Z" fill="#e8c93a" stroke="#0f1923" stroke-width="0.7"/>'
      + '<circle r="3.3" cy="1" fill="#0f1923"/>'
      + '<text text-anchor="middle" y="4.5" font-size="6.5">' + icon + '</text></g>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;border-radius:12px;background:#0d1622">'
    + '<defs><clipPath id="' + clipId + '"><path d="' + boundaryD + '"/></clipPath>'
    + '<linearGradient id="grass-' + clipId + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#3fae6e"/><stop offset="100%" stop-color="#227f4c"/></linearGradient></defs>'
    + '<g clip-path="url(#' + clipId + ')"><path d="' + boundaryD + '" fill="url(#grass-' + clipId + ')"/>' + green + water + roads + pois + '</g>'
    + '<path d="' + boundaryD + '" fill="none" stroke="#0f1923" stroke-width="1.6"/>'
    + '<g clip-path="url(#' + clipId + ')">' + recosSvg + '</g>'
    + '<g transform="translate(' + (W - 22) + ',22)" opacity="0.75">'
    + '<circle r="11" fill="rgba(10,16,24,0.5)" stroke="rgba(255,255,255,0.4)" stroke-width="0.6"/>'
    + '<path d="M0,-8 L2.4,0 L0,8 L-2.4,0 Z" fill="#e8c93a"/>'
    + '<text y="-13" text-anchor="middle" font-size="6" fill="#fff" font-family="Inter,sans-serif">N</text></g></svg>';
}
async function getRecosConGps(name) {
  if (!state.user) return [];
  try {
    const { data: fs } = await db.from("friendships").select("follower_id, following_id")
      .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado");
    const fids = (fs || []).map(f => f.follower_id === state.user.id ? f.following_id : f.follower_id);
    const ids = [...new Set([...fids, state.user.id])];
    const { data } = await db.from("recomendaciones").select("nombre,tipo,lat,lng")
      .eq("municipio", name).in("user_id", ids).not("lat", "is", null).not("lng", "is", null);
    return data || [];
  } catch (e) {
    console.warn("getRecosConGps:", e);
    return [];
  }
}
async function renderMuniZoomMapPreview(name) {
  if (!MUNI_MINIMAPA_ACTIVO) return;   // ⛔ desactivado: ni pinta ni consulta muni_mapas
  const holder = document.getElementById('muni-zoom-map');
  if (!holder) return;
  const [geojson, recos] = await Promise.all([getMuniMapaData(name), getRecosConGps(name)]);
  // Si mientras cargaba el usuario cambió de municipio o cerró la tarjeta, no pintar
  if (state.mapZoomedMuni !== name || !document.getElementById('muni-zoom-map')) return;
  if (!geojson && !recos.length) { holder.style.display = 'none'; return; }
  holder.innerHTML = buildMuniDetailSvg(name, geojson, recos);
  holder.style.display = 'block';
}

const SUPABASE_URL = "https://sdsdbfjmpjbrcgrbyvkm.supabase.co",
    SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkc2RiZmptcGpicmNncmJ5dmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzQxMzksImV4cCI6MjA5MzkxMDEzOX0.EgNnrghpj9XbFUt0N-NlTIhH4GxcHOaen33RXAYMNcA",
    {
        createClient: createClient
    } = supabase,
    db = createClient(SUPABASE_URL, SUPABASE_ANON),
    state = {
        user: null,
        profile: null,
        visited: {},
        photos: [],
        totalMuni: 103,
        coast: [],
        mountain: [],
        rolling: !1,
        selectedMuni: null,
        eventos: [],
        inscripciones: {},
        feedPosts: [],
        pendingPhotos: []
    },
    NAV_ITEMS = [{
        id: "map",
        icon: "ti-map-2",
        label: "Mapa",
        bg: "#1a7a3e",
        fg: "#b8f5d0",
        abg: "#22b050",
        afg: "#ffffff"
    }, {
        id: "eventos",
        icon: "ti-confetti",
        label: "Eventos",
        bg: "#aa1060",
        fg: "#ffc0e0",
        abg: "#e8288a",
        afg: "#ffffff"
    }, {
        id: "dado",
        icon: "ti-dice",
        label: "Destino",
        bg: "#a07810",
        fg: "#fff0b0",
        abg: "#e8b820",
        afg: "#ffffff"
    }, {
        id: "feed",
        icon: "ti-users",
        label: "Amigos",
        bg: "#1848a8",
        fg: "#b0d4ff",
        abg: "#2272e8",
        afg: "#ffffff"
    }, {
        id: "profile",
        icon: "ti-user-circle",
        label: "Perfil",
        bg: "#a04010",
        fg: "#ffd0a0",
        abg: "#e86820",
        afg: "#ffffff"
    }];

function buildNavs() {
    ["map", "eventos", "dado", "feed", "profile"].forEach(e => {
        const t = document.getElementById("nav-" + e);
        t && (t.innerHTML = NAV_ITEMS.map(t => {
            const i = t.id === e,
                n = i ? t.abg : t.bg,
                o = i ? t.afg : t.fg;
            return `<button\n        onclick="switchScreen('${t.id}')"\n        id="nb-${e}-${t.id}"\n        aria-label="${t.label}"\n        style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 8px;border:none;border-radius:14px;font-size:9px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;background-color:${n};color:${o};">\n        <i class="ti ${t.icon}" style="font-size:20px;color:inherit" aria-hidden="true"></i>\n        <span>${t.label}</span>\n      </button>`
        }).join(""))
    })
}

function updateNavColors(e) {
    ["map", "eventos", "dado", "feed", "profile"].forEach(t => {
        NAV_ITEMS.forEach(i => {
            const n = document.getElementById(`nb-${t}-${i.id}`);
            if (!n) return;
            const o = i.id === e;
            n.style.backgroundColor = o ? i.abg : i.bg, n.style.color = o ? i.afg : i.fg
        })
    })
}

function showAuth(e = "") {
    if (document.getElementById("splash")?.remove(), document.getElementById("app").style.display = "none", document.getElementById("auth-screen").style.display = "flex", e) {
        const t = document.getElementById("auth-msg");
        t.textContent = e, t.style.display = "block"
    }
}

function showApp() {
    document.getElementById("splash")?.remove(), document.getElementById("auth-screen").style.display = "none", document.getElementById("app").style.display = "flex"
}
let authMode = null; // null = elegir, 'login', 'register'
function setAuthMode(mode) {
    authMode = mode;
    const choice = document.getElementById("auth-choice"),
        form = document.getElementById("auth-form"),
        user = document.getElementById("auth-username"),
        forgot = document.getElementById("auth-forgot"),
        submit = document.getElementById("btn-auth-submit"),
        msg = document.getElementById("auth-msg");
    if (msg) msg.style.display = "none";
    if (!mode) {
        if (choice) choice.style.display = "block";
        if (form) form.style.display = "none";
        return;
    }
    if (choice) choice.style.display = "none";
    if (form) form.style.display = "block";
    if (mode === "register") {
        if (user) user.style.display = "block";
        if (forgot) forgot.style.display = "none";
        if (submit) submit.textContent = "Crear cuenta";
    } else {
        if (user) user.style.display = "none";
        if (forgot) forgot.style.display = "block";
        if (submit) submit.textContent = "Iniciar sesión";
    }
    const em = document.getElementById("auth-email"), pa = document.getElementById("auth-pass");
    if (em) em.value = ""; if (pa) pa.value = ""; if (user) user.value = "";
}

function submitAuth() {
    if (authMode === "register") doRegister();
    else doLogin();
}

async function doForgotPassword() {
    const email = document.getElementById("auth-email").value.trim();
    const msg = document.getElementById("auth-msg");
    if (!email) {
        msg.style.color = "#e8288a";
        msg.textContent = "Escribe tu email arriba y vuelve a pulsar aquí";
        msg.style.display = "block";
        return;
    }
    setAuthLoading(!0);
    const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
    });
    setAuthLoading(!1);
    msg.style.color = error ? "#e8288a" : "#5DCAA5";
    msg.textContent = error
        ? "No se pudo enviar. Revisa el email."
        : "📧 Te hemos enviado un correo para restablecer tu contraseña. Revisa tu bandeja (y spam).";
    msg.style.display = "block";
}

async function doLogin() {
    const e = document.getElementById("auth-email").value.trim(),
        t = document.getElementById("auth-pass").value,
        i = document.getElementById("auth-msg");
    if (!e || !t) return i.textContent = "Rellena email y contraseña", void(i.style.display = "block");
    setAuthLoading(!0);
    const {
        error: n
    } = await db.auth.signInWithPassword({
        email: e,
        password: t
    });
    setAuthLoading(!1), n && (i.textContent = "Email o contraseña incorrectos", i.style.display = "block")
}
async function doRegister() {
    const e = document.getElementById("auth-email").value.trim(),
        t = document.getElementById("auth-pass").value,
        i = document.getElementById("auth-username").value.trim(),
        n = document.getElementById("auth-msg");
    if (n.style.color = "#e8288a", !e || !t || !i) return n.textContent = "Rellena todos los campos", void(n.style.display = "block");
    if (t.length < 6) return n.textContent = "La contraseña debe tener al menos 6 caracteres", void(n.style.display = "block");
    if (i.length < 3) return n.textContent = "El nombre de usuario debe tener al menos 3 caracteres", void(n.style.display = "block");
    if (!/^[a-zA-Z0-9_.-]+$/.test(i)) return n.textContent = "El nombre solo puede tener letras, números, guiones y puntos", void(n.style.display = "block");
    setAuthLoading(!0);
    const {
        data: o
    } = await db.from("profiles").select("username").ilike("username", i).limit(1);
    if (o && o.length > 0) return n.textContent = "Ese nombre de usuario ya está en uso, elige otro", n.style.display = "block", void setAuthLoading(!1);
    const {
        error: a
    } = await db.auth.signUp({
        email: e,
        password: t,
        options: {
            data: {
                username: i
            }
        }
    });
    setAuthLoading(!1), a ? (a.message.includes("already registered") ? n.textContent = "Ese email ya tiene una cuenta. Inicia sesión." : n.textContent = a.message, n.style.display = "block") : (n.style.color = "#22b050", n.textContent = "¡Cuenta creada! Revisa tu email para confirmar.", n.style.display = "block")
}

function setAuthLoading(e) {
    const b = document.getElementById("btn-auth-submit");
    if (b) b.disabled = e;
}

// ═══ ¿DE DÓNDE ERES? — bienvenida de origen ══════════════════
// Saca los municipios de lo que ya tiene cargado la app,
// para que los nombres coincidan EXACTOS con el resto.
function getMunicipiosList() {
  let munis = [];
  const paths = document.querySelectorAll('.muni-path');
  if (paths.length) munis = [...paths].map(p => p.getAttribute('data-name')).filter(Boolean);
  if (!munis.length && window.state?.municipiosData) munis = Object.keys(state.municipiosData);
  if (!munis.length && window.state?.muniFeatures) munis = Object.keys(state.muniFeatures);
  return [...new Set(munis)].sort((a, b) => a.localeCompare(b, 'es'));
}

function showWelcomeOrigen(tries = 0) {
  if (document.getElementById('origen-modal')) return;
  const munis = getMunicipiosList();
  // Si el mapa aún no se ha dibujado, reintenta un momento
  if (!munis.length && tries < 8) { setTimeout(() => showWelcomeOrigen(tries + 1), 500); return; }

  const opciones = munis.map(m => '<option value="' + esc(m) + '"></option>').join('');
  const ov = document.createElement('div');
  ov.id = 'origen-modal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(6,12,20,0.82);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:22px;font-family:Inter,sans-serif';
  ov.innerHTML =
    '<div style="width:100%;max-width:360px;background:#141e2c;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">'
    + '<div style="font-size:34px;text-align:center;margin-bottom:6px">🏔️</div>'
    + '<div style="font-family:Georgia,serif;font-style:italic;font-size:23px;color:#fff;text-align:center;margin-bottom:6px">¿De dónde eres?</div>'
    + '<div style="font-size:13px;color:rgba(255,255,255,0.55);text-align:center;line-height:1.5;margin-bottom:18px">Esto es turismo interno: hecho por y para cántabros.<br>Dinos tu pueblo (aunque vivas fuera 😉).</div>'
    + '<input id="origen-inp" list="origen-list" autocomplete="off" placeholder="Escribe tu municipio…" style="width:100%;box-sizing:border-box;padding:13px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-size:15px;font-family:Inter,sans-serif;outline:none"/>'
    + '<datalist id="origen-list">' + opciones + '</datalist>'
    + '<div id="origen-err" style="display:none;color:#e8288a;font-size:12px;margin-top:8px"></div>'
    + '<button id="origen-ok" style="width:100%;margin-top:16px;padding:14px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">Empezar a conquistar</button>'
    + '<button id="origen-fuera" style="width:100%;margin-top:10px;padding:11px;background:none;border:none;color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer;font-family:Inter,sans-serif;text-decoration:underline">No soy de Cantabria</button>'
    + '</div>';
  document.body.appendChild(ov);

  document.getElementById('origen-ok').onclick = () => {
    const val = document.getElementById('origen-inp').value.trim();
    const err = document.getElementById('origen-err');
    if (!val) { err.textContent = 'Escribe tu municipio o pulsa «No soy de Cantabria».'; err.style.display = 'block'; return; }
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = munis.find(m => norm(m) === norm(val)); // acepta aunque no ponga tildes
    if (!match) { err.textContent = 'No encontramos ese municipio. Elígelo de la lista.'; err.style.display = 'block'; return; }
    saveOrigen(match);
  };
  document.getElementById('origen-fuera').onclick = showFueraMessage;
}

// Mensajito con cariño para los de fuera (sin bloquear)
function showFueraMessage() {
  const ov = document.getElementById('origen-modal');
  if (!ov) return;
  ov.firstChild.innerHTML =
    '<div style="font-size:34px;text-align:center;margin-bottom:8px">💚</div>'
    + '<div style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#fff;text-align:center;margin-bottom:12px">Esto es cosa de cántabros</div>'
    + '<div style="font-size:14px;color:rgba(255,255,255,0.7);text-align:center;line-height:1.6;margin-bottom:20px">«Ya lo pisé» es turismo interno, hecho por y para gente de aquí. Puedes curiosear y usarla, pero está pensada para los cántabros y para descubrir lo nuestro. ¡Bienvenida/o igual! 🙂</div>'
    + '<button id="origen-entrar" style="width:100%;padding:14px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">Entrar a curiosear</button>';
  document.getElementById('origen-entrar').onclick = () => saveOrigen('fuera');
}

async function saveOrigen(origen) {
  const ov = document.getElementById('origen-modal');
  try {
    if (state?.user) {
      await db.from('profiles').update({ origen }).eq('id', state.user.id);
      if (state.profile) state.profile.origen = origen;
    }
  } catch (e) { console.warn('saveOrigen:', e); }
  if (ov) ov.remove();
  if (origen !== 'fuera' && typeof toast === 'function') toast('¡Bienvenida/o a Ya lo pisé! 🥾', 'success');
}

async function doLogout() {
    await db.auth.signOut(), state.user = null, state.profile = null, state.visited = {}, state.photos = [], showAuth()
}
async function loadUserData(e) {
    state.user = e;
    const _offKey = () => "ylp_offline_" + (state.user?.id || "anon");
    const persistOffline = () => {
        try {
            localStorage.setItem(_offKey(), JSON.stringify({
                visited: state.visited || {}, visitDates: state.visitDates || {},
                visitedLocs: state.visitedLocs || {}, ts: Date.now()
            }));
        } catch (_) {}
    };
    const hydrateOffline = () => {
        try {
            const raw = localStorage.getItem(_offKey());
            if (!raw) return;
            const s = JSON.parse(raw);
            if (s.visited && !Object.keys(state.visited || {}).length) {
                state.visited = s.visited; state.visitDates = s.visitDates || {};
                state.visitedLocs = s.visitedLocs || {};
                refreshMapVisited(); updateProgress();
                toast("Sin conexión: mostrando tus datos guardados", "info");
            }
        } catch (_) {}
    };
    try {
    const [t, i, n, o] = await Promise.all([db.from("profiles").select("*").eq("id", e.id).single(), db.from("visits").select("*").eq("user_id", e.id), db.from("photos").select("*").eq("user_id", e.id).order("created_at", {
        ascending: !1
    }), db.from("event_signups").select("event_id").eq("user_id", e.id)]), a = t.data;
    if (state.profile = a, a && (document.getElementById("u-name").textContent = a.username, document.getElementById("av-init").textContent = a.username.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2), a.avatar_url)) {
        const e = document.getElementById("av-ring"),
            t = a.avatar_url;
        e.innerHTML = '<img src="' + t + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>'
    }
    if (a && !a.origen) setTimeout(showWelcomeOrigen, 500);
    state.visitedLocs = state.visitedLocs || {};
    state.visitDates = state.visitDates || {};
    i.data && (i.data.forEach(e => {
        state.visited[e.municipio] = !0;
        if (e.fecha) state.visitDates[e.municipio] = e.fecha;
        if (e.localidades) state.visitedLocs[e.municipio] = e.localidades;
    }), refreshMapVisited());
    if (n.data) {
        state.photos = n.data.map(e => ({
            id: e.id, src: null, muni: e.municipio, date: e.fecha,
            time: e.hora || "", coords: e.coords || "", desc: e.descripcion || "",
            vis: e.visibilidad, path: e.storage_path, thumb: e.thumb_path || null
        }));
        // Ya NO firmamos aquí todas las fotos (podían ser cientos y bloqueaba el
        // arranque). Se firman bajo demanda al abrir la galería (renderGallery).
    }
    try {
        const { data: bl } = await db.from("blocks").select("blocked_id").eq("blocker_id", state.user.id);
        state.blockedIds = new Set((bl || []).map(b => b.blocked_id));
    } catch (err) { state.blockedIds = new Set(); }
    await loadWishlist();
    o.data && o.data.forEach(e => {
        state.inscripciones[e.event_id] = !0
    }), updateProgress(), subscribeToFriendActivity(), loadNotifBadge();
    persistOffline();
    } catch (err) {
        console.error("loadUserData no bloqueante:", err);
        state.wishlist = state.wishlist || new Set();
        state.blockedIds = state.blockedIds || new Set();
        hydrateOffline();
    }
}

function switchScreen(e) {
    document.querySelectorAll(".screen").forEach(e => e.classList.remove("active")), document.getElementById("screen-" + e).classList.add("active"), updateNavColors(e), "profile" === e && renderProfile(), "feed" === e && (clearFeedBadge(), loadFeed()), "eventos" === e && loadEventos(), "dado" === e && renderMuniList(), "map" === e && (typeof showMyLocationOnMap === "function") && showMyLocationOnMap()
}

function _normSearch(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function searchMuniOnMap(e) {
    const t = document.getElementById("map-search-results");
    if (!e || e.length < 2) { t.style.display = "none"; d3.selectAll(".muni-path").classed("selected", !1); return; }
    const q = _normSearch(e);
    const munis = [];
    d3.selectAll(".muni-path").each(function() { const n = d3.select(this).attr("data-name"); if (n) munis.push(n); });
    const results = [], seenMuni = new Set();
    // 1) Municipios por nombre
    munis.forEach(m => { if (_normSearch(m).includes(q)) { results.push({ label: m, muni: m, loc: null }); seenMuni.add(m); } });
    // 2) Localidades → llevan a su municipio
    munis.forEach(m => {
        const raw = state.municipiosData?.[m]?.localidades;
        if (!raw) return;
        const locs = Array.isArray(raw) ? raw : String(raw).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
        locs.forEach(loc => {
            if (_normSearch(loc).includes(q) && _normSearch(loc) !== _normSearch(m)) {
                results.push({ label: loc, muni: m, loc });
            }
        });
    });
    const list = results.slice(0, 12);
    if (!list.length) { t.style.display = "none"; return; }
    t.style.display = "block";
    t.innerHTML = list.map(r => {
        const visited = state.visited[r.muni];
        const sub = r.loc ? '<span style="font-size:10px;color:rgba(255,255,255,0.4)"> · en ' + esc(r.muni) + '</span>' : '';
        const badge = visited
            ? '<span style="font-size:10px;color:#22b050;background:rgba(34,176,80,0.15);padding:2px 8px;border-radius:999px;flex-shrink:0">✓ Conquistado</span>'
            : '<span style="font-size:10px;color:rgba(255,255,255,0.3);flex-shrink:0">Sin visitar</span>';
        return '<div data-muni="' + esc(r.muni) + '" onclick="selectMuniFromSearch(this.dataset.muni)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:#fff"><span>' + (r.loc ? '📍 ' : '') + esc(r.label) + sub + '</span>' + badge + '</div>';
    }).join("");
}

function selectMuniFromSearch(e) {
    document.getElementById("map-search-results").style.display = "none", document.getElementById("map-search-input").value = "", highlightMuniOnMap(e), document.getElementById("map-cont").scrollIntoView({
        behavior: "smooth",
        block: "center"
    })
}

function highlightMuniOnMap(e) {
    d3.selectAll(".muni-path").classed("selected", !1);
    const sel = (window.CSS && CSS.escape) ? CSS.escape(e) : e;
    const node = document.querySelector('.muni-path[data-name="' + sel + '"]');
    if (node) {
        node.classList.add("selected");
        node.parentNode.appendChild(node); // que el borde no quede tapado
    }
    state.selectedMuni = e, showMuniBar(e), zoomToMuni(e)
}

function updateProgress() {
    const e = Object.keys(state.visited).length,
        t = state.totalMuni;
    document.getElementById("pfill").style.width = Math.round(e / t * 100) + "%", document.getElementById("plabel").textContent = e + " municipio" + (1 !== e ? "s" : "") + " conquistado" + (1 !== e ? "s" : ""), document.getElementById("ppct").textContent = e + " / " + t, checkInsignia(e, t);
    // El número de conquistados abre la lista completa
    ["ppct", "plabel"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.cursor = "pointer"; el.onclick = openConquistadosList; }
    });
}

// ── Lista de municipios conquistados (modal propio, construido en JS) ──
function openConquistadosList() {
    let ov = document.getElementById("conquistados-ov");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "conquistados-ov";
        ov.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(8,12,18,0.72);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center";
        ov.innerHTML = '<div style="width:100%;max-width:480px;max-height:78vh;background:#141e2c;border-radius:20px 20px 0 0;display:flex;flex-direction:column;box-shadow:0 -10px 30px rgba(0,0,0,0.4)">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0">'
            + '<span style="font-family:\'Playfair Display\',serif;font-weight:700;font-size:16px;color:#fff">Municipios conquistados</span>'
            + '<button id="conquistados-close" aria-label="Cerrar" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.08);border:none;color:#fff;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0">✕</button>'
            + '</div><div id="conquistados-list" style="overflow-y:auto;padding:6px 0"></div></div>';
        document.body.appendChild(ov);
        ov.addEventListener("click", e => { if (e.target === ov) closeConquistadosList(); });
        document.getElementById("conquistados-close").onclick = closeConquistadosList;
    }
    const listEl = document.getElementById("conquistados-list");
    const names = Object.keys(state.visited);
    if (!names.length) {
        listEl.innerHTML = '<div style="text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px">Todavía no has conquistado ningún municipio.</div>';
    } else {
        const dates = state.visitDates || {};
        names.sort((a, b) => (dates[b] || "").localeCompare(dates[a] || ""));
        listEl.innerHTML = names.map(n => {
            const d = dates[n];
            const coast = isCoast(n);
            return '<div onclick="closeConquistadosList();openMuniModal(' + esc(JSON.stringify(n)) + ')" style="display:flex;align-items:center;gap:10px;padding:11px 18px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04)">'
                + '<span style="font-size:16px;flex-shrink:0">' + (coast ? "🌊" : "⛰️") + '</span>'
                + '<span style="flex:1;font-size:13.5px;color:rgba(255,255,255,0.9)">' + esc(n) + '</span>'
                + (d ? '<span style="font-size:11px;color:rgba(255,255,255,0.4);flex-shrink:0">' + esc(d) + '</span>' : "")
                + '</div>';
        }).join("");
    }
    ov.style.display = "flex";
}
function closeConquistadosList() {
    const ov = document.getElementById("conquistados-ov");
    if (ov) ov.style.display = "none";
}
document.addEventListener("click", function(e) {
    if (!e.target.closest("#map-search-input") && !e.target.closest("#map-search-results")) {
        const e = document.getElementById("map-search-results");
        e && (e.style.display = "none")
    }
});

// Deseleccionar el municipio amarillo
function deselectMuni() {
    d3.selectAll(".muni-path").classed("selected", !1);
    state.selectedMuni = null;
    const bar = document.getElementById("muni-bar");
    if (bar) bar.style.display = "none";
}

// Tocar el fondo del mapa → desmarca municipio y quita el coloreado del filtro
document.addEventListener("click", function(e) {
    if (!document.getElementById("screen-map")?.classList.contains("active")) return;
    const t = e.target;
    if (!t.isConnected) return; // el clic redibujó algo (p.ej. los filtros de ruta); no es un toque en el fondo
    if (t.closest(".muni-path")) return;           // otro municipio (lo gestiona D3)
    if (t.closest("#muni-bar")) return;            // barra de acción
    if (t.closest(".bsheet")) return;              // hoja de subir evidencia
    if (t.closest("#muni-modal")) return;          // ficha del municipio
    if (t.closest("#recomendacion-modal")) return; // modal de recomendar
    if (t.closest("#map-search-input") || t.closest("#map-search-results")) return;
    if (t.closest(".map-filter-btn") || t.closest(".area-dd-btn") || t.closest(".ruta-dd-btn") || t.closest(".dd-list-btn") || t.closest("#map-areas-dd")) return;
    if (t.closest("#map-reset-zoom") || t.closest("#ruta-card")) return;
    // Fondo del mapa:
    if (state.selectedMuni) deselectMuni();
    if (mapFilter !== "todos") {
        mapFilter = "todos";
        const dd = document.getElementById("map-areas-dd"); if (dd) dd.style.display = "none";
        const rc = document.getElementById("ruta-card"); if (rc) rc.remove();
        document.querySelectorAll(".map-filter-btn").forEach(b => { b.style.backgroundColor = "rgba(255,255,255,0.08)"; b.style.color = "rgba(255,255,255,0.5)"; });
        applyMapFilter();
    }
});
let mapFilter = "todos";

// Cada ruta con su municipio (para resaltarlo) y datos
const RUTAS = [
  { nombre:"Puertos de Áliva desde Fuente Dé", km:13.7, muni:"Camaleño", url:"https://es.wikiloc.com/rutas-senderismo/puertos-de-aliva-3161661" },
  { nombre:"Puertos de Áliva (circular completa)", km:13.5, muni:"Camaleño", url:"https://es.wikiloc.com/rutas-senderismo/fuente-de-puertos-de-aliva-picos-de-europa-29603244" },
  { nombre:"Urdón → Tresviso", km:12.5, muni:"Peñarrubia", url:"https://es.wikiloc.com/rutas-senderismo/urdon-tresviso-84904190" },
  { nombre:"Subida a Tresviso desde Urdón", km:11.2, muni:"Peñarrubia", url:"https://es.wikiloc.com/rutas-senderismo/subida-a-tresviso-desde-urdon-13504518" },
  { nombre:"Costa Quebrada (Liencres)", km:10.2, muni:"Piélagos", url:"https://es.wikiloc.com/rutas-senderismo/paseo-por-la-costa-quebrada-acantilados-y-playas-de-liencres-con-la-cima-de-pedruquios-14853422" },
  { nombre:"Costa Quebrada (corta)", km:9.8, muni:"Piélagos", url:"https://es.wikiloc.com/rutas-senderismo/costa-quebrada-53267516" },
  { nombre:"Costa Quebrada (larga)", km:28.8, muni:"Piélagos", url:"https://es.wikiloc.com/rutas-senderismo/circular-de-senderismo-costa-quebrada-desde-la-playa-de-la-virgen-del-mar-hasta-el-parque-natural-d-269256081" },
  { nombre:"Monte Buciero + Faro del Caballo", km:13.3, muni:"Santoña", url:"https://es.wikiloc.com/rutas-senderismo/monte-buciero-faro-del-caballo-30259901" },
  { nombre:"Nacimiento del río Asón (circular)", km:8.0, muni:"Soba", url:"https://es.wikiloc.com/rutas-senderismo/ason-cascada-del-ason-nacimiento-del-rio-ason-88011439" },
  { nombre:"Nacimiento del río Asón (senda fluvial)", km:7.5, muni:"Soba", url:"https://es.wikiloc.com/rutas-senderismo/nacimiento-del-rio-ason-por-la-senda-fluvial-desde-las-casucas-de-ason-parque-natural-de-los-collad-130640502" },
  { nombre:"Río Asón cascada", km:7.0, muni:"Soba", url:"https://es.wikiloc.com/rutas-senderismo/rio-ason-cascada-del-nacimiento-del-rio-ason-84894519" },
  { nombre:"Nacimiento del Pisueña (La Garma)", km:6.8, muni:"Saro", url:null },
  { nombre:"Cascadas de Lamiña", km:4.5, muni:"Ruente", url:null },
  { nombre:"Senda fluvial del Nansa", km:13.6, muni:"Rionansa", url:null },
  { nombre:"Castro Valnera (Valles Pasiegos)", km:12.0, muni:"Vega de Pas", url:null },
  { nombre:"Horcados Rojos desde Fuente Dé", km:15.9, muni:"Camaleño", url:null },
  { nombre:"Cabaña Verónica desde Fuente Dé", km:15.1, muni:"Camaleño", url:null },
  { nombre:"Pico Tesorero desde El Cable", km:11.9, muni:"Camaleño", url:null },
  { nombre:"Vega de Liordes (circular)", km:13.5, muni:"Camaleño", url:null },
  { nombre:"Peña Vieja desde Fuente Dé", km:12.5, muni:"Camaleño", url:null },
];

// Rutas reales: las de la BD (tabla "rutas") si existen; si no, el array de arriba como semilla.
function getRutas() {
    return (state.rutas && state.rutas.length) ? state.rutas : RUTAS;
}

function setMapFilter(e) {
    const dd = document.getElementById("map-areas-dd");
    const removeRutaCard = () => { const c = document.getElementById("ruta-card"); if (c) c.remove(); };

    if (e === "areas") {
        mapFilter = "areas";
        const comarcas = [...new Set(Object.values(state.municipiosData || {}).map(m => m.comarca).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
        dd.innerHTML = comarcas.length
            ? comarcas.map(co => '<button class="area-dd-btn" data-area="' + esc(co) + '" onclick="selectArea(this.dataset.area)" style="padding:5px 11px;border:1px solid rgba(255,255,255,0.12);border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)">' + esc(co) + '</button>').join("")
            : '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Sin comarcas en la BD todavía</span>';
        dd.style.display = "flex"; removeRutaCard();
    } else if (e === "rutas") {
        mapFilter = "rutas";
        if (!state.rutas) loadRutasState();
        if (!state.rutaRatings) loadRutaRatings().then(() => { if (mapFilter === "rutas") renderRutasDD(); });
        renderRutasDD();
        dd.style.display = "flex"; removeRutaCard();
    } else if (e === "wishlist") {
        mapFilter = "wishlist";
        const ws = [...(state.wishlist || [])].sort((a, b) => a.localeCompare(b, "es"));
        dd.innerHTML = ws.length
            ? '<div style="flex:1 1 100%;font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px">💖 Tu wishlist (' + ws.length + ')</div>'
              + ws.map(m => '<button class="dd-list-btn" data-m="' + esc(m) + '" onclick="highlightMuniOnMap(this.dataset.m)" style="flex:1 1 100%;text-align:left;padding:6px 11px;border:1px solid rgba(232,90,160,0.25);border-radius:8px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(232,90,160,0.08);color:#f0a8cf">💖 ' + esc(m) + '</button>').join("")
            : '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Tu wishlist está vacía. Marca municipios con el corazón.</span>';
        dd.style.display = "flex"; removeRutaCard();
    } else if (e === "amigos") {
        mapFilter = "amigos";
        if (!state.friendVisitsLoaded) {
            dd.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Cargando...</span>';
            dd.style.display = "flex";
            loadFriendVisits().then(() => { if (mapFilter === "amigos") { renderAmigosDD(); applyMapFilter(); } });
        } else {
            renderAmigosDD();
            dd.style.display = "flex";
        }
        removeRutaCard();
    } else if (e === "cerca") {
        mapFilter = "cerca";
        dd.style.display = "flex"; removeRutaCard();
        renderCercaDD();
    } else {
        if (dd) dd.style.display = "none";
        removeRutaCard();
        mapFilter = e;
    }
    document.querySelectorAll(".map-filter-btn").forEach(t => {
        const activeFilter = mapFilter.startsWith("area:") ? "areas"
            : (mapFilter.startsWith("ruta:") || mapFilter === "rutas") ? "rutas"
            : mapFilter;
        const isActive = t.dataset.filter === activeFilter;
        t.style.backgroundColor = isActive ? "#22b050" : "rgba(255,255,255,0.08)";
        t.style.color = isActive ? "#fff" : "rgba(255,255,255,0.5)";
    });
    applyMapFilter();
}

let rutaSort = "rating";
function setRutaSort(s) { rutaSort = s; renderRutasDD(); }
function renderRutasDD() {
    const dd = document.getElementById("map-areas-dd"); if (!dd) return;
    const rr = state.rutaRatings || {};
    const distOf = r => {
        if (!state.lastLngLat || !state.muniFeatures?.[r.muni]) return Infinity;
        try { return _haversineKm(state.lastLngLat, d3.geoCentroid(state.muniFeatures[r.muni])); } catch (_) { return Infinity; }
    };
    let rutas = getRutas().slice();
    if (rutaSort === "facil") rutas = rutas.filter(r => (r.dificultad || "").toLowerCase().includes("fác") || (r.dificultad || "").toLowerCase().includes("fac"));
    rutas.sort((a, b) => {
        if (rutaSort === "cerca") return distOf(a) - distOf(b);
        if (rutaSort === "corta") return a.km - b.km;
        const ma = rr[a.nombre]?.media || 0, mb = rr[b.nombre]?.media || 0;
        return mb - ma || a.nombre.localeCompare(b.nombre, "es");
    });
    const chip = (id, label) => '<button onclick="setRutaSort(\'' + id + '\')" style="padding:4px 10px;border-radius:999px;font-size:10px;cursor:pointer;font-family:Inter,sans-serif;border:1px solid ' + (rutaSort === id ? "#22b050;background:rgba(34,176,80,0.2);color:#5DCAA5" : "rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5)") + '">' + label + '</button>';
    const bar = '<div style="flex:1 1 100%;display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px">' + chip("rating", "⭐ Mejor valoradas") + chip("cerca", "📍 Cerca") + chip("corta", "📏 Más cortas") + chip("facil", "🟢 Fáciles") + '<button onclick="openSugerirRuta()" style="padding:4px 10px;border-radius:999px;font-size:10px;cursor:pointer;font-family:Inter,sans-serif;border:1px dashed rgba(255,255,255,0.25);background:transparent;color:rgba(255,255,255,0.5)">➕ Sugerir ruta</button></div>';
    if (rutaSort === "cerca" && !state.lastLngLat && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => { state.lastLngLat = [p.coords.longitude, p.coords.latitude]; if (mapFilter === "rutas") renderRutasDD(); }, () => {}, { enableHighAccuracy: !0, timeout: 8000, maximumAge: 60000 });
    }
    dd.innerHTML = bar + (rutas.length
        ? rutas.map((r) => {
            const idx = getRutas().indexOf(r);
            const rt = rr[r.nombre];
            const stars = rt ? ' · ' + rt.media.toFixed(1) + '★' : '';
            const dkm = rutaSort === "cerca" && distOf(r) !== Infinity ? ' · 📍' + distOf(r).toFixed(0) + 'km' : '';
            const dif = r.dificultad ? ' · ' + esc(r.dificultad) : '';
            return '<button class="ruta-dd-btn" data-ridx="' + idx + '" onclick="selectRuta(' + idx + ')" style="flex:1 1 100%;text-align:left;padding:6px 11px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7)">🥾 ' + esc(r.nombre) + ' · ' + r.km + 'km' + stars + dkm + dif + '</button>';
        }).join("")
        : '<span style="font-size:11px;color:rgba(255,255,255,0.35)">No hay rutas con ese filtro</span>');
}

// Media de valoración por ruta (RPC ruta_ratings). Degrada si no existe.
async function loadRutaRatings() {
    try {
        const { data, error } = await db.rpc("ruta_ratings");
        if (error || !Array.isArray(data)) return;
        const map = {};
        data.forEach(r => { if (r.ruta) map[r.ruta] = { media: Number(r.media) || 0, n: Number(r.n) || 0 }; });
        state.rutaRatings = map;
    } catch (_) {}
}

function renderAmigosDD() {
    const dd = document.getElementById("map-areas-dd"); if (!dd) return;
    const fv = state.friendVisits || {};
    const munis = Object.keys(fv).filter(m => fv[m]?.length)
        .sort((a, b) => fv[b].length - fv[a].length || a.localeCompare(b, "es"));
    if (!munis.length) { dd.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Ningún amigo ha conquistado nada todavía</span>'; return; }
    dd.innerHTML = '<div style="flex:1 1 100%;font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px">👥 Dónde han estado tus amigos</div>'
        + munis.map(m => {
            const names = [...new Set(fv[m].map(x => x.username).filter(Boolean))];
            const label = esc(m) + ': ' + fv[m].length + (names.length ? ' (' + esc(names.join(", ")) + ')' : '');
            return '<button class="dd-list-btn" data-m="' + esc(m) + '" onclick="highlightMuniOnMap(this.dataset.m)" style="flex:1 1 100%;text-align:left;padding:6px 11px;border:1px solid rgba(34,114,232,0.28);border-radius:8px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(34,114,232,0.08);color:#9cc4f0">👥 ' + label + '</button>';
        }).join("");
}

function loadRutasState() {
    db.from("rutas").select("*").order("km", { ascending: !1 })
        .then(({ data, error }) => { if (!error && data && data.length) { state.rutas = data; if (mapFilter === "rutas") renderRutasDD(); } })
        .catch(() => {});
    if (!state.rutaWishlist) loadRutaWishlist();
}

// ── "Cerca de ti": municipios sin conquistar más cercanos por GPS ──
function _haversineKm(a, b) {
    const R = 6371, toR = d => d * Math.PI / 180;
    const dLat = toR(b[1] - a[1]), dLng = toR(b[0] - a[0]);
    const la1 = toR(a[1]), la2 = toR(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function nearestUnvisited(limit = 6) {
    if (!state.lastLngLat || !state.muniFeatures) return null;
    const me = state.lastLngLat; // [lng, lat]
    const out = [];
    for (const nombre in state.muniFeatures) {
        if (state.visited?.[nombre]) continue;
        try {
            const c = d3.geoCentroid(state.muniFeatures[nombre]); // [lng, lat]
            if (!c || isNaN(c[0])) continue;
            const km = _haversineKm(me, c);
            out.push({ nombre, km, min: Math.max(2, Math.round(km * 1.3 / 50 * 60)) }); // ~50 km/h por carretera
        } catch (_) {}
    }
    out.sort((a, b) => a.km - b.km);
    return out.slice(0, limit);
}
function renderCercaDD() {
    const dd = document.getElementById("map-areas-dd"); if (!dd) return;
    const draw = list => {
        if (!list) { dd.innerHTML = '<span style="flex:1 1 100%;font-size:11px;color:rgba(255,255,255,0.4)">Activa la ubicación para ver los municipios más cercanos.</span>'; return; }
        if (!list.length) { dd.innerHTML = '<span style="flex:1 1 100%;font-size:11px;color:#5DCAA5">🎉 ¡No te queda ninguno cerca! Crack.</span>'; return; }
        const top = list[0];
        dd.innerHTML = '<div style="flex:1 1 100%;font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px">📍 Más cercanos sin conquistar · sugerido: <b style="color:#5DCAA5">' + esc(top.nombre) + '</b></div>'
            + list.map(r => '<button class="dd-list-btn" data-m="' + esc(r.nombre) + '" onclick="highlightMuniOnMap(this.dataset.m)" style="flex:1 1 100%;text-align:left;padding:6px 11px;border:1px solid rgba(34,176,80,0.28);border-radius:8px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(34,176,80,0.08);color:#9fe0bf">📍 ' + esc(r.nombre) + ' · ' + r.km.toFixed(1) + ' km · ~' + r.min + ' min</button>').join("");
    };
    if (state.lastLngLat) { draw(nearestUnvisited()); return; }
    // Pedir ubicación
    dd.innerHTML = '<span style="flex:1 1 100%;font-size:11px;color:rgba(255,255,255,0.4)">Obteniendo tu ubicación...</span>';
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { state.lastLngLat = [pos.coords.longitude, pos.coords.latitude]; if (mapFilter === "cerca") draw(nearestUnvisited()); },
            () => { if (mapFilter === "cerca") dd.innerHTML = '<span style="flex:1 1 100%;font-size:11px;color:#ff6b6b">No se pudo obtener la ubicación. Revisa los permisos.</span>'; },
            { enableHighAccuracy: !0, timeout: 8000, maximumAge: 60000 }
        );
    } else { dd.innerHTML = '<span style="flex:1 1 100%;font-size:11px;color:#ff6b6b">Tu dispositivo no permite geolocalización.</span>'; }
}

function selectArea(comarca) {
    mapFilter = "area:" + comarca;
    document.querySelectorAll(".area-dd-btn").forEach(b => {
        const act = b.dataset.area === comarca;
        b.style.background = act ? "rgba(34,176,80,0.2)" : "rgba(255,255,255,0.05)";
        b.style.borderColor = act ? "rgba(34,176,80,0.55)" : "rgba(255,255,255,0.12)";
        b.style.color = act ? "#5DCAA5" : "rgba(255,255,255,0.6)";
    });
    applyMapFilter();
}

function applyMapFilter() {
    // Colores por filtro (los conquistados siempre quedan en verde)
    const COLORES = {
        costa:      "#1f4e79",  // azul oscuro
        "montaña":  "#6b4a2e",  // marrón intermedio oscuro
        populares:  "#e8762e",  // naranja
        area:       "#e8c93a"   // amarillo
    };
    const rutasList = getRutas();
    const rutaMunis = new Set(rutasList.map(r => r.muni));
    d3.selectAll(".muni-path").each(function() {
        const e = d3.select(this).attr("data-name"),
            t = state.municipiosData?.[e] || {},
            i = "costa" === t.tipo || isCoast(e),
            n = !!state.visited[e],
            o = t.sellos || [];
        let match = !1, color = null;
        if ("costa" === mapFilter) { match = i; color = COLORES.costa; }
        else if ("montaña" === mapFilter) { match = !i; color = COLORES["montaña"]; }
        else if ("populares" === mapFilter) { match = (state.popularidad?.[e] || 0) > 0; color = COLORES.populares; }
        else if ("rutas" === mapFilter) { match = rutaMunis.has(e) || !!(t.ruta && String(t.ruta).trim()); color = COLORES.area; }
        else if ("wishlist" === mapFilter) { match = state.wishlist?.has(e); color = "#e85aa0"; }
        else if ("amigos" === mapFilter) { match = !!(state.friendVisits?.[e]?.length); color = "#2272e8"; }
        else if (mapFilter.startsWith("area:")) { match = t.comarca === mapFilter.slice(5); color = COLORES.area; }
        else if (mapFilter.startsWith("ruta:")) {
            // Resaltar el municipio por donde pasa la ruta seleccionada
            const _r = rutasList[+mapFilter.slice(5)];
            match = !!(_r && _r.muni === e); color = "#5DCAA5";
        }
        else if (SELLOS[mapFilter]) { match = o.includes(mapFilter); color = COLORES.populares; }
        // Pintar: el color del filtro en los que cumplen (no conquistados);
        // el resto vuelve al gris base. Conquistados: verde siempre.
        const esRuta = mapFilter.startsWith("ruta:");
        d3.select(this)
            .style("fill", match && color && (esRuta || !n) ? color : null)
            .style("stroke", match && esRuta ? "#5DCAA5" : null)
            .style("stroke-width", match && esRuta ? "1.4px" : null)
            .style("opacity", 1);
    });
}

function showMuniBar(e) {
    document.getElementById("muni-bar").style.display = "flex", document.getElementById("bar-name").textContent = e;
    const t = state.visited[e];
    const rt = state.municipiosData?.[e]?.ruta;
    const nf = state.friendVisits?.[e]?.length || 0;
    document.getElementById("bar-st").textContent = (t ? "✓ Conquistado" : "Sin visitar")
        + (rt ? " · 🥾 Tiene ruta" : "")
        + (nf ? " · 👥 " + nf + " amig" + (nf === 1 ? "o" : "os") : "");
    const i = document.getElementById("btn-ev");
    i.style.backgroundColor = t ? "#1a7a3e" : "#22b050", i.style.color = "#ffffff", i.innerHTML = t ? '<i class="ti ti-camera" aria-hidden="true"></i> Añadir foto' : '<i class="ti ti-camera" aria-hidden="true"></i> Evidencia'
}

// Carga qué municipios ha visitado cada amigo (para la capa "👥 Amigos" del mapa)
async function loadFriendVisits() {
    if (!state.user) return;
    try {
        const { data: fs } = await db.from("friendships")
            .select("follower_id,following_id")
            .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
            .eq("estado", "aceptado");
        const fids = [...new Set((fs || []).map(f => f.follower_id === state.user.id ? f.following_id : f.follower_id))]
            .filter(id => !state.blockedIds?.has(id));
        state.friendVisits = {};
        if (fids.length) {
            const { data: vs } = await db.from("visits")
                .select("municipio,user_id,profiles(username,avatar_url)")
                .in("user_id", fids).in("visibilidad", ["amigos", "publico"]);
            (vs || []).forEach(v => {
                (state.friendVisits[v.municipio] = state.friendVisits[v.municipio] || [])
                    .push({ user_id: v.user_id, username: v.profiles?.username, avatar_url: v.profiles?.avatar_url });
            });
        }
        state.friendVisitsLoaded = true;
    } catch (err) { console.warn("loadFriendVisits:", err); state.friendVisits = state.friendVisits || {}; }
}

function openSheet() {
    pendingEventId = null, pendingEventName = null, pendingRutaName = null; // por si venimos de un evento/ruta
    if (!state.selectedMuni) return;
    const _rt = document.getElementById("sheet-rating"); if (_rt) _rt.style.display = "none";
    const e = state.selectedMuni,
        t = state.visited[e];
    document.getElementById("sht-title").textContent = e, document.getElementById("sht-sub").textContent = t ? "Ya conquistado — añade foto o descripción" : "Foto, descripción o ambas (todo opcional)";
    const i = document.getElementById("btn-desmarcar");
    i && (i.style.display = t ? "block" : "none");
    const n = document.getElementById("btn-conf");
    n && (n.textContent = t ? "Guardar" : "Marcar como conquistado"), document.querySelectorAll(".vis-btn").forEach(e => e.classList.remove("vis-active")), document.getElementById("vis-amigos").classList.add("vis-active"), clearPhoto();
    const o = document.getElementById("evidencia-desc");
    o && (o.value = "");
    renderSheetLocalidades(e);
    renderSheetTags();
    document.getElementById("upload-sheet").classList.add("open")
}

// Checklist de localidades del municipio (si están en la BD)
function renderSheetLocalidades(muni) {
    const desc = document.getElementById("evidencia-desc");
    let box = document.getElementById("sheet-locs");
    if (!box && desc) {
        box = document.createElement("div");
        box.id = "sheet-locs";
        desc.parentNode.insertBefore(box, desc);
    }
    if (!box) return;
    const locs = state.municipiosData?.[muni]?.localidades || [];
    if (!locs.length) { box.style.display = "none"; box.innerHTML = ""; return; }
    const marcadas = new Set(state.visitedLocs?.[muni] || []);
    box.style.cssText = "margin-bottom:12px;padding:11px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;display:block";
    box.innerHTML =
        '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">🏘️ ¿En qué localidades has estado?</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + locs.map(l => {
            const on = marcadas.has(l);
            return '<label style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:999px;font-size:12px;cursor:pointer;border:1px solid '
                + (on ? "rgba(34,176,80,0.5);background:rgba(34,176,80,0.15);color:#5DCAA5" : "rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)") + '">'
                + '<input type="checkbox" class="loc-chk" value="' + esc(l) + '"' + (on ? " checked" : "")
                + ' style="accent-color:#22b050;margin:0"/>'
                + esc(l) + '</label>';
        }).join("")
        + '</div>';
    // Repintar la pastilla al marcar/desmarcar
    if (!box._wired) {
        box._wired = !0;
        box.addEventListener("change", ev => {
            const chk = ev.target;
            if (!chk.classList?.contains("loc-chk")) return;
            const lab = chk.parentElement;
            lab.style.border = chk.checked ? "1px solid rgba(34,176,80,0.5)" : "1px solid rgba(255,255,255,0.14)";
            lab.style.background = chk.checked ? "rgba(34,176,80,0.15)" : "rgba(255,255,255,0.05)";
            lab.style.color = chk.checked ? "#5DCAA5" : "rgba(255,255,255,0.6)";
        });
    }
}

// Etiquetar amigos en la publicación
async function renderSheetTags() {
    const desc = document.getElementById("evidencia-desc");
    let box = document.getElementById("sheet-tags");
    if (!box && desc) {
        box = document.createElement("div");
        box.id = "sheet-tags";
        desc.parentNode.insertBefore(box, desc);
    }
    if (!box) return;
    box.style.display = "none"; box.innerHTML = "";
    let amigos = [];
    try { amigos = await getFriendsCache(); } catch (_) { return; }
    if (!amigos.length) return;   // sin amigos, no se muestra nada
    box.style.cssText = "margin-bottom:12px;padding:11px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;display:block";
    box.innerHTML =
        '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">🏷️ ¿Con quién has ido?</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;max-height:120px;overflow-y:auto">'
        + amigos.map(a =>
            '<label style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:999px;font-size:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)">'
            + '<input type="checkbox" class="tag-chk" value="' + esc(a.id) + '" style="accent-color:#2272e8;margin:0"/>'
            + "@" + esc(a.username || "amigo") + '</label>'
        ).join("")
        + '</div>';
    if (!box._wired) {
        box._wired = !0;
        box.addEventListener("change", ev => {
            const chk = ev.target;
            if (!chk.classList?.contains("tag-chk")) return;
            const lab = chk.parentElement;
            lab.style.border = chk.checked ? "1px solid rgba(34,114,232,0.5)" : "1px solid rgba(255,255,255,0.14)";
            lab.style.background = chk.checked ? "rgba(34,114,232,0.15)" : "rgba(255,255,255,0.05)";
            lab.style.color = chk.checked ? "#9cc4f0" : "rgba(255,255,255,0.6)";
        });
    }
}


function closeUploadSheet() {
    document.getElementById("upload-sheet").classList.remove("open");
    pendingEventId = null;
    pendingEventName = null;
    pendingRutaName = null;
    const _rt = document.getElementById("sheet-rating"); if (_rt) _rt.style.display = "none";
}

function clearPhoto() {
    state.pendingPhotos = [];
    const w = document.getElementById("prev-w");
    if (w) w.style.display = "none";
    const e = document.getElementById("uzone")?.parentElement;
    e && (e.style.display = "block");
    try {
        document.getElementById("file-in").value = ""
    } catch (e) {}
    state.pendingFile = null, state.pendingBase64 = null, state.pendingMime = null
}
let selectedVisibilidad = "amigos";

function setVis(e) {
    selectedVisibilidad = e, document.querySelectorAll(".vis-btn").forEach(e => e.classList.remove("vis-active")), document.getElementById("vis-" + e).classList.add("vis-active")
}
async function confirmVisit() {
    if (pendingRutaName) return void await confirmRutaPhoto();
    if (pendingEventId) return void await confirmEventPhoto();
    const e = state.selectedMuni;
    if (!e || !state.user) return;
    const t = document.getElementById("btn-conf"),
        i = (document.getElementById("evidencia-desc")?.value || "").trim();
    // Verificación GPS solo al conquistar por primera vez
    let gpsVerificada = !1;
    if (!state.visited[e]) {
        t.textContent = "📍 Comprobando ubicación...", t.disabled = !0;
        const gps = await verifyGPSInMuni(e);
        if (gps === "ok") gpsVerificada = !0;
        else if (gps === "fuera" && !(await confirmar("No parece que estés en " + e + " ahora mismo. ¿Marcar igualmente como conquistado? Quedará sin verificar.", { titulo: "📍 Ubicación", ok: "Marcar igual", cancel: "Cancelar" }))) {
            t.textContent = "Marcar como conquistado";
            t.disabled = !1;
            return;
        }
    }
    t.textContent = "Guardando...", t.disabled = !0;
    try {
        // 1) Guardar / actualizar la VISITA
        const _visitPayload = {
            user_id: state.user.id,
            municipio: e,
            visibilidad: selectedVisibilidad,
            coords: state.lastCoords || null
        };
        // La fecha solo se fija en la 1ª conquista (no se pisa al añadir más fotos)
        if (!state.visited[e]) _visitPayload.fecha = (new Date).toISOString().split("T")[0];
        // Solo tocamos gps_verificada en la 1ª conquista o si ahora sí verifica,
        // para no "desverificar" una visita ya verificada al añadir más fotos.
        if (!state.visited[e] || gpsVerificada) _visitPayload.gps_verificada = gpsVerificada;
        const {
            data: o,
            error: a
        } = await db.from("visits").upsert(_visitPayload, { onConflict: "user_id,municipio" }).select();
        // Localidades marcadas en el checklist (si la columna existe)
        const locsSel = [...document.querySelectorAll("#sheet-locs .loc-chk:checked")].map(c => c.value);
        if (document.getElementById("sheet-locs")?.innerHTML) {
            try {
                await db.from("visits").update({ localidades: locsSel })
                    .eq("user_id", state.user.id).eq("municipio", e);
                (state.visitedLocs = state.visitedLocs || {})[e] = locsSel;
            } catch (locErr) { console.warn("localidades:", locErr); }
        }
        if (a) return console.error("Error guardando visita:", JSON.stringify(a)), toast("Error al guardar la visita: " + a.message, "error"), t.textContent = "Marcar como conquistado", void(t.disabled = !1);

        // 2) Guardar las FOTOS (pueden ser varias). La descripción va con la primera.
        const _photos = state.pendingPhotos.length
            ? state.pendingPhotos
            : (state.pendingBase64 ? [{ base64: state.pendingBase64, mime: state.pendingMime }] : []);
        if (_photos.length) {
            const sess = (await db.auth.getSession()).data?.session?.user;
            if (!sess) throw new Error("Sesión expirada — sal y vuelve a entrar");
            const uid = sess.id;
            const batchId = (self.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(16).slice(2)));
            const _idsSubidos = [];
            for (let idx = 0; idx < _photos.length; idx++) {
                const ph = _photos[idx];
                try {
                    const b64 = ph.base64.split(",")[1];
                    const mime = ph.mime || "image/jpeg";
                    const bin = atob(b64), chunks = [];
                    for (let j = 0; j < bin.length; j += 512) {
                        const sl = bin.slice(j, j + 512), u8 = new Uint8Array(sl.length);
                        for (let k = 0; k < sl.length; k++) u8[k] = sl.charCodeAt(k);
                        chunks.push(u8);
                    }
                    const blob = new Blob(chunks, { type: mime });
                    const ext = mime.includes("png") ? "png" : "jpg";
                    const path = `${uid}/${Date.now()}_${idx}.${ext}`;
                    const { error: upErr } = await db.storage.from("evidencias").upload(path, blob, { contentType: mime, cacheControl: "3600", upsert: !1 });
                    if (upErr) { console.error("Upload error:", upErr); toast("No se pudo subir una foto. Inténtalo de nuevo.", "error"); continue; }
                    const now = new Date();
                    const desc = idx === 0 ? (i || null) : null;
                    const baseRow = {
                        user_id: state.user.id, municipio: e, storage_path: path, descripcion: desc,
                        visibilidad: selectedVisibilidad, coords: state.lastCoords || null,
                        fecha: now.toISOString().split("T")[0],
                        hora: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                    };
                    let ins = await db.from("photos").insert({ ...baseRow, batch_id: batchId }).select().single();
                    if (ins.error && /batch_id|column|schema cache/i.test(ins.error.message || "")) {
                        ins = await db.from("photos").insert(baseRow).select().single();
                    }
                    const row = ins.data;
                    const signed = (await signPaths([path]))[path] || "";
                    const stateP = {
                        id: row?.id, src: signed, muni: e, date: now.toLocaleDateString("es-ES"),
                        time: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
                        coords: state.lastCoords || "", desc: desc || "", vis: selectedVisibilidad, path, thumb: null
                    };
                    if (row?.id) _idsSubidos.push(row.id);
                    state.photos.unshift(stateP);
                    // Miniatura (aditivo: no rompe si falta la columna thumb_path)
                    try {
                        const td = await dataUrlToThumb(ph.base64, 960, 0.78);
                        if (td) {
                            const tb = await (await fetch(td)).blob();
                            const tp = path.replace(/\.(jpg|jpeg|png)$/i, "") + "_thumb.jpg";
                            const { error: te } = await db.storage.from("evidencias").upload(tp, tb, { contentType: "image/jpeg", cacheControl: "3600", upsert: !0 });
                            if (!te) { const { error: ue } = await db.from("photos").update({ thumb_path: tp }).eq("id", row?.id); if (!ue) stateP.thumb = tp; }
                        }
                    } catch (_) {}
                } catch (perr) { console.error("foto idx " + idx + ":", perr); }
            }
        } else if (i) {
            const now = new Date();
            await db.from("photos").insert({
                user_id: state.user.id, municipio: e, storage_path: "text_only", descripcion: i,
                visibilidad: selectedVisibilidad, coords: state.lastCoords || null,
                fecha: now.toISOString().split("T")[0],
                hora: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
            });
            state.photos.unshift({
                src: null, muni: e, date: now.toLocaleDateString("es-ES"),
                time: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
                coords: "", desc: i, vis: selectedVisibilidad
            });
        }
        // Etiquetas: se asocian a la primera foto del lote (la que representa el post)
        try {
            const etiquetados = [...document.querySelectorAll(".tag-chk:checked")].map(c => c.value);
            if (etiquetados.length && _idsSubidos.length) {
                await db.from("photo_tags").insert(etiquetados.map(uid => ({
                    photo_id: _idsSubidos[0], tagged_id: uid, tagger_id: state.user.id
                })));
            }
        } catch (tagErr) { console.warn("etiquetas:", tagErr); }
        state.visited[e] = !0, document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), showMuniBar(e), closeUploadSheet(), document.getElementById("file-in").value = "", document.getElementById("prev-w").style.display = "none", document.getElementById("uzone").style.display = "block", state.pendingFile = null, state.pendingBase64 = null, state.pendingMime = null, state.pendingPhotos = [], state.feedCache = null;
        const s = document.getElementById("evidencia-desc");
        s && (s.value = ""), document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), updateProgress(), launchConfetti();
        (state.visitDates = state.visitDates || {})[e] = (state.visitDates[e] || (new Date).toISOString().slice(0, 10));
        toast(_photos.length ? ("¡" + e + " conquistado! " + _photos.length + (_photos.length === 1 ? " foto subida" : " fotos subidas")) : ("¡" + e + " conquistado!"), "success");
        refreshBadgesAndLevel(true);
        setTimeout(async () => {
            if (await confirmar("¿Quieres recomendar algún sitio o restaurante en " + e + "?", { titulo: "Recomendar un sitio", ok: "Sí, recomendar", cancel: "Ahora no" })) openRecModal(e);
        }, 1200)
    } catch (t) {
        if (console.error("confirmVisit error:", t), t.message && t.message.includes("foto")) try {
            await db.from("visits").upsert({
                user_id: state.user.id,
                municipio: e,
                visibilidad: selectedVisibilidad,
                coords: state.lastCoords || null,
                fecha: (new Date).toISOString().split("T")[0]
            }, { onConflict: "user_id,municipio" }), state.visited[e] = !0, document.querySelectorAll(".muni-path").forEach(t => {
                t.getAttribute("data-name") === e && t.classList.add("visited")
            }), showMuniBar(e), closeUploadSheet(), updateProgress(), toast("Visita guardada, pero la foto no se pudo subir.", "info")
        } catch (e) {
            toast("Error al guardar: " + t.message, "error")
        } else toast("Error al guardar: " + t.message, "error")
    } finally {
        t.textContent = state.visited[state.selectedMuni] ? "Guardar nueva foto" : "Marcar como conquistado", t.disabled = !1
    }
}
async function desmarcarVisit() {
    const e = state.selectedMuni;
    if (!e || !state.user) return;
    if (!await confirmar("¿Seguro que quieres desmarcar " + e + " como conquistado?", { titulo: "Desmarcar municipio", ok: "Desmarcar", peligro: !0 })) return;
    const t = document.getElementById("btn-desmarcar");
    t.textContent = "Desmarcando...", t.disabled = !0;
    try {
        await db.from("visits").delete().eq("user_id", state.user.id).eq("municipio", e), delete state.visited[e], delete (state.visitDates || {})[e], document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && (t.classList.remove("visited"), t.classList.remove("selected"))
        }), document.getElementById("muni-bar").style.display = "none", closeUploadSheet(), updateProgress(), toast(e + " desmarcado", "info")
    } catch (e) {
        toast("Error al desmarcar: " + e.message, "error")
    } finally {
        t.textContent = "Desmarcar como conquistado", t.disabled = !1
    }
}

function getCoords() {
    navigator.geolocation && navigator.geolocation.getCurrentPosition(e => {
        state.lastCoords = e.coords.latitude.toFixed(4) + "°N, " + Math.abs(e.coords.longitude).toFixed(4) + "°W";
        state.lastLngLat = [e.coords.longitude, e.coords.latitude];
    })
}

// ── VERIFICACIÓN GPS ────────────────────────────────────────
// Comprueba si la posición actual cae dentro del polígono real
// del municipio (usa la geometría del mapa + d3.geoContains).
// Devuelve: 'ok' | 'fuera' | 'sin_gps'
function verifyGPSInMuni(muni) {
    return new Promise(resolve => {
        const feat = state.muniFeatures?.[muni];
        if (!feat || !navigator.geolocation) return resolve("sin_gps");
        navigator.geolocation.getCurrentPosition(
            pos => {
                const pt = [pos.coords.longitude, pos.coords.latitude];
                state.lastCoords = pos.coords.latitude.toFixed(4) + "°N, " + Math.abs(pos.coords.longitude).toFixed(4) + "°W";
                state.lastLngLat = pt;
                try {
                    resolve(d3.geoContains(feat, pt) ? "ok" : "fuera");
                } catch (e) { resolve("sin_gps"); }
            },
            () => resolve("sin_gps"),
            { enableHighAccuracy: !0, timeout: 8e3, maximumAge: 6e4 }
        );
    });
}

async function handleFilesSelected(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const room = 8 - state.pendingPhotos.length;
    if (room <= 0) { toast("Máximo 8 fotos por visita.", "info"); return; }
    for (const f of list.slice(0, room)) {
        try {
            const { base64, mime } = await compressImage(f);
            state.pendingPhotos.push({ base64, mime });
        } catch (err) { console.warn("foto:", err); }
    }
    // Compat: la primera foto también en las vars antiguas (flujo de eventos + thumb)
    if (state.pendingPhotos[0]) { state.pendingBase64 = state.pendingPhotos[0].base64; state.pendingMime = state.pendingPhotos[0].mime; }
    renderPendingPreviews();
    getCoords();
}
// Compat hacia atrás (por si algo llama al nombre antiguo en singular)
async function handleFileSelected(file) { return handleFilesSelected(file ? [file] : []); }

function renderPendingPreviews() {
    const w = document.getElementById('prev-w');
    const uz = document.getElementById('uzone')?.parentElement;
    if (!w) return;
    if (!state.pendingPhotos.length) { w.style.display = 'none'; if (uz) uz.style.display = 'block'; return; }
    let strip = document.getElementById('prev-strip');
    if (!strip) { strip = document.createElement('div'); strip.id = 'prev-strip'; strip.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding:2px'; w.innerHTML = ''; w.appendChild(strip); }
    strip.innerHTML = state.pendingPhotos.map((p, idx) =>
        '<div style="position:relative;flex-shrink:0">'
        + '<img src="' + p.base64 + '" style="width:84px;height:84px;object-fit:cover;border-radius:10px;display:block" alt="foto ' + (idx + 1) + '"/>'
        + '<button onclick="removePendingPhoto(' + idx + ')" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center">✕</button>'
        + '</div>'
    ).join('') + (state.pendingPhotos.length < 8
        ? '<button onclick="document.getElementById(\'file-in\').click()" style="flex-shrink:0;width:84px;height:84px;border:1px dashed rgba(255,255,255,0.25);border-radius:10px;background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5);font-size:26px;cursor:pointer;line-height:1">+</button>'
        : '');
    w.style.display = 'block';
    if (uz) uz.style.display = 'none';
}
function removePendingPhoto(idx) {
    state.pendingPhotos.splice(idx, 1);
    if (state.pendingPhotos[0]) { state.pendingBase64 = state.pendingPhotos[0].base64; state.pendingMime = state.pendingPhotos[0].mime; }
    else { state.pendingBase64 = null; state.pendingMime = null; }
    renderPendingPreviews();
}
const fileInput = document.getElementById("file-in");
fileInput.addEventListener("change", function(e) {
    const fs = e.target.files;
    if (fs && fs.length) handleFilesSelected(fs);
    e.target.value = ""; // permite volver a elegir las mismas / añadir más
});
let currentFilter = "todos";
async function loadEventos() {
    const {
        data: e
    } = await db.from("eventos").select("*").eq("activo", !0).order("fecha");
    e && (state.eventos = e), renderEventos(), checkEventReminders()
}

function filterEvs(e, t) {
    currentFilter = t, document.querySelectorAll(".ev-tab").forEach(e => e.classList.remove("active")), e.classList.add("active"), renderEventos()
}

function _evMonthLabel(fechaStr) {
    const d = new Date(fechaStr);
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return meses[d.getMonth()] + " " + d.getFullYear();
}
function _evDateShort(fechaStr) {
    return new Date(fechaStr).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// Tarjeta de un evento de un solo sitio (formato clásico)
function _evSingleCard(e) {
    const inscrito = state.inscripciones[e.id];
    const bg = inscrito ? "#1a7a3e" : "#aa1060";
    const txt = inscrito ? "Apuntado" : "Apuntarme";
    const ic = inscrito ? "ti-check" : "ti-plus";
    const a = _evDateShort(e.fecha);
    const _mf = _muniDeEvento(e)?.imagen_url;
    const past = (new Date - new Date(e.fecha)) / 864e5;
    const fotosBtn = (inscrito || past >= 0) ? `<button onclick="event.stopPropagation();openEventFotoSheet(this.dataset.eid, this.dataset.ename)" data-eid="${esc(e.id)}" data-ename="${esc(e.nombre)}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(232,184,32,0.2);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0"><i class="ti ti-camera" aria-hidden="true"></i>📸 Fotos</button>` : "";
    return `
    <div class="ev-card" data-eid="${esc(e.id)}" onclick="openEventModal(this.dataset.eid)" style="cursor:pointer">
      <div class="ev-img" style="${_mf ? 'background-image:url(' + esc(_mf) + ');background-size:cover;background-position:center' : 'background-color:' + (e.color_bg || "#1a3a5a")}">
        ${_mf ? '<div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.3),transparent 45%)"></div>' : `<i class="ti ${e.icon || "ti-confetti"}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>`}
        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i>${e.dia_semana || ""} ${a}</div>
        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${e.tipo_badge || e.tipo}</div>
      </div>
      <div class="ev-body">
        <div class="ev-name">${esc(e.nombre)}</div>
        <div class="ev-loc"><i class="ti ti-map-pin" aria-hidden="true"></i>${esc(e.lugar)}</div>
        <div class="ev-desc">${esc(e.descripcion || "")}</div>
        <div id="ev-fotos-${e.id}" style="margin:8px 0"></div>
        <div class="ev-footer">
          <div class="ev-count" id="ev-count-${e.id}"><strong>...</strong> van</div>
          <div style="display:flex;gap:6px;align-items:center">
            ${fotosBtn}
            <button onclick="event.stopPropagation();toggleInscripcion('${e.id}')" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background-color:${bg};color:#fff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0"><i class="ti ${ic}" aria-hidden="true"></i>${txt}</button>
          </div>
        </div>
      </div>
    </div>`;
}

// Tarjeta de un festival que se celebra en varios pueblos
function _evFestivalCard(f) {
    const fechas = [...new Set(f.rows.map(r => r.fecha))].sort();
    const dateLabel = fechas.length === 1 ? _evDateShort(fechas[0]) : (_evDateShort(fechas[0]) + " – " + _evDateShort(fechas[fechas.length - 1]));
    const _mf = _muniDeEvento(f.rows[0])?.imagen_url;
    const pueblos = f.rows.map(ev => {
        const inscrito = state.inscripciones[ev.id];
        const bg = inscrito ? "#1a7a3e" : "#aa1060";
        const txt = inscrito ? "Apuntado" : "Apuntarme";
        const ic = inscrito ? "ti-check" : "ti-plus";
        const past = (new Date - new Date(ev.fecha)) / 864e5;
        const fotosBtn = (inscrito || past >= 0) ? `<button onclick="event.stopPropagation();openEventFotoSheet(this.dataset.eid, this.dataset.ename)" data-eid="${esc(ev.id)}" data-ename="${esc((f.nombre + ' · ' + (ev.lugar || ev.municipio)))}" style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background:rgba(232,184,32,0.2);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0"><i class="ti ti-camera" aria-hidden="true"></i>Fotos</button>` : "";
        return `<div style="padding:11px 0;border-top:1px solid rgba(255,255,255,0.07)">
          <div data-eid="${esc(ev.id)}" onclick="openEventModal(this.dataset.eid)" style="cursor:pointer">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="font-size:13px;font-weight:700;color:#fff"><i class="ti ti-map-pin" aria-hidden="true" style="font-size:11px;color:#f08fc4"></i> ${esc(ev.lugar || ev.municipio)}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.45);flex-shrink:0">${ev.fecha && fechas.length > 1 ? _evDateShort(ev.fecha) : ""}</div>
            </div>
            ${ev.descripcion ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:3px;line-height:1.4">${esc(ev.descripcion)}</div>` : `<div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:3px">Toca para ver la programación</div>`}
            <div id="ev-fotos-${ev.id}" style="margin:7px 0 0"></div>
            <div id="ev-count-${ev.id}" style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:5px"><strong>...</strong> van</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            ${fotosBtn}
            <button onclick="event.stopPropagation();toggleInscripcion('${ev.id}')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background-color:${bg};color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0"><i class="ti ${ic}" aria-hidden="true"></i>${txt}</button>
          </div>
        </div>`;
    }).join("");
    return `
    <div class="ev-card" style="cursor:default">
      <div class="ev-img" style="${_mf ? 'background-image:url(' + esc(_mf) + ');background-size:cover;background-position:center' : 'background-color:' + (f.color_bg || "#3a1a3a")}">
        ${_mf ? '<div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.3),transparent 45%)"></div>' : `<i class="ti ${f.icon || "ti-confetti"}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>`}
        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i> ${dateLabel}</div>
        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${f.tipo_badge || f.tipo}</div>
      </div>
      <div class="ev-body">
        <div class="ev-name">${esc(f.nombre)}</div>
        <div class="ev-loc" style="color:rgba(255,255,255,0.45)"><i class="ti ti-map-pin" aria-hidden="true"></i>Se celebra en ${f.rows.length} sitios — apúntate y sube fotos en cada uno</div>
        ${pueblos}
      </div>
    </div>`;
}

function renderEventos() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isUpcoming = ev => { const d = new Date(ev.fecha); d.setHours(0, 0, 0, 0); return d >= today; };
    const upcoming = state.eventos.filter(isUpcoming);
    const past = state.eventos.filter(ev => { const d = new Date(ev.fecha); d.setHours(0, 0, 0, 0); return d < today && state.inscripciones[ev.id]; });
    let list = "todos" === currentFilter ? upcoming
        : "cerca" === currentFilter ? upcoming
            : "inscritos" === currentFilter ? upcoming.filter(e => state.inscripciones[e.id])
                : "pasados" === currentFilter ? past
                    : upcoming.filter(e => e.tipo === currentFilter);

    const tabIns = document.getElementById("tab-inscritos");
    if (tabIns) { const c = upcoming.filter(e => state.inscripciones[e.id]).length; tabIns.textContent = c > 0 ? "Mis eventos (" + c + ")" : "Mis eventos"; }

    // Agrupar por festival (festival || nombre)
    const fests = {}, festOrder = [];
    list.forEach(ev => { const k = ev.festival || ev.nombre; if (!fests[k]) { fests[k] = []; festOrder.push(k); } fests[k].push(ev); });
    let festObjs = festOrder.map(k => {
        const rows = fests[k].slice().sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        const first = rows[0];
        return { key: k, nombre: first.festival || first.nombre, rows, fecha: first.fecha, periodo: first.periodo || _evMonthLabel(first.fecha), tipo: first.tipo, tipo_badge: first.tipo_badge, color_bg: first.color_bg, icon: first.icon };
    }).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    // Filtro "Cerca": ordenar por distancia (requiere GPS)
    let cercaMode = currentFilter === "cerca";
    if (cercaMode) {
        if (!state.lastLngLat) {
            const cont0 = document.getElementById("eventos-list");
            if (cont0) cont0.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.4);font-size:13px"><div class="spin" style="margin:0 auto 8px"></div>Obteniendo tu ubicación...</div>';
            if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
                p => { state.lastLngLat = [p.coords.longitude, p.coords.latitude]; if (currentFilter === "cerca") renderEventos(); },
                () => { const c = document.getElementById("eventos-list"); if (c) c.innerHTML = '<div style="text-align:center;padding:30px 16px;color:#ff6b6b;font-size:13px">No se pudo obtener tu ubicación. Revisa los permisos.</div>'; },
                { enableHighAccuracy: !0, timeout: 8000, maximumAge: 60000 });
            return;
        }
        const distOf = f => {
            let best = Infinity;
            f.rows.forEach(r => { const m = state.muniFeatures?.[r.municipio] || state.muniFeatures?.[r.lugar]; if (m) { try { const c = d3.geoCentroid(m); const km = _haversineKm(state.lastLngLat, c); if (km < best) best = km; } catch (_) {} } });
            return best;
        };
        festObjs.forEach(f => f._dist = distOf(f));
        const limite = new Date(Date.now() + 21 * 864e5);
        festObjs = festObjs.filter(f => f._dist <= 15 && new Date(f.fecha) <= limite);
        festObjs.sort((a, b) => a._dist - b._dist);
        if (!festObjs.length) {
            const c = document.getElementById("eventos-list");
            if (c) c.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.4);font-size:13px">📍 No hay fiestas a menos de 15 km en las próximas 3 semanas.<br>Prueba el filtro "Todos".</div>';
            return;
        }
    }

    // Agrupar festivales por periodo (o un único bloque "Cerca de ti")
    const periodos = {}, perOrder = [];
    if (cercaMode) { periodos["📍 Cerca de ti"] = festObjs; perOrder.push("📍 Cerca de ti"); }
    else festObjs.forEach(f => { if (!periodos[f.periodo]) { periodos[f.periodo] = []; perOrder.push(f.periodo); } periodos[f.periodo].push(f); });

    const cont = document.getElementById("eventos-list");
    if (!festObjs.length) { cont.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.3);font-size:13px">No hay eventos en este filtro.</div>'; return; }
    const adminBanner = isAdmin()
        ? '<div style="margin:0 0 10px;padding:11px 13px;background:rgba(34,114,232,0.1);border:1px solid rgba(34,114,232,0.3);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:12px;color:#9cc4f0">🛡️ Panel de moderación</span><button onclick="openSuggestionsReview()" style="padding:7px 13px;background:#2272e8;color:#fff;border:none;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">Revisar sugerencias<span id="sug-pend-badge" style="display:none;margin-left:6px;background:#fff;color:#2272e8;border-radius:999px;padding:0 6px;font-size:10px"></span></button><button onclick="openReportsReview()" style="padding:7px 13px;background:rgba(232,40,40,0.85);color:#fff;border:none;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">🚩 Reportes<span id="rep-pend-badge" style="display:none;margin-left:6px;background:#fff;color:#e82828;border-radius:999px;padding:0 6px;font-size:10px"></span></button></div>'
        : "";
    cont.innerHTML = adminBanner + perOrder.map(per => {
        const header = '<div style="padding:14px 4px 8px;font-size:12px;font-weight:700;color:#f08fc4;letter-spacing:.05em;text-transform:uppercase">📅 ' + esc(per) + '</div>';
        const cards = periodos[per].map(f => f.rows.length === 1 ? _evSingleCard(f.rows[0]) : _evFestivalCard(f)).join("");
        return header + cards;
    }).join("");
    if (isAdmin()) { loadPendingSuggestionsBadge(); loadPendingReportsBadge(); }
    list.forEach(e => { loadEventCount(e.id); loadEventPhotos(e.id); });
}
async function loadEventPhotos(eventId, targetId) {
    const cont = document.getElementById(targetId || "ev-fotos-" + eventId);
    if (!cont) return;
    const { data: fotos } = await db.from("event_photos")
        .select("id, user_id, storage_path, descripcion, profiles(username)")
        .eq("event_id", eventId).order("created_at", { ascending: !1 }).limit(8);
    if (!fotos || !fotos.length) { cont.innerHTML = ""; return; }
    const paths = [...new Set(fotos.map(f => f.storage_path).filter(Boolean))];
    const { data: signed } = await db.storage.from("evidencias").createSignedUrls(paths, 3600);
    const urls = {};
    (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
    const thumbs = fotos.filter(f => urls[f.storage_path]).map(f =>
        '<div style="flex-shrink:0;width:74px;height:74px;border-radius:10px;overflow:hidden;background:#1a2535">'
        + '<img src="' + esc(urls[f.storage_path]) + '" style="width:100%;height:100%;object-fit:cover" alt="' + esc(f.profiles?.username || "foto") + '" title="' + esc(f.profiles?.username || "") + '"/>'
        + '</div>').join("");
    cont.innerHTML = thumbs
        ? '<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">📸 Fotos del evento</div><div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">' + thumbs + '</div>'
        : "";
}
async function loadEventCount(e) {
    const {
        count: t
    } = await db.from("event_signups").select("*", {
        count: "exact",
        head: !0
    }).eq("event_id", e), i = document.getElementById("ev-count-" + e);
    i && (i.innerHTML = `<strong>${t||0}</strong> van`)
}
async function toggleInscripcion(e) {
    if (!state.user) return;
    state.inscripciones[e] ? (await db.from("event_signups").delete().eq("user_id", state.user.id).eq("event_id", e), delete state.inscripciones[e]) : (await db.from("event_signups").insert({
        user_id: state.user.id,
        event_id: e
    }), state.inscripciones[e] = !0), renderEventos()
}
let pendingEventId = null,
    pendingEventName = null;
let pendingRutaName = null,
    pendingRating = 0;

// Estrellas de valoración (en la hoja de subida, solo rutas)
function setRating(v) {
    pendingRating = (pendingRating === v) ? 0 : v; // volver a tocar la misma quita
    document.querySelectorAll("#rating-stars .rstar").forEach(s => {
        s.style.color = (+s.dataset.v <= pendingRating) ? "#e8c93a" : "rgba(255,255,255,0.25)";
    });
}
function resetRating() { pendingRating = 0; setRating(0); }

// Abrir la hoja para registrar que has hecho una RUTA (foto/s + valoración + comentario)
function openRutaUpload(nombre) {
    pendingEventId = null; pendingEventName = null;
    pendingRutaName = nombre;
    document.getElementById("sht-title").textContent = "🥾 " + nombre;
    document.getElementById("sht-sub").textContent = "Valórala, comenta y sube tus fotos 📸";
    const bd = document.getElementById("btn-desmarcar"); if (bd) bd.style.display = "none";
    document.getElementById("btn-conf").textContent = "Publicar";
    clearPhoto();
    const desc = document.getElementById("evidencia-desc");
    if (desc) { desc.value = ""; desc.placeholder = "Cuenta qué tal la ruta... (opcional)"; }
    const locs = document.getElementById("sheet-locs");
    if (locs) { locs.style.display = "none"; locs.innerHTML = ""; }
    const rt = document.getElementById("sheet-rating");
    if (rt) rt.style.display = "block";
    resetRating();
    if (typeof setVis === "function") setVis("amigos");
    const sh = document.getElementById("upload-sheet");
    sh.style.position = "fixed";
    sh.style.zIndex = "400";
    sh.classList.add("open");
}

async function confirmRutaPhoto() {
    if (!pendingRutaName || !state.user) return;
    const btn = document.getElementById("btn-conf");
    const muni = "🥾 " + pendingRutaName;
    const desc = (document.getElementById("evidencia-desc")?.value || "").trim() || null;
    const rating = pendingRating || null;
    if (!state.pendingPhotos.length && !desc && !rating) {
        return void toast("Añade una foto, una valoración o un comentario", "info");
    }
    btn.textContent = "Publicando..."; btn.disabled = !0;
    try {
        const now = new Date();
        const baseExtra = () => ({
            user_id: state.user.id, municipio: muni, visibilidad: selectedVisibilidad || "amigos",
            fecha: now.toISOString().split("T")[0],
            hora: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
        });
        // Inserta una fila de photos por cada foto; si no hay fotos, una fila text_only
        const insertRow = async (extra) => {
            let r = await db.from("photos").insert({ ...baseExtra(), ...extra });
            if (r.error && /rating|batch_id|thumb_path|column|schema cache/i.test(r.error.message || "")) {
                const { rating: _r, batch_id: _b, thumb_path: _t, ...noExtra } = extra;
                r = await db.from("photos").insert({ ...baseExtra(), ...noExtra });
            }
            return r;
        };
        if (state.pendingPhotos.length) {
            const sess = (await db.auth.getSession()).data?.session?.user;
            const uid = (sess?.id) || state.user.id;
            const batchId = (self.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(16).slice(2)));
            for (let idx = 0; idx < state.pendingPhotos.length; idx++) {
                const ph = state.pendingPhotos[idx];
                try {
                    const b64 = ph.base64.split(",")[1], mime = ph.mime || "image/jpeg";
                    const bin = atob(b64), chunks = [];
                    for (let j = 0; j < bin.length; j += 512) { const sl = bin.slice(j, j + 512), u8 = new Uint8Array(sl.length); for (let k = 0; k < sl.length; k++) u8[k] = sl.charCodeAt(k); chunks.push(u8); }
                    const blob = new Blob(chunks, { type: mime });
                    const path = `${uid}/rutas/${Date.now()}_${idx}.${mime.includes("png") ? "png" : "jpg"}`;
                    const { error: upErr } = await db.storage.from("evidencias").upload(path, blob, { contentType: mime, cacheControl: "3600", upsert: !1 });
                    if (upErr) { toast("No se pudo subir una foto: " + (upErr.message || ""), "error"); continue; }
                    // Miniatura ANTES de insertar, para guardar thumb_path (feed ligero)
                    let thumbPath = null;
                    try {
                        const td = await dataUrlToThumb(ph.base64, 960, 0.78);
                        if (td) {
                            const tb = await (await fetch(td)).blob();
                            const tp = path.replace(/\.(jpg|jpeg|png)$/i, "") + "_thumb.jpg";
                            const { error: te } = await db.storage.from("evidencias").upload(tp, tb, { contentType: "image/jpeg", cacheControl: "3600", upsert: !0 });
                            if (!te) thumbPath = tp;
                        }
                    } catch (_) {}
                    await insertRow({ storage_path: path, thumb_path: thumbPath, descripcion: idx === 0 ? desc : null, rating: idx === 0 ? rating : null, batch_id: batchId });
                } catch (perr) { console.error("ruta foto idx " + idx + ":", perr); }
            }
        } else {
            // Solo valoración / comentario (sin foto): fila text_only
            await insertRow({ storage_path: "text_only", descripcion: desc, rating: rating });
        }
        state.feedCache = null;
        closeUploadSheet();
        clearPhoto();
        resetRating();
        toast("¡Ruta publicada! 🥾", "success");
        switchScreen("feed");
        setTimeout(() => setFeedFilter("rutas"), 60);
    } catch (e) {
        toast("Error: " + e.message, "error");
    } finally {
        btn.textContent = "Publicar"; btn.disabled = !1;
        pendingRutaName = null;
    }
}

function openEventFotoSheet(e, t) {
    pendingRutaName = null;
    pendingEventId = e;
    pendingEventName = t;
    const _rt = document.getElementById("sheet-rating"); if (_rt) _rt.style.display = "none";
    document.getElementById("sht-title").textContent = t;
    document.getElementById("sht-sub").textContent = "Sube una foto de la fiesta 📸";
    document.getElementById("btn-desmarcar").style.display = "none";
    document.getElementById("btn-conf").textContent = "Publicar foto";
    clearPhoto();
    const desc = document.getElementById("evidencia-desc");
    if (desc) desc.value = "";
    // Ocultar el checklist de localidades (es de municipios, no de eventos)
    const locs = document.getElementById("sheet-locs");
    if (locs) { locs.style.display = "none"; locs.innerHTML = ""; }
    // Abrir la hoja como OVERLAY que flota sobre la pantalla actual
    // (Eventos), en vez de saltar al mapa
    const sh = document.getElementById("upload-sheet");
    sh.style.position = "fixed";
    sh.style.zIndex = "400";
    sh.classList.add("open");
}
async function confirmEventPhoto() {
    if (!pendingEventId || !state.user) return;
    const e = document.getElementById("btn-conf");
    e.textContent = "Subiendo...", e.disabled = !0;
    try {
        let t = null;
        if (state.pendingBase64 && state.pendingMime) {
            // pendingBase64 ya es una data-URL completa
            const e = await fetch(state.pendingBase64).then(e => e.blob()),
                i = state.user.id + "/eventos/" + pendingEventId + "_" + Date.now() + ".jpg",
                {
                    error: n
                } = await db.storage.from("evidencias").upload(i, e, {
                    contentType: state.pendingMime
                });
            n || (t = i)
        }
        if (!t) return toast("Añade una foto antes de publicar", "info"), e.textContent = "Publicar foto", void(e.disabled = !1);
        try { await db.from("event_photos").insert({
            user_id: state.user.id,
            event_id: pendingEventId,
            storage_path: t,
            descripcion: document.getElementById("evidencia-desc").value.trim() || null
        }); } catch (epErr) { console.warn("event_photos:", epErr); }
        await db.from("photos").insert({
            user_id: state.user.id,
            municipio: "🎉 " + pendingEventName,
            storage_path: t,
            descripcion: document.getElementById("evidencia-desc").value.trim() || null,
            visibilidad: "amigos",
            fecha: (new Date).toISOString().split("T")[0],
            hora: (new Date).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit"
            })
        }), state.feedCache = null, closeUploadSheet(), pendingEventId = null, pendingEventName = null, state.pendingFile = state.pendingBase64 = state.pendingMime = null, clearPhoto(), renderEventos(), toast("¡Foto del evento publicada! 🎉", "success")
    } catch (e) {
        toast("Error: " + e.message, "error")
    } finally {
        e.textContent = "Publicar foto", e.disabled = !1
    }
}
const COMARCAS = ["Costa Occidental", "Saja-Nansa", "Liébana", "Besaya", "Campoo", "Valles Pasiegos", "Trasmiera", "Bahía de Santander", "Asón-Agüera", "Costa Oriental"],
    COAST_MUNIS = ["Santander", "Castro-Urdiales", "Santoña", "Laredo", "Comillas", "San Vicente de la Barquera", "Suances", "Miengo", "Piélagos", "Camargo", "El Astillero", "Noja", "Bareyo", "Arnuero", "Colindres", "Limpias", "Marina de Cudeyo", "Ribamontán al Mar", "Escalante", "Argoños", "Meruelo", "Voto"],
    LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.",
    DOT_POS = {
        1: [
            [60, 60]
        ],
        2: [
            [35, 35],
            [85, 85]
        ],
        3: [
            [35, 35],
            [60, 60],
            [85, 85]
        ],
        4: [
            [35, 35],
            [85, 35],
            [35, 85],
            [85, 85]
        ],
        5: [
            [35, 35],
            [85, 35],
            [60, 60],
            [35, 85],
            [85, 85]
        ],
        6: [
            [35, 32],
            [85, 32],
            [35, 60],
            [85, 60],
            [35, 88],
            [85, 88]
        ]
    };

function renderDice(e, t) {
    const i = document.getElementById("dice-dots");
    i.innerHTML = "", document.getElementById("dice-body").setAttribute("fill", t || "#f5f0e8"), (DOT_POS[e] || []).forEach(([e, t]) => {
        const n = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        n.setAttribute("cx", e), n.setAttribute("cy", t), n.setAttribute("r", "7"), n.setAttribute("fill", "#1a1a2e"), i.appendChild(n)
    })
}

function isCoast(e) {
    if (!e) return false;
    const nl = e.toLowerCase();
    // Los Corrales de Buelna es MONTAÑA, diga lo que diga la BD
    if (nl.includes('corrales de buelna') || nl.includes('los corrales')) return false;
    // Después manda la BD (Supabase > municipios > tipo); luego la lista
    const md = state.municipiosData?.[e];
    if (md?.tipo) return md.tipo === 'costa';
    return COAST_MUNIS.some(t => nl.includes(t.toLowerCase()));
}

function rollDice() {
    if (state.rolling) return;
    state.rolling = !0, document.getElementById("dice-hint").textContent = "Lanzando...", document.getElementById("result-wrap").classList.remove("show"), document.getElementById("no-more").style.display = "none";
    const e = document.getElementById("dice-svg");
    e.classList.remove("rolling"), e.offsetWidth, e.classList.add("rolling");
    let t = 0;
    const i = setInterval(() => {
        if (renderDice(Math.floor(6 * Math.random()) + 1), t++, t >= 12) {
            clearInterval(i), e.classList.remove("rolling");
            const t = Math.floor(6 * Math.random()) + 1;
            renderDice(t), state.rolling = !1, showDiceResult(t)
        }
    }, 55)
}

function showDiceResult(e) {
    const t = e % 2 == 0;
    document.getElementById("badge-coast").classList.toggle("inactive-badge", !t), document.getElementById("badge-mount").classList.toggle("inactive-badge", t);
    const i = (t ? state.coast : state.mountain).filter(e => !state.visited[e]),
        n = t ? state.coast : state.mountain;
    if (!n.length) return void(document.getElementById("no-more").style.display = "block");
    const o = (i.length ? i : n)[Math.floor(Math.random() * (i.length || n.length))],
        a = state.municipiosData?.[o] || {};
    renderDice(e, t ? "#dce8f5" : "#d5ede3"), document.getElementById("rtop").className = "rcard-top " + (t ? "coast" : "mount");
    const s = document.getElementById("rtag");
    s.className = "r-type-tag " + (t ? "tag-coast" : "tag-mount"), s.querySelector("i").className = "ti " + (t ? "ti-waves" : "ti-mountain"), document.getElementById("rtag-txt").textContent = t ? "Costa" : "Montaña", document.getElementById("r-num").textContent = e, document.getElementById("r-muni").textContent = o, document.getElementById("r-comarca").textContent = "Comarca de " + (a.comarca || COMARCAS[Math.floor(Math.random() * COMARCAS.length)]), document.getElementById("r-area").textContent = a.area_km2 ? a.area_km2 + " km²" : Math.round(200 * Math.random() + 5) + " km²", document.getElementById("r-pop").textContent = a.poblacion ? a.poblacion.toLocaleString("es-ES") + " hab." : Math.round(3e4 * Math.random() + 100).toLocaleString("es-ES") + " hab.", document.getElementById("r-desc").textContent = a.descripcion || LOREM, document.getElementById("dice-hint").textContent = i.length ? "¡Tu próxima aventura te espera!" : "Ya lo visitaste — aquí de nuevo", setTimeout(() => document.getElementById("result-wrap").classList.add("show"), 60), document.getElementById("btn-go").onclick = () => {
        switchScreen("map");
        setTimeout(() => highlightMuniOnMap(o), 300);
    };
    const r = document.getElementById("btn-saber-mas");
    r && (r.onclick = () => openMuniModal(o))
}
let muniListFilter = "todos";

function filterMuniList(e) {
    e && (muniListFilter = e, document.querySelectorAll('[id^="mf-"]').forEach(t => {
        const i = t.id === "mf-" + e.replace("/", "_");
        t.style.backgroundColor = i ? "#e8b820" : "rgba(255,255,255,0.08)", t.style.color = i ? "#fff" : "rgba(255,255,255,0.5)"
    }), "todos" === e && (document.getElementById("mf-todos").style.backgroundColor = "#e8b820", document.getElementById("mf-todos").style.color = "#fff")), renderMuniList()
}

function renderMuniList() {
    const e = document.getElementById("muni-list");
    if (!e) return;
    const t = (document.getElementById("muni-search")?.value || "").toLowerCase().trim(),
        i = Object.values(state.municipiosData || {}).filter(e => !(t && !e.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) && ("todos" === muniListFilter || ("costa" === muniListFilter ? "costa" === e.tipo : "montaña" === muniListFilter ? "montaña" === e.tipo : "populares" === muniListFilter ? (state.popularidad?.[e.nombre] || 0) > 0 : (e.sellos || []).includes(muniListFilter)))).sort((e, t) => "populares" === muniListFilter ? (state.popularidad?.[t.nombre] || 0) - (state.popularidad?.[e.nombre] || 0) : e.nombre.localeCompare(t.nombre));
    i.length ? e.innerHTML = i.map(e => {
        const t = state.visited[e.nombre],
            i = "costa" === e.tipo,
            n = state.popularidad?.[e.nombre] || 0,
            o = (e.sellos || []).slice(0, 3).map(e => SELLOS[e]?.emoji || "").join(" "),
            a = n > 0 ? '<span style="font-size:10px;color:#e8b820;background:rgba(232,184,32,0.12);padding:2px 7px;border-radius:999px">🔥 ' + n + "</span>" : "";
        return `\n    <div onclick="openMuniModal('${e.nombre.replace(/'/g,"'")}')"\n      style="display:flex;align-items:center;gap:12px;padding:11px 12px;background:#141e2c;border-radius:14px;margin-bottom:6px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);">\n      <div style="width:44px;height:44px;border-radius:10px;background:${i?"#0d2a4a":"#0d2a1e"};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;position:relative">\n        <i class="ti ${i?"ti-waves":"ti-mountain"}" aria-hidden="true" style="font-size:18px;color:${i?"#85B7EB":"#5DCAA5"}"></i>\n        ${e.imagen_url ? `<img src="${esc(e.imagen_url)}" loading="lazy" decoding="async" alt="${esc(e.nombre)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block" onerror="this.remove()"/>` : ""}\n      </div>\n      <div style="flex:1;min-width:0">\n        <div style="font-size:14px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.nombre} ${o}</div>\n        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px">${e.comarca||""}</div>\n      </div>\n      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">\n        ${a}\n        ${t?'<span style="width:8px;height:8px;border-radius:50%;background:#22b050;display:block"></span>':""}\n        <i class="ti ti-chevron-right" aria-hidden="true" style="font-size:16px;color:rgba(255,255,255,0.2)"></i>\n      </div>\n    </div>`
    }).join("") : e.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px;text-align:center;padding:20px 0">No se encontraron municipios</p>'
}

function openMuniModal(e) {
    if (!e) return;
    state.currentMuni = e;
    if (!state.municipiosData) return void db.from("municipios").select("*").then(({
        data: t
    }) => {
        t && (state.municipiosData = {}, t.forEach(e => {
            state.municipiosData[e.nombre] = e
        }), state.coast = t.filter(e => "costa" === e.tipo).map(e => e.nombre), state.mountain = t.filter(e => "montaña" === e.tipo).map(e => e.nombre)), openMuniModal(e)
    });
    const t = state.municipiosData[e] || {
            nombre: e,
            tipo: isCoast(e) ? "costa" : "montaña"
        },
        i = "costa" === t.tipo,
        n = state.visited[e],
        o = document.getElementById("mm-img-wrap"),
        a = document.getElementById("mm-img");
    const hdr = document.getElementById("mm-header"),
        hdrContent = document.getElementById("mm-header-content");
    if (t.imagen_url && o && a) {
        // Con foto: el bloque de color se superpone translúcido y deja
        // ver la imagen detrás (degradado de abajo hacia arriba)
        a.src = t.imagen_url;
        o.style.display = "block";
        hdr.style.background = "transparent";
        if (hdrContent) {
            hdrContent.style.marginTop = "-85px";
            hdrContent.style.position = "relative";
            hdrContent.style.background = i
                ? "linear-gradient(to top, rgba(13,30,50,0.96) 35%, rgba(13,30,50,0.55) 70%, rgba(13,30,50,0.05) 100%)"
                : "linear-gradient(to top, rgba(13,32,22,0.96) 35%, rgba(13,32,22,0.55) 70%, rgba(13,32,22,0.05) 100%)";
        }
    } else {
        if (o) o.style.display = "none";
        hdr.style.background = i ? "linear-gradient(135deg,rgba(13,42,74,0.55),rgba(21,58,96,0.55))" : "linear-gradient(135deg,rgba(13,42,30,0.55),rgba(21,48,32,0.55))";
        if (hdrContent) { hdrContent.style.marginTop = "0"; hdrContent.style.background = "none"; }
    }
    const s = document.getElementById("mm-badge");
    s.innerHTML = `<i class="ti ${i?"ti-waves":"ti-mountain"}" aria-hidden="true" style="font-size:10px"></i> ${i?"Costa":"Montaña"}`, s.style.background = i ? "rgba(56,138,221,0.25)" : "rgba(29,158,117,0.25)", s.style.color = i ? "#85B7EB" : "#5DCAA5", document.getElementById("mm-name").textContent = e, document.getElementById("mm-comarca").textContent = t.comarca ? "Comarca de " + t.comarca : "";
    const r = [];
    t.poblacion && r.push('<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.1);border-radius:999px;padding:4px 10px;font-size:11px;color:rgba(255,255,255,0.7)"><i class="ti ti-users" aria-hidden="true" style="font-size:11px"></i>' + t.poblacion.toLocaleString("es-ES") + " hab.</div>"), t.area_km2 && r.push('<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.1);border-radius:999px;padding:4px 10px;font-size:11px;color:rgba(255,255,255,0.7)"><i class="ti ti-ruler-2" aria-hidden="true" style="font-size:11px"></i>' + t.area_km2 + " km²</div>"), n && r.push('<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(34,176,80,0.2);border-radius:999px;padding:4px 10px;font-size:11px;color:#22b050"><i class="ti ti-check" aria-hidden="true" style="font-size:11px"></i>Conquistado</div>');
    (t.sellos || []).forEach(e => {
        const t = SELLOS[e];
        t && r.push('<div style="display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 10px;font-size:11px;color:#fff;background:' + t.color + "22;border:1px solid " + t.color + '44">' + t.emoji + " " + t.label + "</div>")
    });
    t.ruta && String(t.ruta).trim() && r.push('<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(93,202,165,0.15);border-radius:999px;padding:4px 10px;font-size:11px;color:#5DCAA5">🥾 Con ruta</div>');
    const d = state.popularidad?.[e] || 0;
    d > 0 && r.push('<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(232,184,32,0.15);border-radius:999px;padding:4px 10px;font-size:11px;color:#e8b820">🔥 ' + d + " visitas</div>"), document.getElementById("mm-pills").innerHTML = r.join(" "), document.getElementById("mm-desc").textContent = t.descripcion || "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.", document.getElementById("mm-curiosidad").textContent = t.curiosidad || "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
    // Estado del botón de wishlist
    updateWishBtn(e);

    // Apartado de localidades (columna "localidades" de municipios)
    let locEl = document.getElementById("mm-localidades");
    if (!locEl) {
        locEl = document.createElement("div");
        locEl.id = "mm-localidades";
        const curEl0 = document.getElementById("mm-curiosidad");
        curEl0?.parentNode?.insertBefore(locEl, curEl0.nextSibling);
    }
    const fichaLocs = t.localidades || [];
    if (fichaLocs.length) {
        const mias = new Set(state.visitedLocs?.[e] || []);
        const pisadas = fichaLocs.filter(l => mias.has(l)).length;
        locEl.style.cssText = "margin:12px 0;padding:11px 13px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px";
        locEl.innerHTML =
            '<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">🏘️ Localidades <span style="color:#5DCAA5">' + pisadas + '/' + fichaLocs.length + '</span></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
            + fichaLocs.map(l => mias.has(l)
                ? '<span style="padding:5px 11px;border-radius:999px;font-size:12px;background:rgba(34,176,80,0.15);border:1px solid rgba(34,176,80,0.45);color:#5DCAA5">✓ ' + esc(l) + '</span>'
                : '<span style="padding:5px 11px;border-radius:999px;font-size:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.55)">' + esc(l) + '</span>'
            ).join("") + '</div>';
        locEl.style.display = "block";
    } else {
        locEl.style.display = "none";
    }

    // Bloque de ruta (columna "ruta" de municipios en Supabase)
    let rutaEl = document.getElementById("mm-ruta");
    if (!rutaEl) {
        rutaEl = document.createElement("div");
        rutaEl.id = "mm-ruta";
        const curEl = document.getElementById("mm-curiosidad");
        curEl?.parentNode?.insertBefore(rutaEl, curEl.nextSibling);
    }
    if (t.ruta && String(t.ruta).trim()) {
        rutaEl.style.cssText = "margin:12px 0;padding:11px 13px;background:rgba(93,202,165,0.08);border:1px solid rgba(93,202,165,0.25);border-radius:12px";
        rutaEl.innerHTML = '<div style="font-size:11px;font-weight:600;color:#5DCAA5;margin-bottom:4px;letter-spacing:.05em;text-transform:uppercase">🥾 Ruta</div><div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.5">' + esc(t.ruta) + '</div>';
        rutaEl.style.display = "block";
    } else {
        rutaEl.style.display = "none";
    }
    const l = t.visitas || ["Lugar de interés 1 — Lorem ipsum dolor sit amet.", "Lugar de interés 2 — Ut enim ad minim veniam quis.", "Lugar de interés 3 — Duis aute irure dolor reprehenderit."];
    document.getElementById("mm-visitas").innerHTML = l.map((e, t) => `\n    <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">\n      <div style="width:24px;height:24px;border-radius:50%;background:rgba(34,176,80,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#22b050;flex-shrink:0">${t+1}</div>\n      <p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.45;margin:0">${e}</p>\n    </div>`).join("");
    const c = t.comer || ["Restaurante 1 — Lorem ipsum especialidad local.", "Restaurante 2 — Ut enim ad minim cocina tradicional.", "Bar / Sidrería 3 — Gastronomía local y productos de temporada."];
    document.getElementById("mm-comer").innerHTML = c.map((e, t) => '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="width:24px;height:24px;border-radius:50%;background:rgba(232,40,138,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#e8288a;flex-shrink:0">' + (t + 1) + '</div><p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.45;margin:0">' + e + "</p></div>").join("");
    const u = document.getElementById("mm-sg-wrap"),
        p = document.getElementById("mm-comer-sg"),
        m = t.comer_sg || [];
    u && p && (m.length ? (u.style.display = "block", p.innerHTML = m.map((e, t) => '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="width:24px;height:24px;border-radius:50%;background:rgba(232,184,32,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0">🌾</div><p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.45;margin:0">' + e + "</p></div>").join("")) : u.style.display = "none"), document.getElementById("mm-btn-mapa").onclick = () => {
        closeMuniModal(), switchScreen("map"), setTimeout(() => selectMuniOnMap(e), 250)
    }, loadMuniGallery(e), loadMuniFriendEvidence(e), loadRecomendaciones(e);
    document.getElementById("muni-modal").style.display = "flex"
}
// Galería del municipio: todas las fotos (tuyas + de amigos) en cuadrícula
async function loadMuniGallery(muni) {
    let cont = document.getElementById("mm-galeria");
    if (!cont) {
        const fe = document.getElementById("mm-friend-evidence");
        if (!fe) return;
        cont = document.createElement("div");
        cont.id = "mm-galeria";
        cont.style.marginBottom = "16px";
        fe.parentNode.insertBefore(cont, fe);
    }
    if (!state.user) { cont.innerHTML = ""; return; }
    cont.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Cargando fotos...</div>';
    try {
        const friends = await getFriendsCache().catch(() => []);
        const nameById = {}; (friends || []).forEach(f => nameById[f.id] = f);
        const ids = [...new Set([...(friends || []).map(f => f.id), state.user.id])];
        let pcols = "id,user_id,municipio,storage_path,thumb_path,descripcion,visibilidad,created_at";
        let { data, error } = await db.from("photos").select(pcols)
            .in("user_id", ids).eq("municipio", muni).neq("storage_path", "text_only")
            .order("created_at", { ascending: !1 }).limit(60);
        if (error && /thumb_path|column|schema cache/i.test(error.message || "")) {
            ({ data } = await db.from("photos").select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at")
                .in("user_id", ids).eq("municipio", muni).neq("storage_path", "text_only")
                .order("created_at", { ascending: !1 }).limit(60));
        }
        const fotos = (data || []).filter(f => f.user_id === state.user.id || ["amigos", "publico"].includes(f.visibilidad))
            .filter(f => !state.blockedIds?.has(f.user_id));
        if (!fotos.length) { cont.innerHTML = ""; return; }
        const paths = [...new Set([...fotos.map(f => f.thumb_path).filter(Boolean), ...fotos.map(f => f.storage_path).filter(Boolean)])];
        const urls = await signPaths(paths);
        const cells = fotos.map(f => {
            const turl = f.thumb_path ? urls[f.thumb_path] : null;
            const furl = urls[f.storage_path] || null;
            const u = f.user_id === state.user.id ? (state.profile?.username || "Tú") : (nameById[f.user_id]?.username || "Amigo");
            const av = f.user_id === state.user.id ? state.profile?.avatar_url : nameById[f.user_id]?.avatar_url;
            const badge = av
                ? '<img src="' + esc(av) + '" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1.5px solid #0f1923" alt="' + esc(u) + '"/>'
                : '<div style="width:20px;height:20px;border-radius:50%;background:#1a2535;border:1.5px solid #0f1923;display:flex;align-items:center;justify-content:center;font-size:8px;color:#9cc4f0">' + esc(getInitials(u)) + '</div>';
            return '<div onclick="openPhotoLightbox(this.dataset.full, this.dataset.u)" data-full="' + esc(furl || turl || "") + '" data-u="' + esc(u) + '" style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;background:#0d2030">'
                + '<img src="' + esc(turl || furl || "") + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"' + (turl && furl ? ' onerror="this.onerror=null;this.src=\'' + esc(furl) + '\'"' : '') + ' alt="' + esc(u) + '"/>'
                + '<div title="' + esc(u) + '" style="position:absolute;bottom:4px;right:4px">' + badge + '</div></div>';
        }).join("");
        cont.innerHTML = '<div style="margin-bottom:10px;font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;letter-spacing:.05em;text-transform:uppercase">📸 Fotos del municipio (' + fotos.length + ')</div>'
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' + cells + '</div>';
    } catch (err) { console.error("loadMuniGallery:", err); cont.innerHTML = ""; }
}

// Visor de foto a pantalla completa
function openPhotoLightbox(url, who) {
    if (!url) return;
    let ov = document.getElementById("photo-lightbox");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "photo-lightbox";
        ov.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px";
        ov.onclick = () => { ov.style.display = "none"; };
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<img src="' + esc(url) + '" style="max-width:100%;max-height:82vh;border-radius:12px;object-fit:contain"/>'
        + (who ? '<div style="color:rgba(255,255,255,0.7);font-size:13px">' + esc(who) + '</div>' : '')
        + '<div style="color:rgba(255,255,255,0.35);font-size:11px">Toca para cerrar</div>';
    ov.style.display = "flex";
}

async function loadMuniFriendEvidence(e) {
    const t = document.getElementById("mm-friend-evidence");
    if (!t) return;
    if (t.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Buscando evidencias de amigos...</div>', !state.user) return;
    const {
        data: i
    } = await db.from("friendships").select("follower_id, following_id").or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado"), n = (i || []).map(e => e.follower_id === state.user.id ? e.following_id : e.follower_id);
    if (!n.length) return void(t.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Ningún amigo ha visitado este municipio aún.</div>');
    const {
        data: o
    } = await db.from("visits").select("*, profiles(id, username, avatar_url)").in("user_id", n).eq("municipio", e).order("created_at", {
        ascending: !1
    }), {
        data: a
    } = await db.from("photos").select("*").in("user_id", n).eq("municipio", e).neq("storage_path", "text_only").order("created_at", {
        ascending: !1
    });
    if (!o || !o.length) return void(t.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Ningún amigo ha visitado este municipio aún.</div>');
    const s = {};
    (a || []).forEach(e => { s[e.user_id] = e });

    // URLs firmadas en lote
    const evPaths = [...new Set((a || []).filter(f => f.storage_path && "text_only" !== f.storage_path).map(f => f.storage_path))];
    const evUrls = {};
    if (evPaths.length) {
        const { data: signed } = await db.storage.from("evidencias").createSignedUrls(evPaths, 3600);
        (signed || []).forEach(x => { if (x.signedUrl) evUrls[x.path] = x.signedUrl; });
    }

    const r = '<div style="margin-bottom:10px;font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;letter-spacing:.05em;text-transform:uppercase">' + o.length + " amigo" + (1 !== o.length ? "s" : "") + " han visitado este municipio</div>",
        d = o.map(e => {
            const u    = e.profiles?.username || "Usuario";
            const av   = e.profiles?.avatar_url;
            const foto = s[e.user_id];
            const img  = foto && "text_only" !== foto.storage_path ? evUrls[foto.storage_path] : null;
            const fecha = new Date(e.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
            return '<div style="background:rgba(255,255,255,0.04);border-radius:12px;overflow:hidden;margin-bottom:10px;border:1px solid rgba(255,255,255,0.07)">'
                + (img ? '<img src="' + esc(img) + '" style="width:100%;height:140px;object-fit:cover;display:block" alt="' + esc(u) + '"/>' : "")
                + '<div style="padding:10px 12px;display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:#1a2535;border:1.5px solid #e86820;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#e86820;flex-shrink:0;overflow:hidden">'
                + (av ? '<img src="' + esc(av) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(u) + '"/>' : getInitials(u))
                + '</div><div style="flex:1"><div style="font-size:13px;font-weight:500;color:#fff">' + esc(u) + '</div><div style="font-size:11px;color:rgba(255,255,255,0.35)">Visitó el ' + fecha + "</div></div></div>"
                + (foto && foto.descripcion ? '<div style="padding:0 12px 10px;font-size:13px;color:rgba(255,255,255,0.6)">' + renderMentions(esc(foto.descripcion)) + "</div>" : "")
                + "</div>";
        }).join("");
    t.innerHTML = r + d
}

function closeMuniModal() {
    document.getElementById("muni-modal").style.display = "none"
}
async function loadFeed(reset = !1) {
    if (!state.user) return;
    state._feedMode = null;
    const _sr = document.getElementById("stories-row"); if (_sr) _sr.style.display = "";
    clearGlobalRanking();
    if (!reset && state.feedCache && Date.now() - state.feedCacheTime < 18e4) return void renderFeedFromCache();

    const fp = document.getElementById("feed-posts");
    fp.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 10px"></div>Cargando feed...</div>';

    // Amigos aceptados → autores del feed
    const { data: fs } = await db.from("friendships")
        .select("follower_id,following_id")
        .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
        .eq("estado", "aceptado");
    const fids = [...new Set((fs || []).map(f => f.follower_id === state.user.id ? f.following_id : f.follower_id))];
    let perfiles = [];
    if (fids.length) {
        const { data: pr } = await db.from("profiles").select("id,username,avatar_url").in("id", fids);
        perfiles = pr || [];
    }
    renderStories(perfiles);

    state.feedCache = {
        visibleVisits: [],
        fotasByMuniUser: {},
        fotasByUser: {},
        friendProfiles: perfiles,
        authors: [...new Set([...fids, state.user.id])].filter(id => !state.blockedIds?.has(id)),
        cursor: null,
        done: !1,
        loading: !1,
        _fotoSeen: new Set()
    };
    state.feedCacheTime = Date.now();
    fp.innerHTML = "";
    ensureFeedSentinel();
    await fetchFeedPage();
}

const FEED_PAGE_SIZE = 10;

async function loadGlobalFeed() {
    if (!state.user) return;
    const fp = document.getElementById("feed-posts");
    document.getElementById("stories-row").innerHTML = "";
    state.feedCache = {
        mode: "global", visibleVisits: [], fotasByMuniUser: {}, fotasByUser: {},
        friendProfiles: [], authors: [], cursor: null, done: !1, loading: !1, _fotoSeen: new Set()
    };
    state.feedCacheTime = Date.now();
    fp.innerHTML = "";
    renderGlobalRanking();   // 🏆 Top 10 (no bloquea la carga de publicaciones)
    ensureFeedSentinel();
    await fetchFeedPage();
}

// Quita el bloque del ranking (al salir de Global)
function clearGlobalRanking() {
    document.getElementById("global-ranking")?.remove();
}

// 🏆 Top 10 exploradores — por nº de municipios conquistados.
// Usa la función RPC "ranking_exploradores" de Supabase (ver SQL).
// Si la RPC no existe todavía, simplemente no muestra el ranking.
async function renderGlobalRanking() {
    clearGlobalRanking();
    const fp = document.getElementById("feed-posts");
    if (!fp) return;
    const box = document.createElement("div");
    box.id = "global-ranking";
    box.style.cssText = "margin:0 12px 16px";
    box.innerHTML = '<div style="text-align:center;padding:14px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="width:16px;height:16px;border-width:2px;margin:0 auto 6px"></div>Cargando ranking...</div>';
    fp.parentNode.insertBefore(box, fp);

    let rows = null;
    try {
        const { data, error } = await db.rpc("ranking_exploradores", { lim: 10 });
        if (!error && Array.isArray(data)) rows = data;
        else if (error) console.warn("ranking_exploradores:", error.message);
    } catch (err) { console.warn("ranking RPC no disponible:", err); }

    if (!rows || !rows.length) { box.remove(); return; }
    rows = rows.filter(r => !state.blockedIds?.has(r.user_id)).slice(0, 10);
    if (!rows.length) { box.remove(); return; }

    const medal = i => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
    box.innerHTML =
        '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;overflow:hidden">'
      + '<div style="padding:13px 15px 10px;display:flex;align-items:center;gap:7px;border-bottom:1px solid rgba(255,255,255,0.06)">'
      +   '<span style="font-size:16px">🏆</span>'
      +   '<span style="font-family:\'Playfair Display\',serif;font-size:15px;font-weight:700;color:#fff">Top exploradores</span>'
      +   '<span style="margin-left:auto;font-size:10px;color:rgba(255,255,255,0.35)">municipios conquistados</span>'
      + '</div>'
      + rows.map((r, i) => {
            const uname = esc(r.username || "Usuario");
            const av = r.avatar_url
                ? '<img src="' + esc(r.avatar_url) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover" alt="' + uname + '" onerror="this.style.display=\'none\'"/>'
                : '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:11px;font-family:\'Playfair Display\',serif;color:#fff">' + esc(getInitials(r.username || "U")) + '</div>';
            const me = r.user_id === state.user?.id;
            return '<div data-uid="' + esc(r.user_id) + '" data-uname="' + uname + '" onclick="openFriendProfile(this.dataset.uid, this.dataset.uname)" '
                 + 'style="display:flex;align-items:center;gap:10px;padding:9px 15px;cursor:pointer' + (me ? ';background:rgba(34,114,232,0.08)' : '') + (i < rows.length - 1 ? ';border-bottom:1px solid rgba(255,255,255,0.04)' : '') + '">'
                 + '<span style="width:24px;text-align:center;font-size:14px;font-weight:700;color:' + (i < 3 ? '#e8c93a' : 'rgba(255,255,255,0.4)') + '">' + medal(i) + '</span>'
                 + av
                 + '<span style="flex:1;font-size:13px;font-weight:500;color:#fff">' + uname + (me ? ' <span style="font-size:10px;color:#7ab3e8">(tú)</span>' : '') + '</span>'
                 + '<span style="font-size:13px;font-weight:700;color:#22b050">' + (r.total || 0) + '</span>'
                 + '</div>';
        }).join("")
      + '</div>';
}

// Centinela al final del feed: cuando entra en pantalla, carga más
function ensureFeedSentinel() {
    let s = document.getElementById("feed-sentinel");
    if (!s) {
        s = document.createElement("div");
        s.id = "feed-sentinel";
        s.style.cssText = "padding:18px 12px 26px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px";
        document.getElementById("feed-posts").insertAdjacentElement("afterend", s);
        new IntersectionObserver(entries => {
            entries.forEach(x => { if (x.isIntersecting) fetchFeedPage(); });
        }, { rootMargin: "500px" }).observe(s);
    }
    s.textContent = "";
    return s;
}

async function fetchFeedPage() {
    const fc = state.feedCache;
    if (!fc || fc.loading || fc.done || !state.user) return;
    fc.loading = !0;
    const sent = document.getElementById("feed-sentinel");
    if (sent) sent.innerHTML = '<div class="spin" style="width:18px;height:18px;border-width:2px;margin:0 auto"></div>';
    try {
        if (fc.mode === "global") {
            // ── Feed global: TODO lo público (descubrimiento + eventos + rutas), agrupado por lote ──
            const gcols = "id,user_id,municipio,storage_path,thumb_path,descripcion,rating,visibilidad,created_at,batch_id";
            let qg = db.from("photos").select(gcols)
                .eq("visibilidad", "publico")
                .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE * 4);
            if (fc.cursor) qg = qg.lt("created_at", fc.cursor);
            let rg = await qg;
            if (rg.error && /rating|batch_id|thumb_path|column|schema cache/i.test(rg.error.message || "")) {
                let qg2 = db.from("photos")
                    .select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at")
                    .eq("visibilidad", "publico")
                    .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE * 4);
                if (fc.cursor) qg2 = qg2.lt("created_at", fc.cursor);
                rg = await qg2;
            }
            fc._seenPhotoIds = fc._seenPhotoIds || new Set();
            fc._seenBatch = fc._seenBatch || new Set();
            const keyOf = p => p.batch_id ? ("b:" + p.batch_id) : ("t:" + p.user_id + ":" + normalizeMuni(p.municipio) + ":" + String(p.created_at || "").slice(0, 16));
            const gpAll = (rg.data || []).filter(f => !state.blockedIds?.has(f.user_id));
            const gp = gpAll.filter(p => !fc._seenPhotoIds.has(p.id) && !fc._seenBatch.has(keyOf(p)));
            if (!gp.length) {
                fc.done = !0;
                if (sent) sent.textContent = fc.visibleVisits.length ? "🏔️ Has llegado al final" : "";
                if (!fc.visibleVisits.length) document.getElementById("feed-posts").innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px">🌍 Aún no hay fotos públicas</div>';
                return;
            }
            const uids = [...new Set(gp.map(f => f.user_id))];
            let profs = [];
            if (uids.length) { const { data: pp } = await db.from("profiles").select("id,username,avatar_url").in("id", uids); profs = pp || []; }
            const pById = {};
            profs.forEach(p => { pById[p.id] = p; });
            profs.forEach(p => { fc.friendProfiles.find(x => x.id === p.id) || fc.friendProfiles.push(p); });
            const groups = {}, order = [];
            gp.forEach(p => { const k = keyOf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
            let posts = order.map(k => {
                const g = groups[k].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                const imgs = g.filter(x => x.storage_path && x.storage_path !== "text_only");
                const rep = imgs[0] || g[0];
                const newest = g.reduce((m, x) => x.created_at > m ? x.created_at : m, g[0].created_at);
                return { id: "gp_" + k, _batchKey: k, _batchId: rep.batch_id || null, user_id: rep.user_id, municipio: rep.municipio, visibilidad: rep.visibilidad, created_at: newest, profiles: pById[rep.user_id] || null, _fotos: imgs, _foto: rep };
            });
            const rawFull = (rg.data || []).length >= FEED_PAGE_SIZE * 4;
            if (rawFull && posts.length > 1) { let oi = 0; for (let i = 1; i < posts.length; i++) if (posts[i].created_at < posts[oi].created_at) oi = i; posts.splice(oi, 1); }
            posts = posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, FEED_PAGE_SIZE);
            posts.forEach(p => { if (p._batchKey) fc._seenBatch.add(p._batchKey); (p._fotos || []).forEach(f => fc._seenPhotoIds.add(f.id)); if (p._foto) fc._seenPhotoIds.add(p._foto.id); });
            fc.cursor = posts.length ? posts[posts.length - 1].created_at : gpAll.reduce((m, x) => x.created_at < m ? x.created_at : m, gpAll[0].created_at);
            if (gpAll.length < FEED_PAGE_SIZE) fc.done = !0;
            fc.visibleVisits = [...fc.visibleVisits, ...posts];
            await renderFeedPosts(posts, fc.fotasByMuniUser, fc.fotasByUser, fc.friendProfiles, !0);
            if (sent) sent.textContent = fc.done ? (fc.visibleVisits.length ? "🏔️ Has llegado al final" : "") : "";
            return;
        }

        // ── Feed de amigos: cada SUBIDA (lote de fotos) es un post ──
        // Fuente: tabla photos (incluye "text_only" para conquistas sin foto y
        // los eventos con municipio 🎉) + recomendaciones con foto.
        const pcols = "id,user_id,municipio,storage_path,thumb_path,descripcion,visibilidad,created_at,batch_id";
        let qp = db.from("photos").select(pcols)
            .in("user_id", fc.authors)
            .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE * 4);
        let qr = db.from("recomendaciones")
            .select("id,user_id,municipio,nombre,comentario,foto_path,created_at")
            .in("user_id", fc.authors).not("foto_path", "is", null)
            .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE);
        if (fc.cursor) { qp = qp.lt("created_at", fc.cursor); qr = qr.lt("created_at", fc.cursor); }
        let [rp, rr_] = await Promise.all([qp, qr]);
        if (rp.error && /batch_id|thumb_path|column|schema cache/i.test(rp.error.message || "")) {
            // Reintento sin batch_id / thumb_path (aún no migrado)
            let qp2 = db.from("photos")
                .select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at")
                .in("user_id", fc.authors).order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE * 4);
            if (fc.cursor) qp2 = qp2.lt("created_at", fc.cursor);
            rp = await qp2;
        }

        const visible = e => e.user_id === state.user.id || ["amigos", "publico"].includes(e.visibilidad);
        const profById = {};
        fc.friendProfiles.forEach(p => { profById[p.id] = p; });
        if (state.profile) profById[state.user.id] = { id: state.user.id, username: state.profile.username, avatar_url: state.profile.avatar_url };

        fc._seenPhotoIds = fc._seenPhotoIds || new Set();
        fc._seenBatch = fc._seenBatch || new Set();

        // Clave de lote: batch_id si existe; si no (subidas antiguas), agrupamos
        // por usuario+municipio+minuto (las fotos de una misma subida comparten ~minuto).
        const keyOf = p => p.batch_id
            ? ("b:" + p.batch_id)
            : ("t:" + p.user_id + ":" + normalizeMuni(p.municipio) + ":" + String(p.created_at || "").slice(0, 16));
        const ph = (rp.data || []).filter(visible)
            .filter(p => !state.blockedIds?.has(p.user_id))
            .filter(p => !(p.municipio || "").startsWith("🥾"))  // las rutas van en su pestaña
            .filter(p => ["amigos", "publico"].includes(p.visibilidad))  // lo privado solo en su pestaña
            .filter(p => !fc._seenPhotoIds.has(p.id) && !fc._seenBatch.has(keyOf(p)));
        const recs = (rr_.error ? [] : (rr_.data || []))
            .filter(r => !state.blockedIds?.has(r.user_id))
            .filter(r => !fc._seenPhotoIds.has("rec_" + r.id));

        if (!ph.length && !recs.length) {
            fc.done = !0;
            if (sent) sent.textContent = fc.visibleVisits.length ? "🏔️ Has llegado al final" : "";
            if (!fc.visibleVisits.length) await renderFeedPosts([], fc.fotasByMuniUser, fc.fotasByUser, fc.friendProfiles, !1);
            return;
        }

        // Agrupar fotos por LOTE de subida (batch_id). Sin batch_id → 1 post por foto.
        const groups = {}; const order = [];
        ph.forEach(p => { const k = keyOf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
        const photoPosts = order.map(k => {
            const g = groups[k].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const imgs = g.filter(x => x.storage_path && x.storage_path !== "text_only");
            const rep = imgs[0] || g[0];
            const newest = g.reduce((m, x) => x.created_at > m ? x.created_at : m, g[0].created_at);
            return {
                id: "pb_" + k, _batchKey: k, _batchId: rep.batch_id || null,
                user_id: rep.user_id, municipio: rep.municipio,
                visibilidad: rep.visibilidad, created_at: newest,
                profiles: profById[rep.user_id] || null,
                _fotos: imgs, _foto: rep
            };
        });
        const recPosts = recs.map(r => ({
            id: "rec_" + r.id, _tipo: "rec", user_id: r.user_id,
            municipio: r.municipio, visibilidad: "amigos", created_at: r.created_at,
            profiles: profById[r.user_id] || null,
            _fotos: r.foto_path ? [{ id: "rec_" + r.id, user_id: r.user_id, municipio: r.municipio, storage_path: r.foto_path, created_at: r.created_at }] : [],
            _foto: {
                id: "rec_" + r.id, user_id: r.user_id, municipio: r.municipio,
                storage_path: r.foto_path,
                descripcion: "💡 " + r.nombre + (r.comentario ? " — " + r.comentario : ""),
                visibilidad: "amigos", created_at: r.created_at
            }
        }));

        // Si la tanda de fotos vino llena, el lote más antiguo podría estar
        // partido (le faltan fotos en la siguiente página). Lo aplazamos: no lo
        // renderizamos ahora y se reconstruirá completo en la página siguiente.
        const rawFull = (rp.data || []).length >= FEED_PAGE_SIZE * 4;
        if (rawFull && photoPosts.length > 1) {
            let oldestIdx = 0;
            for (let i = 1; i < photoPosts.length; i++) if (photoPosts[i].created_at < photoPosts[oldestIdx].created_at) oldestIdx = i;
            photoPosts.splice(oldestIdx, 1);
        }

        let page = [...photoPosts, ...recPosts]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, FEED_PAGE_SIZE);

        // Marcar como vistos los posts que se renderizan (evita duplicar lotes entre páginas)
        page.forEach(p => {
            if (p._batchKey) fc._seenBatch.add(p._batchKey);
            (p._fotos || []).forEach(f => fc._seenPhotoIds.add(f.id));
            if (p._foto) fc._seenPhotoIds.add(p._foto.id);
        });

        // Cursor por la fecha más antigua renderizada
        const allCreated = [...ph.map(x => x.created_at), ...recs.map(x => x.created_at)];
        fc.cursor = page.length ? page[page.length - 1].created_at
            : allCreated.reduce((m, x) => x < m ? x : m, allCreated[0]);
        if (ph.length < FEED_PAGE_SIZE && recs.length < FEED_PAGE_SIZE) fc.done = !0;

        // Verificación GPS por (usuario, municipio) para el badge
        try {
            const us = [...new Set(page.map(p => p.user_id))];
            const ms = [...new Set(page.map(p => p.municipio).filter(m => m && !m.startsWith("🎉")))];
            if (us.length && ms.length) {
                const { data: vv } = await db.from("visits").select("user_id,municipio,gps_verificada").in("user_id", us).in("municipio", ms);
                const gmap = {};
                (vv || []).forEach(v => { gmap[v.user_id + "|" + normalizeMuni(v.municipio)] = v.gps_verificada; });
                page.forEach(p => { if (!p._tipo) p.gps_verificada = gmap[p.user_id + "|" + normalizeMuni(p.municipio)] || !1; });
            }
        } catch (_) {}

        fc.visibleVisits = [...fc.visibleVisits, ...page];
        await renderFeedPosts(page, fc.fotasByMuniUser, fc.fotasByUser, fc.friendProfiles, !0);
        if (sent) sent.textContent = fc.done ? (fc.visibleVisits.length ? "🏔️ Has llegado al final" : "") : "";
    } catch (err) {
        console.error("fetchFeedPage:", err);
        if (sent) sent.textContent = "Error al cargar más";
    } finally {
        fc.loading = !1;
    }
}

function renderFeedFromCache() {
    const fc = state.feedCache;
    if (!fc) return;
    renderStories(fc.friendProfiles);
    document.getElementById("feed-posts").innerHTML = "";
    ensureFeedSentinel();
    renderFeedPosts(fc.visibleVisits, fc.fotasByMuniUser, fc.fotasByUser, fc.friendProfiles, !1);
    const sent = document.getElementById("feed-sentinel");
    if (sent) sent.textContent = fc.done && fc.visibleVisits.length ? "🏔️ Has llegado al final" : "";
}

function normalizeMuni(e) {
    return (e || "").trim().toLowerCase()
}
const STORY_COLORS = ["#c97ae8", "#7ae8c9", "#e87a9a", "#e8b97a", "#7ab3e8", "#a8e87a"],
    SELLOS = {
        playa_azul: {
            emoji: "🏖️",
            label: "Playa Azul",
            color: "#2272e8"
        },
        picos: {
            emoji: "🏔️",
            label: "Picos",
            color: "#5DCAA5"
        },
        patrimonio: {
            emoji: "🏛️",
            label: "Patrimonio",
            color: "#e8b820"
        },
        cuevas: {
            emoji: "🎨",
            label: "Arte rupestre",
            color: "#c97ae8"
        },
        gastronomico: {
            emoji: "🍽️",
            label: "Gastronómico",
            color: "#e86820"
        },
        festivo: {
            emoji: "🎭",
            label: "Festivo",
            color: "#e8288a"
        }
    };

function renderStories(e) {
    document.getElementById("stories-row").innerHTML = ""
}
async function getPhotoUrl(e) {
    if (!e || "text_only" === e) return null;
    const {
        data: t
    } = await db.storage.from("evidencias").createSignedUrl(e, 3600);
    return t?.signedUrl || db.storage.from("evidencias").getPublicUrl(e).data?.publicUrl || null
}
// ─── Pull-to-refresh del feed ───
function refreshFeedByFilter() {
    if (typeof feedFilter !== "undefined" && feedFilter === "global") return loadGlobalFeed();
    if (typeof feedFilter !== "undefined" && feedFilter === "rutas") return renderRutasFeed();
    return loadFeed(!0);
}
(function setupPullToRefresh() {
    const sc = document.getElementById("feed-sc");
    const ptr = document.getElementById("feed-ptr");
    const txt = document.getElementById("feed-ptr-txt");
    if (!sc || !ptr) return;
    let startY = 0, pulling = !1, dist = 0, refreshing = !1;
    const MAX = 70, TRIGGER = 56;
    sc.addEventListener("touchstart", e => {
        if (refreshing) return;
        if (sc.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = !0; dist = 0; }
        else pulling = !1;
    }, { passive: !0 });
    sc.addEventListener("touchmove", e => {
        if (!pulling || refreshing) return;
        dist = e.touches[0].clientY - startY;
        if (dist <= 0) { ptr.style.height = "0"; return; }
        const h = Math.min(MAX, dist * 0.5);
        ptr.style.height = h + "px";
        if (txt) txt.textContent = h >= TRIGGER * 0.5 ? "↑ Suelta para actualizar" : "↓ Desliza para actualizar";
    }, { passive: !0 });
    sc.addEventListener("touchend", async () => {
        if (!pulling || refreshing) return;
        pulling = !1;
        const trigger = parseFloat(ptr.style.height) >= TRIGGER * 0.5;
        if (trigger) {
            refreshing = !0;
            ptr.style.height = "40px";
            if (txt) txt.textContent = "Actualizando...";
            try { await refreshFeedByFilter(); } catch (_) {}
            refreshing = !1;
        }
        ptr.style.height = "0";
        if (txt) txt.textContent = "↓ Desliza para actualizar";
    });
})();

// Actualiza el contador (1/N) y los puntitos al deslizar el carrusel del feed
function wireCarousels(scope) {
    (scope || document).querySelectorAll(".post-carousel").forEach(c => {
        if (c._wired) return;
        c._wired = !0;
        const n = +c.dataset.n || 1;
        if (n < 2) return;
        const box = c.parentElement;
        const counter = box.querySelector(".cs-counter");
        const dotsEl = box.querySelector(".cs-dots");
        const dots = dotsEl ? [...dotsEl.children] : [];
        let raf = null;
        c.addEventListener("scroll", () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = null;
                const i = Math.max(0, Math.min(n - 1, Math.round(c.scrollLeft / c.clientWidth)));
                if (counter) counter.textContent = (i + 1) + "/" + n;
                dots.forEach((d, di) => d.style.background = di === i ? "#fff" : "rgba(255,255,255,0.4)");
            });
        }, { passive: !0 });
    });
}

async function renderFeedPosts(visits, fotasByMuniUser, fotasByUser, friendProfiles, append = !1) {
    if (!visits.length) {
        if (!append) document.getElementById("feed-posts").innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7"><i class="ti ti-map-2" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>Tus amigos aún no han conquistado municipios.</div>';
        return;
    }

    const pickFoto = v => {
        const fotos = fotasByMuniUser[v.user_id + "|" + normalizeMuni(v.municipio)]
                   || fotasByMuniUser[v.user_id + "_" + normalizeMuni(v.municipio)] || [];
        return fotos.find(f => normalizeMuni(f.municipio) === normalizeMuni(v.municipio)) || fotos[0] || null;
    };

    // Todas las fotos (con imagen) de una publicación, en orden cronológico,
    // para el carrusel. Los posts del feed ya traen su lote en _fotos.
    const allFotos = v => {
        if (v._fotos) return v._fotos.filter(f => f.storage_path && f.storage_path !== "text_only");
        if (v._foto) return (v._foto.storage_path && v._foto.storage_path !== "text_only") ? [v._foto] : [];
        const fotos = fotasByMuniUser[v.user_id + "|" + normalizeMuni(v.municipio)]
                   || fotasByMuniUser[v.user_id + "_" + normalizeMuni(v.municipio)] || [];
        return fotos
            .filter(f => f.storage_path && f.storage_path !== "text_only" && normalizeMuni(f.municipio) === normalizeMuni(v.municipio))
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    };

    const __html = visits.map((v, i) => {
        const coast    = isCoast(v.municipio);
        const isEv     = (v.municipio || "").startsWith("🎉");
        const muniSafe = esc(v.municipio);
        const username = v.profiles?.username || "Usuario";
        const userSafe = esc(username);
        const userId   = v.profiles?.id || v.user_id;
        const color    = STORY_COLORS[i % STORY_COLORS.length];
        const fp       = userId === state.user?.id ? state.profile : (friendProfiles || []).find(f => f.id === userId);
        const avatarUrl  = fp?.avatar_url || v.profiles?.avatar_url;
        const avatarHtml = avatarUrl
            ? `<img src="${esc(avatarUrl)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${userSafe}"/>`
            : getInitials(username);
        const foto  = v._foto || pickFoto(v);
        const fotosArr = allFotos(v);
        const hasImg = fotosArr.length > 0 || (foto && foto.storage_path && foto.storage_path !== "text_only");
        const carruselFotos = fotosArr.length ? fotosArr : (hasImg && foto ? [foto] : []);
        const descFoto = carruselFotos.find(f => f.descripcion)?.descripcion || foto?.descripcion;
        const cid   = esc(foto ? foto.id : v.id);
        const fecha = new Date(v.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

        return `
    <div class="feed-post">
      <div class="post-header" data-uid="${esc(userId)}" data-uname="${userSafe}" onclick="openFriendProfile(this.dataset.uid, this.dataset.uname)" style="cursor:pointer">
        <div class="post-av" style="color:${color};overflow:hidden">${avatarHtml}</div>
        <div>
          <div class="post-user">${userSafe}</div>
          <div class="post-time" style="color:rgba(255,255,255,0.45)">${fecha}</div>
        </div>
        ${v.gps_verificada ? '<span title="Visita verificada por GPS" style="font-size:9px;background:rgba(34,176,80,0.15);color:#22b050;border:1px solid rgba(34,176,80,0.35);border-radius:999px;padding:2px 7px;font-weight:600;white-space:nowrap">📍 Verificada</span>' : ""}
        ${v._tipo === "rec"
          ? '<div class="post-badge" style="background:rgba(232,201,58,0.16);color:#e8c93a">💡 Recomendación</div>'
          : isEv
          ? '<div class="post-badge" style="background:rgba(232,90,160,0.16);color:#f08fc4">🎉 Evento</div>'
          : `<div class="post-badge ${coast ? "pb-coast" : "pb-mount"}">
          <i class="ti ${coast ? "ti-waves" : "ti-mountain"}" aria-hidden="true" style="font-size:10px"></i>
          ${coast ? "Costa" : "Montaña"}
        </div>`}
      </div>
      ${hasImg ? (carruselFotos.length === 1 ? `<div class="post-img-single" style="position:relative;width:100%;min-height:140px;background:${coast ? "#0d2535" : "#0d2a1e"};display:flex;align-items:center;justify-content:center;overflow:hidden">
        <img src="" data-foto-id="${esc(carruselFotos[0].id)}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block" alt="${muniSafe}" onerror="this.style.display='none'"/>
        <div class="post-img-placeholder" style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)"><div class="spin" style="width:20px;height:20px;border-width:2px"></div></div>
        <div class="post-location" style="z-index:2"><i class="ti ti-map-pin" aria-hidden="true"></i>${muniSafe}</div>
      </div>` : `<div class="post-img-multi" style="position:relative;width:100%;background:${coast ? "#0d2535" : "#0d2a1e"}">
        <div class="post-carousel" data-n="${carruselFotos.length}" style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;min-height:200px">
          ${carruselFotos.map(f => `<div class="cslide" style="flex:0 0 100%;width:100%;max-width:100%;min-width:0;scroll-snap-align:center;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
            <img src="" data-foto-id="${esc(f.id)}" loading="lazy" decoding="async" style="width:100%;max-width:100%;height:auto;display:block;object-fit:contain" alt="${muniSafe}" onerror="this.style.display='none'"/>
            <div class="post-img-placeholder" style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)"><div class="spin" style="width:20px;height:20px;border-width:2px"></div></div>
          </div>`).join("")}
        </div>
        <div class="post-location" style="z-index:2"><i class="ti ti-map-pin" aria-hidden="true"></i>${muniSafe}</div>
        <div class="cs-counter" style="position:absolute;top:8px;right:8px;z-index:2;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;backdrop-filter:blur(4px)">1/${carruselFotos.length}</div>
        <div class="cs-dots" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:2;display:flex;gap:5px">${carruselFotos.map((_, di) => `<span style="width:6px;height:6px;border-radius:50%;transition:background .2s;background:${di === 0 ? "#fff" : "rgba(255,255,255,0.4)"}"></span>`).join("")}</div>
      </div>`) : ""}
      <div class="post-body">
        <div class="post-muni">${muniSafe}</div>
        ${foto?.rating ? `<div style="margin:1px 0 3px;color:#e8c93a;font-size:14px;letter-spacing:2px">${"★".repeat(foto.rating)}<span style="color:rgba(255,255,255,0.18)">${"★".repeat(Math.max(0,5-foto.rating))}</span></div>` : ""}
        ${descFoto ? `<div class="post-desc">${renderMentions(esc(descFoto))}</div>` : ""}
        ${foto ? `<div id="tags-${esc(foto.id)}" style="display:none;font-size:11.5px;color:#9cc4f0;margin-top:4px"></div>` : ""}
        <div class="post-actions">
          ${foto ? `
          <div style="display:flex;gap:6px;align-items:center">
            <button class="post-action" data-fid="${esc(foto.id)}" onclick="toggleLike(this, this.dataset.fid)" data-liked="false">
              <i class="ti ti-heart" aria-hidden="true"></i><span id="likes-${esc(foto.id)}">0</span>
            </button>
          </div>` : "<div></div>"}
          ${isEv ? `
          <button class="post-action" style="margin-left:auto" onclick="goToEvento(this.dataset.muni)" data-muni="${muniSafe}">
            <i class="ti ti-confetti" aria-hidden="true"></i><span style="font-size:11px">Ver evento</span>
          </button>` : `
          <button class="post-action" style="margin-left:auto" onclick="openMuniModal(this.dataset.muni)" data-muni="${muniSafe}">
            <i class="ti ti-info-circle" aria-hidden="true"></i><span style="font-size:11px">Ver ficha</span>
          </button>
          <button class="post-action" onclick="goToMuniOnMap(this.dataset.muni)" data-muni="${muniSafe}">
            <i class="ti ti-map-pin" aria-hidden="true"></i><span style="font-size:11px">Mapa</span>
          </button>`}
          ${v.user_id !== state.user?.id ? `
          <button class="post-action" title="Reportar" data-cid="${cid}" data-uid="${esc(v.user_id)}" onclick="reportarContenido('post', this.dataset.cid, this.dataset.uid)" style="color:rgba(255,255,255,0.3)">
            <i class="ti ti-flag" aria-hidden="true"></i>
          </button>` : ""}
          ${v.user_id === state.user?.id && v._tipo !== "rec" ? `
          <button class="post-action" data-vid="${esc(v.id)}" data-fid="${esc(foto ? foto.id : "")}" data-path="${esc(foto && (foto.path || foto.storage_path) || "")}" data-batch="${esc(v._batchId || "")}" data-muni="${muniSafe}" onclick="deleteFeedPost(this.dataset.vid, this.dataset.fid, this.dataset.path, this.dataset.batch, this.dataset.muni)" style="color:rgba(232,40,40,0.5)">
            <i class="ti ti-trash" aria-hidden="true"></i>
          </button>` : ""}
        </div>
        <div id="comments-${cid}" class="post-comments" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="color:rgba(255,255,255,0.25);font-size:11px">Cargando comentarios...</div>
        </div>
        <div class="comment-input-row">
          <input class="comment-input" id="comment-input-${cid}" type="text" placeholder="Añade un comentario..." maxlength="200"
            data-cid="${cid}" data-uid="${esc(v.user_id)}" data-muni="${muniSafe}"
            onkeydown="if(event.key==='Enter')postComment(this.dataset.cid, this.dataset.uid, this.dataset.muni)"/
          <button class="comment-send" data-cid="${cid}" data-uid="${esc(v.user_id)}" data-muni="${muniSafe}"
            onclick="postComment(this.dataset.cid, this.dataset.uid, this.dataset.muni)">
            <i class="ti ti-send" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>`;
    }).join("");
    const fpEl = document.getElementById("feed-posts");
    if (append) fpEl.insertAdjacentHTML("beforeend", __html);
    else fpEl.innerHTML = __html;

    applyFeedFilter();
    wireCarousels(fpEl);

    // ── Carga EN LOTE ──
    // Para likes/comentarios usamos la foto "principal" de cada post (anclaje
    // histórico). Para las imágenes firmamos TODAS las del carrusel.
    const fotosConStorage = []; // todas las del carrusel (para mostrar)
    const commentIds = [];      // una por post (anclaje de likes/comentarios)
    visits.forEach(v => {
        const foto = v._foto || pickFoto(v);
        commentIds.push(foto?.id || v.id);
        allFotos(v).forEach(f => fotosConStorage.push(f));
    });
    const fotoIds = [...new Set(commentIds.filter(Boolean))];
    // Firmamos miniatura Y foto completa: mostramos la miniatura y, si falla
    // (p.ej. la política aún no cubre el thumb), caemos a la foto completa.
    const paths = [...new Set([
        ...fotosConStorage.map(f => f.thumb_path).filter(Boolean),
        ...fotosConStorage.map(f => f.storage_path).filter(p => p && p !== "text_only")
    ])];
    const likeIds = fotoIds.flatMap(id => [id, id + "_fire", id + "_love"]);

    const [urlByPath, likesRes, commentsRes] = await Promise.all([
        signPaths(paths),
        likeIds.length ? db.from("photo_likes").select("photo_id,user_id").in("photo_id", likeIds) : Promise.resolve({ data: [] }),
        commentIds.length ? db.from("photo_comments")
            .select("id,photo_id,user_id,texto,foto_path,created_at, profiles(username,avatar_url)")
            .in("photo_id", commentIds).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
    ]);

    // 1) Imágenes (todas las del carrusel): miniatura con respaldo a foto completa
    fotosConStorage.forEach(f => {
        const turl = f.thumb_path ? urlByPath[f.thumb_path] : null;
        const furl = (f.storage_path && f.storage_path !== "text_only") ? urlByPath[f.storage_path] : null;
        const url = turl || furl;
        if (!url) return;
        const img = document.querySelector('img[data-foto-id="' + f.id + '"]');
        if (img) {
            // Si mostramos la miniatura y falla, reintenta con la foto completa
            if (turl && furl && turl !== furl) {
                img.onerror = function() { this.onerror = null; this.src = furl; this.style.display = "block"; };
            }
            img.src = url;
            img.style.display = "block";
            img.closest(".cslide, .post-img-single, .post-img-multi, .post-img")?.querySelector(".post-img-placeholder")?.remove();
        }
    });

    // 2) Likes y reacciones (contador real + estado propio)
    const counts = {}; const mine = {};
    (likesRes.data || []).forEach(l => {
        counts[l.photo_id] = (counts[l.photo_id] || 0) + 1;
        if (l.user_id === state.user?.id) mine[l.photo_id] = true;
    });
    fotoIds.forEach(fid => {
        const likeSpan = document.getElementById("likes-" + fid);
        if (likeSpan) likeSpan.textContent = counts[fid] || 0;
        const likeBtn = likeSpan?.closest(".post-action");
        if (likeBtn && mine[fid]) { likeBtn.setAttribute("data-liked", "true"); likeBtn.classList.add("liked"); }
        [["fire"], ["love"]].forEach(([r]) => {
            const span = document.getElementById("react-" + r + "-count-" + fid);
            if (span) span.textContent = counts[fid + "_" + r] || 0;
            const btn = document.getElementById("react-" + r + "-" + fid);
            if (btn && mine[fid + "_" + r]) { btn.setAttribute("data-reacted", "true"); btn.style.opacity = "1"; }
            else if (btn) btn.style.opacity = "0.55";
        });
    });

    // 3.5) Etiquetas de personas
    try {
        const { data: tags } = await db.from("photo_tags")
            .select("photo_id,tagged_id, profiles:profiles!photo_tags_tagged_id_fkey(username)")
            .in("photo_id", fotoIds);
        const porFoto = {};
        (tags || []).forEach(t => (porFoto[t.photo_id] = porFoto[t.photo_id] || []).push(t.profiles?.username || "alguien"));
        Object.entries(porFoto).forEach(([fid, nombres]) => {
            const el = document.getElementById("tags-" + fid);
            if (!el) return;
            el.innerHTML = "🏷️ con " + nombres.map(n => "<strong>@" + esc(n) + "</strong>").join(", ");
            el.style.display = "block";
        });
    } catch (e) { console.warn("tags feed:", e); }

    // 3) Comentarios
    const byPhoto = {};
    (commentsRes.data || []).forEach(c => { (byPhoto[c.photo_id] = byPhoto[c.photo_id] || []).push(c); });
    // Firmar las fotos adjuntas a comentarios (si hay)
    const cPaths = [...new Set((commentsRes.data || []).filter(c => c.foto_path).map(c => c.foto_path))];
    const cUrls = cPaths.length ? await signPaths(cPaths) : {};
    commentIds.forEach(cid => {
        const cont = document.getElementById("comments-" + cid);
        if (cont) renderComments(cont, byPhoto[cid] || [], cid, cUrls);
    });
}

async function loadVisitComments(e, t) {
    const id = e || t;
    const cont = document.getElementById("comments-" + id);
    if (!cont) return;
    const { data } = await db.from("photo_comments")
        .select("id,photo_id,user_id,texto,foto_path,created_at, profiles(username, avatar_url)")
        .eq("photo_id", id).order("created_at", { ascending: true });
    const cPaths = [...new Set((data || []).filter(c => c.foto_path).map(c => c.foto_path))];
    const urls = cPaths.length ? await signPaths(cPaths) : {};
    renderComments(cont, data || [], id, urls);
}

function renderComments(container, comments, id, urls = {}) {
    comments = comments.filter(c => !state.blockedIds?.has(c.user_id));
    const last3 = comments.slice(-3); // mismas 3 últimas que antes
    if (!last3.length) {
        container.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:11px;padding:4px 0">Sin comentarios aún</div>';
        return;
    }
    container.innerHTML = last3.map(c => {
        const u  = c.profiles?.username || "Usuario";
        const av = c.profiles?.avatar_url
            ? '<img src="' + esc(c.profiles.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(u) + '"/>'
            : getInitials(u);
        const del = c.user_id === state.user?.id
            ? '<button class="c-del" data-cid="' + esc(c.id) + '" data-pid="' + esc(id) + '" onclick="deleteComment(this.dataset.cid, this.dataset.pid)" title="Borrar"><i class="ti ti-trash" aria-hidden="true"></i></button>'
            : "";
        const cFotoUrl = c.foto_path
            ? (urls[c.foto_path] || db.storage.from("evidencias").getPublicUrl(c.foto_path).data?.publicUrl)
            : null;
        const cFoto = cFotoUrl
            ? '<img src="' + esc(cFotoUrl) + '" style="display:block;max-width:160px;max-height:120px;border-radius:8px;margin-top:5px;object-fit:cover" alt="foto comentario" onerror="this.style.display=\'none\'"/>'
            : "";
        return '<div class="comment"><div class="c-av">' + av + '</div><div class="c-text"><strong>' + esc(u) + '</strong> ' + renderMentions(esc(c.texto || "")) + cFoto + '</div>' + del + '</div>';
    }).join("");
}

function renderMentions(textoEscapado) {
    // OJO: aplicar siempre sobre texto YA escapado con esc()
    return String(textoEscapado).replace(/@(\w+)/g, (m, user) =>
        '<span class="mention" data-user="' + esc(user) + '" onclick="openMentionProfile(this.dataset.user)" style="cursor:pointer;color:#2272e8;font-weight:600">@' + esc(user) + '</span>');
}
async function searchAndOpenProfile(e) {
    const {
        data: t
    } = await db.from("profiles").select("id, username, avatar_url").ilike("username", e).single();
    t ? openFriendProfile(t.id, t.username) : toast("Usuario @" + e + " no encontrado", "info")
}
async function deleteComment(e, t) {
    if (state.user && await confirmar("¿Borrar este comentario?", { titulo: "Borrar comentario", ok: "Borrar", peligro: !0 })) { await db.from("photo_comments").delete().eq("id", e).eq("user_id", state.user.id); await loadVisitComments(t, null); }
}async function postComment(e, t, i) {
    const n = document.getElementById("comment-input-" + e);
    if (!n || !state.user) return;
    const o = n.value.trim();
    if (o) {
        const sendBtn = document.querySelector('.comment-send[data-cid="' + e + '"]');
        n.disabled = !0;
        let sentOk = !1;
        if (sendBtn) { sendBtn.disabled = !0; sendBtn._prevHtml = sendBtn.innerHTML; sendBtn.innerHTML = '<div class="spin" style="width:13px;height:13px;border-width:2px;margin:0 auto"></div>'; }
        try {
            const insErr = (await db.from("photo_comments").insert({
                user_id: state.user.id, photo_id: e, texto: o
            })).error;
            if (insErr) { console.error("Error al comentar:", insErr); toast("No se pudo publicar el comentario.", "error"); }
            else {
                sentOk = !0;
                n.value = "";
                await loadVisitComments(e);
                const t = (o || "").match(/@(\w+)/g);
                if (t)
                    for (const e of t) {
                        const t = e.slice(1),
                            {
                                data: i
                            } = await db.from("profiles").select("id").ilike("username", t).single();
                        i && i.id !== state.user.id && await db.from("push_subscriptions").select("user_id").eq("user_id", i.id).limit(1).then(async ({
                            data: e
                        }) => {
                            e?.length && console.log("Notificación pendiente para:", t)
                        })
                    }
            }
        } catch (e) {
            toast("Error al comentar: " + e.message, "error")
        } finally {
            n.disabled = !1;
            if (!sentOk) n.value = o; // no perder lo escrito si algo falló
            if (sendBtn) { sendBtn.disabled = !1; sendBtn.innerHTML = sendBtn._prevHtml || sendBtn.innerHTML; }
        }
    }
}
async function deleteFeedPost(e, t, i, batch, muni) {
    if (!state.user) return;
    if (!await confirmar("¿Borrar esta publicación?", { titulo: "Borrar publicación", ok: "Borrar", peligro: !0 })) return;
    try {
        // Posts del feed por lote de subida (pb_) o foto global (gp_) / evento (ep_)
        if (String(e).startsWith("pb_") || String(e).startsWith("gp_") || String(e).startsWith("ep_")) {
            if (batch) {
                // Borra TODO el lote de subida
                const { data: rows } = await db.from("photos").select("id,storage_path").eq("batch_id", batch).eq("user_id", state.user.id);
                const paths = (rows || []).map(r => r.storage_path).filter(p => p && p !== "text_only");
                if (paths.length) await db.storage.from("evidencias").remove(paths);
                await db.from("photos").delete().eq("batch_id", batch).eq("user_id", state.user.id);
                state.photos = state.photos.filter(p => !(rows || []).some(r => r.id === p.id));
            } else if (t) {
                // Una sola foto / post sin lote
                if (i && i !== "text_only") await db.storage.from("evidencias").remove([i]);
                await db.from("photos").delete().eq("id", t).eq("user_id", state.user.id);
                state.photos = state.photos.filter(p => p.id !== t);
            }
            // Si era una conquista sin foto (text_only), también desmarcamos el municipio
            if (i === "text_only" && muni) {
                await db.from("visits").delete().eq("user_id", state.user.id).eq("municipio", muni);
                delete state.visited[muni];
                document.querySelectorAll('.muni-path').forEach(el => { if (el.getAttribute("data-name") === muni) el.classList.remove("visited"); });
                updateProgress();
            }
            state.feedCache = null;
            loadFeed(!0);
            toast("Publicación borrada", "info");
            return;
        }
        // (compat) Borrado por id de visita antiguo
        i && "text_only" !== i && "" !== i && await db.storage.from("evidencias").remove([i]), t && await db.from("photos").delete().eq("id", t).eq("user_id", state.user.id), await db.from("visits").delete().eq("id", e).eq("user_id", state.user.id), state.feedCache = null, state.photos = state.photos.filter(p => p.id !== t), updateProgress(), loadFeed(!0), toast("Publicación borrada", "info");
    } catch (err) {
        toast("Error al borrar: " + err.message, "error");
    }
}

function goToMuniOnMap(e) {
    state.selectedMuni = e, switchScreen("map"), setTimeout(() => highlightMuniOnMap(e), 300)
}
async function openFriendProfile(e, t) {
    const i = document.getElementById("friend-profile-modal");
    if (!i) return;
    document.getElementById("fp-username").textContent = t, document.getElementById("fp-avatar").textContent = t.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2), document.getElementById("fp-visits-count").textContent = "...", document.getElementById("fp-photos-count").textContent = "...", document.getElementById("fp-friends-count") && (document.getElementById("fp-friends-count").textContent = "..."), document.getElementById("fp-gallery").innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Cargando...</div>', document.getElementById("fp-map").innerHTML = "", document.getElementById("fp-minimap").innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:11px;text-align:center;padding:20px 0">Cargando mapa...</div>', i.style.display = "flex";
    const [n, o, a] = await Promise.all([db.from("profiles").select("username, avatar_url").eq("id", e).single(), db.from("visits").select("municipio, fecha, created_at").eq("user_id", e).in("visibilidad", ["amigos", "publico"]).order("created_at", {
        ascending: !1
    }), db.from("photos").select("*").eq("user_id", e).in("visibilidad", ["amigos", "publico"]).order("created_at", {
        ascending: !1
    }).limit(9)]), s = n.data, r = o.data || [], d = a.data || [], l = new Set(r.map(e => e.municipio));
    s?.avatar_url && (document.getElementById("fp-avatar").innerHTML = '<img src="' + esc(s.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(t) + '"/>'), document.getElementById("fp-visits-count").textContent = r.length, document.getElementById("fp-photos-count").textContent = d.length, renderFriendMiniMap(l);

    // Moderación: reportar / bloquear usuario
    let mod = document.getElementById("fp-moderation");
    if (!mod) {
        mod = document.createElement("div");
        mod.id = "fp-moderation";
        document.getElementById("fp-gallery").parentNode.appendChild(mod);
    }
    mod.style.cssText = "display:flex;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08)";
    mod.innerHTML =
        '<button data-uid="' + esc(e) + '" onclick="reportarContenido(\'usuario\', this.dataset.uid, this.dataset.uid)" style="flex:1;padding:9px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif"><i class="ti ti-flag" aria-hidden="true"></i> Reportar</button>' +
        '<button data-uid="' + esc(e) + '" data-uname="' + esc(t) + '" onclick="bloquearUsuario(this.dataset.uid, this.dataset.uname)" style="flex:1;padding:9px;background:rgba(232,40,40,0.1);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif"><i class="ti ti-ban" aria-hidden="true"></i> Bloquear</button>';

    // Amigos de este usuario (para enviarles solicitud)
    renderFriendsOfFriend(e, mod);
    document.getElementById("fp-map").innerHTML = r.length ? r.slice(0, 8).map(e => {
        const t = isCoast(e.municipio),
            i = new Date(e.created_at).toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short"
            });
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="width:28px;height:28px;border-radius:7px;background:' + (t ? "#0d2a4a" : "#0d2a1e") + ';display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ' + (t ? "ti-waves" : "ti-mountain") + '" style="font-size:13px;color:' + (t ? "#85B7EB" : "#5DCAA5") + '" aria-hidden="true"></i></div><div style="flex:1;font-size:13px;font-weight:500;color:#fff">' + esc(e.municipio) + '</div><div style="font-size:11px;color:rgba(255,255,255,0.35)">' + i + "</div></div>"
    }).join("") : '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Sin visitas públicas</div>';
    if (d.length) {
        const fpPaths = [...new Set(d.filter(e => e.storage_path && "text_only" !== e.storage_path).map(e => e.storage_path))];
        const fpUrls = {};
        if (fpPaths.length) {
            const { data: signed } = await db.storage.from("evidencias").createSignedUrls(fpPaths, 3600);
            (signed || []).forEach(s => { if (s.signedUrl) fpUrls[s.path] = s.signedUrl; });
        }
        document.getElementById("fp-gallery").innerHTML = d.map(e => {
            const url = fpUrls[e.storage_path] || "";
            return '<div style="aspect-ratio:1;border-radius:8px;overflow:hidden;background:#1a2535">'
                + (url ? '<img src="' + esc(url) + '" style="width:100%;height:100%;object-fit:cover" alt="' + esc(e.municipio) + '"/>' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.15);font-size:20px"><i class="ti ti-camera" aria-hidden="true"></i></div>')
                + '</div>';
        }).join("");
    } else {
        document.getElementById("fp-gallery").innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Sin fotos públicas</div>';
    }
}
async function renderFriendMiniMap(e) {
    const t = document.getElementById("fp-minimap");
    if (t) try {
        const i = await d3.json("https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json"),
            n = {
                type: "FeatureCollection",
                features: topojson.feature(i, i.objects.municipalities).features.filter(e => String(e.id || "").startsWith("39") || 53072 === e.id || "53072" === e.id)
            },
            o = t.clientWidth || 300,
            a = Math.round(.49 * o);
        t.innerHTML = "";
        const s = d3.select(t).append("svg").attr("viewBox", "0 0 " + o + " " + a).style("width", "100%"),
            r = d3.geoMercator().fitSize([o, a], n),
            d = d3.geoPath(r);
        s.selectAll("path").data(n.features).join("path").attr("d", d).attr("fill", t => {
            const i = t.properties.name || t.properties.NAME || t.properties.NAMEUNIT || "";
            return e.has(i) ? "#22b050" : "#2a3a4a"
        }).attr("stroke", "#0f1923").attr("stroke-width", .5);
        const l = Math.round(e.size / (state.totalMuni||103) * 100);
        t.insertAdjacentHTML("afterbegin", '<div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px">' + e.size + " / " + (state.totalMuni||103) + " municipios · " + l + "%</div>")
    } catch (e) {
        t.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px">No se pudo cargar el mapa</div>'
    }
}

function closeFriendProfile() {
    document.getElementById("friend-profile-modal").style.display = "none"
}
async function loadPhotoLikes(e) {
    const {
        count: t
    } = await db.from("photo_likes").select("*", {
        count: "exact",
        head: !0
    }).eq("photo_id", e), i = document.getElementById("likes-" + e);
    i && (i.textContent = t || 0)
}
async function toggleReaction(e, t, i) {
    if (!state.user) return;
    const n = "true" === e.getAttribute("data-reacted"),
        o = "🔥" === i ? "fire" : "love",
        a = document.getElementById("react-" + o + "-count-" + t);
    e.setAttribute("data-reacted", String(!n)), e.style.opacity = n ? "0.4" : "1", n ? (await db.from("photo_likes").delete().eq("user_id", state.user.id).eq("photo_id", t + "_" + o), a && (a.textContent = Math.max(0, parseInt(a.textContent || 0) - 1))) : (await db.from("photo_likes").insert({
        user_id: state.user.id,
        photo_id: t + "_" + o
    }), a && (a.textContent = parseInt(a.textContent || 0) + 1))
}
async function toggleLike(e, t) {
    if (!state.user) return;
    const wasLiked = "true" === e.getAttribute("data-liked");
    const span = e.querySelector("span");
    const before = parseInt(span.textContent) || 0;
    // Optimista
    e.setAttribute("data-liked", String(!wasLiked));
    e.classList.toggle("liked", !wasLiked);
    span.textContent = Math.max(0, before + (wasLiked ? -1 : 1));
    try {
        let err;
        if (wasLiked) {
            err = (await db.from("photo_likes").delete().eq("user_id", state.user.id).eq("photo_id", t)).error;
        } else {
            // 1º upsert (necesita la clave única). Si esa clave aún no existe,
            // probamos un insert normal y tratamos el duplicado como "ya estaba".
            let r = await db.from("photo_likes").upsert({ user_id: state.user.id, photo_id: t }, { onConflict: "user_id,photo_id" });
            if (r.error && /on conflict|constraint|unique|exclusion/i.test(r.error.message || "")) {
                r = await db.from("photo_likes").insert({ user_id: state.user.id, photo_id: t });
                if (r.error && (r.error.code === "23505" || /duplicate/i.test(r.error.message || ""))) r = { error: null };
            }
            err = r.error;
        }
        if (err) throw err;
    } catch (err) {
        // Revertir si falló (normalmente faltan permisos RLS: ejecuta el SQL)
        e.setAttribute("data-liked", String(wasLiked));
        e.classList.toggle("liked", wasLiked);
        span.textContent = before;
        console.error("toggleLike:", err);
        toast("No se pudo guardar el like: " + (err?.message || err?.code || "permisos (revisa el SQL)"), "error");
    }
}
async function searchUser() {
    const e = document.getElementById("search-input").value.trim();
    if (!e) return;
    const t = document.getElementById("search-results");
    t.innerHTML = '<div style="color:rgba(255,255,255,0.35);font-size:12px;padding:8px 0">Buscando...</div>';
    const {
        data: i
    } = await db.from("profiles").select("id, username").ilike("username", `%${e}%`).neq("id", state.user.id).limit(10);
    if (!i || !i.length) return void(t.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px 0">No se encontró ningún usuario</div>');
    const {
        data: n
    } = await db.from("friendships").select("follower_id, following_id, estado").or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`);
    t.innerHTML = i.map(e => {
        const t = (n || []).find(t => t.follower_id === state.user.id && t.following_id === e.id || t.following_id === state.user.id && t.follower_id === e.id),
            i = e.username.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2);
        let o = "";
        return t ? "pendiente" === t.estado ? o = '<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">\n        <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente\n      </span>' : "aceptado" === t.estado && (o = '<span style="font-size:11px;color:#22b050;background:rgba(34,176,80,0.12);padding:5px 10px;border-radius:999px">\n        <i class="ti ti-check" aria-hidden="true" style="font-size:10px"></i> Amigos\n      </span>') : o = `<button data-uid="${esc(e.id)}" data-uname="${esc(e.username)}" onclick="sendFriendRequest(this.dataset.uid, this.dataset.uname, this)"\n        style="padding:6px 13px;background-color:#2272e8;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">\n        + Añadir\n      </button>`, `\n    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">\n      <div style="width:34px;height:34px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#7ab3e8;flex-shrink:0;font-family:Playfair Display,serif">${getInitials(e.username)}</div>\n      <span style="color:#fff;font-size:13px;flex:1">${esc(e.username)}</span>\n      ${o}\n    </div>`
    }).join("")
}
async function sendFriendRequest(e, t, i) {
    if (!state.user) return;
    i && (i.outerHTML = '<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">\n      <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente\n    </span>');
    const {
        error: n
    } = await db.from("friendships").insert({
        follower_id: state.user.id,
        following_id: e,
        estado: "pendiente"
    });
    n && "23505" !== n.code && (toast("Error al enviar solicitud. Inténtalo de nuevo.", "error"), searchUser())
}
async function renderProfile() {
    const e = Object.keys(state.visited).length;
    document.getElementById("sv").textContent = e, document.getElementById("sp").textContent = Math.round(e / state.totalMuni * 100) + "%", document.getElementById("sph").textContent = state.photos.length, renderGallery();
    refreshBadgesAndLevel(false);
    syncNotifButton();
    loadLikesRecibidos().then(() => refreshBadgesAndLevel(false));
    await Promise.all([loadSolicitudes(), loadFriendCount()])
}
async function loadFriendCount() {
    if (!state.user) return;
    const {
        data: e
    } = await db.from("friendships").select("follower_id, following_id").or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado"), t = new Set;
    (e || []).forEach(e => {
        const i = e.follower_id === state.user.id ? e.following_id : e.follower_id;
        t.add(i)
    });
    const i = document.getElementById("sf");
    i && (i.textContent = t.size)
}
async function openFriendsModal() {
    const e = document.getElementById("friends-list-modal"),
        t = document.getElementById("friends-list-content");
    if (!e || !t) return;
    t.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:13px;padding:10px 0">Cargando...</div>', e.style.display = "flex";
    const {
        data: i
    } = await db.from("friendships").select("follower_id,following_id,follower:profiles!friendships_follower_id_fkey(id,username,avatar_url),following:profiles!friendships_following_id_fkey(id,username,avatar_url)").or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado"), n = new Set, o = (i || []).map(e => e.follower_id === state.user.id ? e.following : e.follower).filter(e => !(!e || n.has(e.id)) && (n.add(e.id), !0));
    o.length ? t.innerHTML = o.map(e => {
        const t = (e.username || "?").split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2),
            i = e.avatar_url ? '<img src="' + esc(e.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(e.username) + '"/>' : t;
        return '<div data-uid="' + esc(e.id) + '" data-uname="' + esc(e.username) + '" onclick="closeFriendsModal();openFriendProfile(this.dataset.uid, this.dataset.uname)" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer"><div style="width:42px;height:42px;border-radius:50%;background:#1a2535;border:1.5px solid #e86820;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:#e86820;flex-shrink:0;overflow:hidden">' + i + '</div><div style="flex:1"><div style="font-size:14px;font-weight:500;color:#fff">' + esc(e.username) + '</div></div><i class="ti ti-chevron-right" style="color:rgba(255,255,255,0.2);font-size:16px" aria-hidden="true"></i></div>'
    }).join("") : t.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:13px;padding:20px 0;text-align:center">Aún no tienes amigos añadidos</div>'
}

function closeFriendsModal() {
    document.getElementById("friends-list-modal").style.display = "none"
}
async function loadSolicitudes() {
    if (!state.user) return;
    const {
        data: e
    } = await db.from("friendships").select("follower_id, created_at, profiles!friendships_follower_id_fkey(username)").eq("following_id", state.user.id).eq("estado", "pendiente"), {
        data: t
    } = await db.from("friendships").select("following_id, created_at, profiles!friendships_following_id_fkey(username)").eq("follower_id", state.user.id).eq("estado", "pendiente"), i = document.getElementById("solicitudes-section");
    if (!i) return;
    const n = (e?.length || 0) + (t?.length || 0);
    if (0 === n) return void(i.innerHTML = "");
    let o = `\n    <div style="padding:14px 14px 0">\n      <h2 style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.4);margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">\n        Solicitudes de amistad\n        <span style="background:#e8288a;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px;margin-left:6px">${n}</span>\n      </h2>`;
    e?.length > 0 && (o += '<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px">Recibidas</div>', o += e.map(e => {
        const t = e.profiles?.username || "Usuario";
        return `\n      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">\n        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid #e8288a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#e8288a;flex-shrink:0;font-family:Playfair Display,serif">${getInitials(t)}</div>\n        <div style="flex:1">\n          <div style="font-size:13px;font-weight:500;color:#fff">${esc(t)}</div>\n          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${new Date(e.created_at).toLocaleDateString("es-ES")}</div>\n        </div>\n        <div style="display:flex;gap:6px">\n          <button data-uid="${esc(e.follower_id)}" data-uname="${esc(t)}" onclick="aceptarSolicitud(this.dataset.uid, this.dataset.uname)"\n            style="padding:7px 12px;background-color:#22b050;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">\n            <i class="ti ti-check" aria-hidden="true"></i> Aceptar\n          </button>\n          <button data-uid="${esc(e.follower_id)}" data-uname="${esc(t)}" onclick="rechazarSolicitud(this.dataset.uid, this.dataset.uname)"\n            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">\n            <i class="ti ti-x" aria-hidden="true"></i>\n          </button>\n        </div>\n      </div>`
    }).join("")), t?.length > 0 && (o += '<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:12px;margin-bottom:8px">Enviadas</div>', o += t.map(e => {
        const t = e.profiles?.username || "Usuario";
        return `\n      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">\n        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:rgba(255,255,255,0.5);flex-shrink:0;font-family:Playfair Display,serif">${getInitials(t)}</div>\n        <div style="flex:1">\n          <div style="font-size:13px;font-weight:500;color:#fff">${esc(t)}</div>\n          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${new Date(e.created_at).toLocaleDateString("es-ES")}</div>\n        </div>\n        <div style="display:flex;align-items:center;gap:6px">\n          <span style="font-size:11px;color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">\n            <i class="ti ti-clock" aria-hidden="true" style="font-size:11px"></i> Pendiente\n          </span>\n          <button data-uid="${esc(e.following_id)}" data-uname="${esc(t)}" onclick="cancelarSolicitud(this.dataset.uid, this.dataset.uname)"\n            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">\n            <i class="ti ti-x" aria-hidden="true"></i>\n          </button>\n        </div>\n      </div>`
    }).join("")), o += "</div>", i.innerHTML = o
}
async function aceptarSolicitud(e, t) {
    await db.from("friendships").update({
        estado: "aceptado"
    }).eq("follower_id", e).eq("following_id", state.user.id), await db.from("friendships").upsert({
        follower_id: state.user.id,
        following_id: e,
        estado: "aceptado"
    }), await loadSolicitudes()
}
async function rechazarSolicitud(e, t) {
    if (await confirmar("¿Rechazar la solicitud de " + t + "?", { titulo: "Rechazar solicitud", ok: "Rechazar", peligro: !0 })) { await db.from("friendships").delete().eq("follower_id", e).eq("following_id", state.user.id); await loadSolicitudes(); loadNotifBadge(); }
}
async function cancelarSolicitud(e, t) {
    if (await confirmar("¿Cancelar la solicitud enviada a " + t + "?", { titulo: "Cancelar solicitud", ok: "Cancelar solicitud", cancel: "Volver" })) { await db.from("friendships").delete().eq("follower_id", state.user.id).eq("following_id", e); await loadSolicitudes(); }
}

async function renderGallery() {
    const e = document.getElementById("gallery"),
        t = document.getElementById("g-empty");
    if (!state.photos.length) return e.innerHTML = "", void(t.style.display = "block");
    t.style.display = "none";
    // Firmar bajo demanda: miniatura si existe, si no la foto completa.
    const pending = state.photos.filter(p => !p.src && (p.thumb || (p.path && p.path !== "text_only")));
    if (pending.length) {
        const urls = await signPaths(pending.map(p => p.thumb || p.path));
        pending.forEach(p => { p.src = urls[p.thumb] || urls[p.path] || p.src; });
    }
    const i = state.photos.filter(e => e.src && "" !== e.src);
    if (document.getElementById("sph").textContent = i.length, !i.length) return e.innerHTML = "", void(document.getElementById("g-empty").style.display = "block");
    document.getElementById("g-empty").style.display = "none", e.innerHTML = i.map((e, t) => `\n    <div class="gi" onclick="openPMbyId('${e.id||t}')">\n      <img src="${e.src}" alt="${esc(e.muni)}" loading="lazy" decoding="async"\n        onerror="this.parentElement.style.display='none'"/>\n      <div class="gi-hov">\n        <div class="gm">\n          <div style="font-weight:500">${esc(e.muni.length>14?e.muni.substring(0,12)+"…":e.muni)}</div>\n          <div>${e.date}</div>\n        </div>\n      </div>\n    </div>`).join("")
}

function openPMbyId(e) {
    const t = state.photos.filter(e => e.src && "" !== e.src),
        i = t.find(t => t.id === e) || t[parseInt(e)];
    i && openPMobj(i)
}

function openPM(e) {
    openPMobj(state.photos[e])
}

function openPMobj(e) {
    if (!e) return;
    state.currentPM = e;
    ensurePMCloseBtn();
    const closeX = document.getElementById("pm-close-x");
    if (closeX) closeX.style.display = "flex";
    const t = document.getElementById("pm-img");
    e.src ? (t.src = e.src, t.style.display = "block") : (t.src = "", t.style.display = "none");
    // Cargar la versión a resolución completa (la galería muestra miniatura)
    if (e.path && e.path !== "text_only") {
        signPaths([e.path]).then(u => {
            const full = u[e.path];
            if (full && state.currentPM === e) { t.src = full; t.style.display = "block"; e.fullSrc = full; }
        });
    }
    document.getElementById("pm-meta").innerHTML = `
    <div class="mrow"><i class="ti ti-map-pin" aria-hidden="true"></i><span>Municipio</span><strong>${esc(e.muni)}</strong></div>
    <div class="mrow"><i class="ti ti-calendar" aria-hidden="true"></i><span>Fecha</span><strong>${esc(e.date || "—")}</strong></div>
    <div class="mrow"><i class="ti ti-clock" aria-hidden="true"></i><span>Hora</span><strong>${esc(e.time || "—")}</strong></div>
    <div class="mrow"><i class="ti ti-location" aria-hidden="true"></i><span>Coordenadas</span><strong>${esc(e.coords || "—")}</strong></div>
    ${e.desc ? `<div class="mrow"><i class="ti ti-message-circle" aria-hidden="true"></i><span>Descripción</span><strong style="white-space:pre-wrap">${esc(e.desc)}</strong></div>` : ""}
    <div class="mrow" style="padding-bottom:4px;display:flex;gap:8px">
      <button data-pid="${esc(e.id)}" onclick="editPhoto(this.dataset.pid)" style="flex:1;padding:10px;background:rgba(34,114,232,0.15);color:#85B7EB;border:1px solid rgba(34,114,232,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:5px;margin-top:4px">
        <i class="ti ti-pencil" aria-hidden="true"></i> Editar
      </button>
      ${e.src ? `<button onclick="exportarFotoGaleria()" style="flex:1;padding:10px;background:rgba(34,176,80,0.15);color:#5DCAA5;border:1px solid rgba(34,176,80,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:5px;margin-top:4px">
        <i class="ti ti-download" aria-hidden="true"></i> Exportar
      </button>` : ""}
      <button onclick="borrarFotoGaleria()" style="flex:1;padding:10px;background:rgba(232,40,40,0.15);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:5px;margin-top:4px">
        <i class="ti ti-trash" aria-hidden="true"></i> Borrar
      </button>
    </div>
    <div class="mrow" style="padding-bottom:2px">
      <button data-fid="${esc(e.id)}" onclick="goToFeedPhoto(this.dataset.fid)" style="width:100%;padding:10px;background:rgba(34,114,232,0.12);color:#9cc4f0;border:1px solid rgba(34,114,232,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px">
        <i class="ti ti-arrow-right" aria-hidden="true"></i> Ver en el feed
      </button>
    </div>
    <div class="mrow"><i class="ti ti-eye" aria-hidden="true"></i><span>Visibilidad</span>
      <strong style="display:flex;gap:6px;margin-top:4px">
        ${["privado", "amigos", "publico"].map(t => `
          <button data-pid="${esc(e.id)}" data-vis="${t}" onclick="changePhotoVis(this.dataset.pid, this.dataset.vis, this)"
            style="padding:4px 10px;border:none;border-radius:999px;font-size:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;
              background-color:${e.vis === t ? "#2272e8" : "rgba(255,255,255,0.1)"};
              color:${e.vis === t ? "#fff" : "rgba(255,255,255,0.6)"};">
            ${t}
          </button>`).join("")}
      </strong>
    </div>`;
    document.getElementById("photo-modal").classList.add("open");
}

// ═══════════════════════════════════════════════════════════
//  IR A LA PUBLICACIÓN DE UNA NOTIFICACIÓN
//  Si ya está pintada en el feed → scroll directo.
//  Si no (publicación antigua, de otro filtro, etc.) → se abre ella
//  sola en modo "permalink", sin depender de paginar el feed entero.
// ═══════════════════════════════════════════════════════════

// Cambia a la pestaña feed SIN llamar a loadFeed() (que pisaría lo que pintamos)
function _irAFeedSinRecargar() {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById("screen-feed")?.classList.add("active");
    if (typeof updateNavColors === "function") updateNavColors("feed");
    if (typeof clearFeedBadge === "function") clearFeedBadge();
}

// Busca la publicación ya pintada y hace scroll. true si la encontró.
function _resaltarPost(fid) {
    const el = document.getElementById("comments-" + fid)
            || document.querySelector('img[data-foto-id="' + fid + '"]');
    const post = el?.closest?.(".feed-post") || (el && el.classList?.contains("feed-post") ? el : null);
    if (!post) return false;
    post.scrollIntoView({ behavior: "smooth", block: "center" });
    post.style.transition = "box-shadow .3s";
    post.style.boxShadow = "0 0 0 2px #22b050";
    setTimeout(() => { post.style.boxShadow = ""; }, 2000);
    return true;
}

function _btnVolverFeed(estilo) {
    return '<button onclick="loadFeed(true)" style="' + estilo + '">'
        + '<i class="ti ti-arrow-left" aria-hidden="true"></i> Volver al feed</button>';
}

function _postNoDisponible(msg) {
    return '<div style="text-align:center;padding:36px 18px;color:rgba(255,255,255,0.35);font-size:13px;line-height:1.7">'
        + '<i class="ti ti-photo-off" aria-hidden="true" style="font-size:30px;display:block;margin-bottom:10px"></i>'
        + (msg || "Esta publicación ya no está disponible.") + '<br>'
        + _btnVolverFeed("margin-top:14px;padding:8px 18px;background:rgba(34,114,232,0.15);color:#9cc4f0;border:1px solid rgba(34,114,232,0.3);border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:inline-flex;align-items:center;gap:6px")
        + '</div>';
}

async function goToFeedPhoto(fid) {
    fid = String(fid || "").replace(/_(fire|love)$/, "");
    if (!fid) return;
    closePM();
    _irAFeedSinRecargar();
    if (_resaltarPost(fid)) return;      // ya estaba pintada
    await renderPostUnico(fid);          // si no, la abrimos sola
}

// Pinta UNA sola publicación (la de la notificación) en el feed
async function renderPostUnico(fid) {
    const fp = document.getElementById("feed-posts");
    if (!fp || !state.user) return;

    state._feedMode = "post";
    state.feedCache = null;              // corta el scroll infinito del feed normal
    if (typeof clearGlobalRanking === "function") clearGlobalRanking();
    const sr = document.getElementById("stories-row");
    if (sr) { sr.innerHTML = ""; sr.style.display = "none"; }
    const sent = document.getElementById("feed-sentinel");
    if (sent) sent.textContent = "";
    fp.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 10px"></div>Abriendo publicación...</div>';

    try {
        const cols = "id,user_id,municipio,storage_path,thumb_path,descripcion,rating,visibilidad,created_at,batch_id";
        let r = await db.from("photos").select(cols).eq("id", fid).maybeSingle();
        if (r.error && /rating|batch_id|thumb_path|column|schema cache/i.test(r.error.message || "")) {
            r = await db.from("photos").select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at").eq("id", fid).maybeSingle();
        }
        const base = r.data;
        if (!base) { fp.innerHTML = _postNoDisponible(); return; }
        if (state.blockedIds?.has(base.user_id)) {
            fp.innerHTML = _postNoDisponible("Has bloqueado a quien publicó esto.");
            return;
        }

        // Resto del lote, para que el carrusel salga completo
        let lote = [base];
        try {
            if (base.batch_id) {
                const { data } = await db.from("photos").select(cols)
                    .eq("batch_id", base.batch_id).eq("user_id", base.user_id);
                if (data?.length) lote = data;
            } else {
                const { data } = await db.from("photos").select(cols)
                    .eq("user_id", base.user_id).eq("municipio", base.municipio)
                    .order("created_at", { ascending: !1 }).limit(30);
                const minuto = String(base.created_at || "").slice(0, 16);
                const mismos = (data || []).filter(p => !p.batch_id && String(p.created_at || "").slice(0, 16) === minuto);
                if (mismos.length) lote = mismos;
            }
        } catch (_) {}

        const { data: prof } = await db.from("profiles")
            .select("id,username,avatar_url").eq("id", base.user_id).maybeSingle();

        const g    = lote.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const imgs = g.filter(x => x.storage_path && x.storage_path !== "text_only");
        // El representativo debe ser el de la notificación: comentarios y likes
        // cuelgan de ese id concreto.
        const rep  = g.find(x => x.id === fid) || imgs[0] || g[0];

        const post = {
            id: "pu_" + fid, _batchKey: "pu_" + fid, _batchId: base.batch_id || null,
            user_id: base.user_id, municipio: base.municipio, visibilidad: base.visibilidad,
            created_at: g.reduce((m, x) => x.created_at > m ? x.created_at : m, g[0].created_at),
            profiles: prof || null, _fotos: imgs, _foto: rep
        };

        fp.innerHTML = "";
        await renderFeedPosts([post], {}, {}, prof ? [prof] : [], !1);
        fp.insertAdjacentHTML("afterbegin",
            _btnVolverFeed("margin:0 0 10px;padding:8px 14px;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.6);border:none;border-radius:999px;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;display:inline-flex;align-items:center;gap:6px"));
        setTimeout(() => _resaltarPost(rep.id), 250);
    } catch (e) {
        console.error("renderPostUnico:", e);
        fp.innerHTML = _postNoDisponible();
    }
}

// Notificación de solicitud de amistad → perfil, con scroll a la sección
function goToSolicitudes() {
    switchScreen("profile");
    setTimeout(() => {
        const s = document.getElementById("solicitudes-section");
        if (!s) return;
        s.scrollIntoView({ behavior: "smooth", block: "center" });
        s.style.transition = "box-shadow .3s";
        s.style.boxShadow = "0 0 0 2px #e86820";
        setTimeout(() => { s.style.boxShadow = ""; }, 2000);
    }, 400);
}

// Borrar la foto abierta en el modal (BD + Storage + galería local)
async function borrarFotoGaleria() {
    const p = state.currentPM;
    if (!p || !state.user) return;
    if (!await confirmar("¿Borrar esta foto definitivamente?", { titulo: "Borrar foto", ok: "Borrar", peligro: !0 })) return;
    try {
        if (p.id) await db.from("photos").delete().eq("id", p.id).eq("user_id", state.user.id);
        if (p.path && p.path !== "text_only") await db.storage.from("evidencias").remove([p.path]);
        const idx = state.photos.findIndex(x => x.id === p.id);
        if (idx >= 0) state.photos.splice(idx, 1);
        renderGallery();
        closePM();
        state.feedCache = null; // que el feed se refresque
        toast("Foto borrada", "info");
    } catch (err) {
        toast("Error al borrar: " + err.message, "error");
    }
}

// Exportar la foto abierta a la galería del móvil
async function exportarFotoGaleria() {
    const p = state.currentPM;
    if (!p || !p.src) return;
    try {
        const blob = await fetch(p.src).then(r => r.blob());
        const file = new File([blob], "ya-lo-pise-" + (p.muni || "foto").replace(/\s+/g, "-").toLowerCase() + ".jpg", { type: blob.type || "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            // En iOS/Android sale "Guardar imagen" en el menú
            await navigator.share({ files: [file] }).catch(() => {});
        } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
        }
    } catch (err) {
        toast("No se pudo exportar la foto", "error");
    }
}

async function changePhotoVis(e, t, i) {
    if (!e) return;
    await db.from("photos").update({
        visibilidad: t
    }).eq("id", e);
    const n = state.photos.find(t => t.id === e);
    n && (n.vis = t), i.closest("strong").querySelectorAll("button").forEach(e => {
        e.style.backgroundColor = e.textContent.trim() === t ? "#2272e8" : "rgba(255,255,255,0.1)", e.style.color = e.textContent.trim() === t ? "#fff" : "rgba(255,255,255,0.6)"
    })
}

function closePM() {
    document.getElementById("photo-modal").classList.remove("open");
    const x = document.getElementById("pm-close-x");
    if (x) x.style.display = "none";
}
// Botón X fijo para cerrar la tarjeta de foto de la galería (por si el
// diseño de photo-modal no trae ya uno visible)
function ensurePMCloseBtn() {
    if (document.getElementById("pm-close-x")) return;
    const btn = document.createElement("button");
    btn.id = "pm-close-x";
    btn.setAttribute("aria-label", "Cerrar");
    btn.innerHTML = "✕";
    btn.style.cssText = "position:fixed;top:16px;right:16px;z-index:2000;width:34px;height:34px;border-radius:50%;background:rgba(10,16,24,0.65);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:16px;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center";
    btn.onclick = closePM;
    document.body.appendChild(btn);
}async function editPhoto(e) {
    const t = state.photos.find(t => t.id === e);
    if (!t) return;
    const i = prompt("Editar descripción:", t.desc || "");
    if (null === i) return;
    const {
        error: n
    } = await db.from("photos").update({
        descripcion: i
    }).eq("id", e).eq("user_id", state.user.id);
    n ? toast("Error: " + n.message, "error") : (t.desc = i, state.feedCache = null)
}
async function deletePhoto(e) {
    const t = state.photos[e];
    if (!t || !state.user) return;
    if (!await confirmar("¿Borrar esta foto de " + t.muni + "? Esta acción no se puede deshacer.", { titulo: "Borrar foto", ok: "Borrar", peligro: !0 })) return;
    try {
        t.path && "text_only" !== t.path && await db.storage.from("evidencias").remove([t.path]), t.id && await db.from("photos").delete().eq("id", t.id).eq("user_id", state.user.id), state.photos.splice(e, 1), state.feedCache = null, closePM(), renderGallery();
        document.getElementById("sph").textContent = state.photos.length;
        toast("Foto borrada", "info")
    } catch (e) {
        toast("Error al borrar: " + e.message, "error")
    }
}

function toggleEdit() {
    const e = document.getElementById("u-edit-row");
    "1" === e.getAttribute("data-open") ? (e.style.display = "none", e.setAttribute("data-open", "0")) : (e.style.display = "flex", e.setAttribute("data-open", "1"), document.getElementById("u-inp").value = state.profile?.username || "", document.getElementById("u-inp").focus())
}
async function saveUser() {
    const e = document.getElementById("u-inp").value.trim();
    if (!e || !state.user) return;
    await db.from("profiles").update({
        username: e
    }).eq("id", state.user.id), state.profile && (state.profile.username = e), document.getElementById("u-name").textContent = e, document.getElementById("av-init").textContent = e.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2);
    const t = document.getElementById("u-edit-row");
    t.style.display = "none", t.setAttribute("data-open", "0")
}
async function loadMap() {
    try {
        const [{
            data: e
        }, {
            data: t
        }] = await Promise.all([db.from("municipios").select("*"), db.from("visits").select("municipio")]);
        // Rutas desde la BD (tabla "rutas"). Si no existe aún, se usa el array semilla.
        try {
            const { data: rt, error: rtErr } = await db.from("rutas").select("nombre,km,muni,url").order("km", { ascending: !1 });
            if (!rtErr && Array.isArray(rt)) state.rutas = rt;
        } catch (_) { /* tabla rutas no creada todavía */ }
        e && (state.municipiosData = {}, e.forEach(e => {
            state.municipiosData[e.nombre] = e
        }), state.coast = e.filter(e => "costa" === e.tipo).map(e => e.nombre), state.mountain = e.filter(e => "montaña" === e.tipo).map(e => e.nombre)), state.popularidad = {}, (t || []).forEach(e => {
            state.popularidad[e.municipio] = (state.popularidad[e.municipio] || 0) + 1
        }), document.getElementById("screen-dado").classList.contains("active") && renderMuniList();
        const i = await d3.json("https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json"),
            n = {
                type: "FeatureCollection",
                features: topojson.feature(i, i.objects.municipalities).features.filter(e => String(e.id || "").startsWith("39") || 53072 === e.id || "53072" === e.id)
            };
        state.totalMuni = n.features.length;
        state.topoData = i; // reutilizado por exportarMapa
        state.muniFeatures = {};
        n.features.forEach(f => {
            let nm = f.properties.name || f.properties.NAME || f.properties.NAMEUNIT || "Mun-" + f.id;
            if (nm === "Comunidad de Campoo y Cabuérniga") nm = "Mancomunidad de Campoo-Cabuérniga";
            state.muniFeatures[nm] = f;
        });
        const o = document.getElementById("map-cont").clientWidth || 410,
            a = Math.round(.58 * o);
        state.mapDims = { W: o, H: a };
        document.getElementById("map-svg").setAttribute("viewBox", `0 0 ${o} ${a}`);
        const pad = 12,
            d = d3.geoMercator().fitExtent([[pad, pad], [o - pad, a - pad]], n),
            l = d3.geoPath(d),
            c = d3.select("#map-svg");
        state.mapProjection = d; state.mapSvgNode = c.node();
        c.selectAll("*").remove();

        // Degradados y brillo
        const defs = c.append("defs");
        const gv = defs.append("linearGradient").attr("id", "grad-visited")
            .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
        gv.append("stop").attr("offset", "0%").attr("stop-color", "#34d06b");
        gv.append("stop").attr("offset", "100%").attr("stop-color", "#1a9a48");
        const gs = defs.append("linearGradient").attr("id", "grad-sea")
            .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
        gs.append("stop").attr("offset", "0%").attr("stop-color", "#6aa3d8");
        gs.append("stop").attr("offset", "55%").attr("stop-color", "#4d87bf");
        gs.append("stop").attr("offset", "100%").attr("stop-color", "#3a6fa3");
        const glow = defs.append("filter").attr("id", "glow-visited")
            .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
        glow.append("feGaussianBlur").attr("stdDeviation", "1.6").attr("result", "blur");
        const mg = glow.append("feMerge");
        mg.append("feMergeNode").attr("in", "blur");
        mg.append("feMergeNode").attr("in", "SourceGraphic");

        // Brillo dorado para el municipio en "modo agrandado" (spotlight)
        const glowSel = defs.append("filter").attr("id", "glow-select")
            .attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
        glowSel.append("feDropShadow").attr("dx", 0).attr("dy", 0).attr("stdDeviation", 2.4)
            .attr("flood-color", "#e8c93a").attr("flood-opacity", 0.85);

        c.append("rect").attr("id", "map-sea-bg").attr("width", o).attr("height", a).attr("fill", "url(#grad-sea)")
            .style("cursor", "default")
            .on("click", () => { if (state.mapZoomedMuni) unzoomMuni(); });

        // Grupo zoomable: municipios + bordes
        const g = c.append("g").attr("id", "map-zoom-group");

        // Comunidades vecinas como tierra MARRÓN (incluye Bizkaia y
        // Álava para que no quede hueco azul a la derecha)
        const provOf = id => String(id).padStart(5, "0").slice(0, 2);
        const NEIGHBORS = ["33", "24", "34", "09", "48", "01"];
        const vecinos = i.objects.municipalities.geometries.filter(gm => NEIGHBORS.includes(provOf(gm.id)));
        if (vecinos.length) {
            g.append("path")
                .datum(topojson.merge(i, vecinos))
                .attr("d", l).attr("fill", "#cbb287")
                .attr("stroke", "rgba(110,86,55,0.55)").attr("stroke-width", "0.5px")
                .attr("pointer-events", "none");
            g.append("path")
                .datum(topojson.mesh(i, { type: "GeometryCollection", geometries: vecinos }, (a, b) => a !== b && provOf(a.id) !== provOf(b.id)))
                .attr("d", l).attr("fill", "none")
                .attr("stroke", "rgba(110,86,55,0.7)").attr("stroke-width", "0.8px")
                .attr("pointer-events", "none");
        }

        // Sombra bajo Cantabria: profundidad sobre el mar/tierra
        const shadowF = defs.append("filter").attr("id", "cant-shadow")
            .attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
        shadowF.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", "2.5");
        shadowF.append("feOffset").attr("dy", "1.5");
        shadowF.append("feComponentTransfer").append("feFuncA").attr("type", "linear").attr("slope", "0.45");
        const cantGeoms = i.objects.municipalities.geometries.filter(gm => String(gm.id || "").startsWith("39") || 53072 === gm.id || "53072" === gm.id);
        g.append("path")
            .datum(topojson.merge(i, cantGeoms))
            .attr("d", l).attr("fill", "#000")
            .attr("filter", "url(#cant-shadow)")
            .attr("pointer-events", "none");

        g.selectAll("path.muni-path").data(n.features).join("path").attr("class", e => {
            const t = e.properties.name || e.properties.NAME || e.properties.NAMEUNIT || "Mun-" + e.id;
            let cls = "muni-path";
            if (state.visited[t]) cls += " visited";
            return cls;
        }).attr("d", l).attr("data-name", e => {
            const t = e.properties.name || e.properties.NAME || e.properties.NAMEUNIT || "Mun-" + e.id;
            return "Comunidad de Campoo y Cabuérniga" === t ? "Mancomunidad de Campoo-Cabuérniga" : t;
        }).style("stroke", "none").on("click", function() {
            const name = d3.select(this).attr("data-name");
            selectMuniOnMap(name);
        });

        const u = e => String(e).startsWith("39") || 53072 === e || "53072" === e;
        g.append("path").datum(topojson.mesh(i, i.objects.municipalities, (e, t) => e !== t && u(e.id) && u(t.id)))
            .attr("d", l).attr("fill", "none").attr("stroke", "#111418")
            .attr("stroke-width", "0.6px").attr("pointer-events", "none").attr("class", "map-mesh-inner");
        g.append("path").datum(topojson.mesh(i, i.objects.municipalities, (e, t) => e === t && u(e.id)))
            .attr("d", l).attr("fill", "none").attr("stroke", "#111418")
            .attr("stroke-width", "0.6px").attr("pointer-events", "none").attr("class", "map-mesh-outer");
        // Los bordes siempre por encima (aunque un municipio se repinte)
        g.selectAll(".map-mesh-inner,.map-mesh-outer").raise();

        // Zoom y paneo (pellizcar / arrastrar)
        state.mapZoom = d3.zoom()
            .scaleExtent([1, 8])
            .translateExtent([[0, 0], [o, a]])
            .on("zoom", ev => {
                g.attr("transform", ev.transform);
                const k = ev.transform.k;
                g.select(".map-mesh-inner").style("stroke-width", (0.4 / k) + "px");
                g.select(".map-mesh-outer").style("stroke-width", (0.6 / k) + "px");
                const rb = document.getElementById("map-reset-zoom");
                if (rb) rb.style.display = k > 1.05 ? "flex" : "none";
                if (state._meXY) g.select("#me-dot").attr("transform", "translate(" + state._meXY[0] + "," + state._meXY[1] + ") scale(" + (1 / k) + ")");
            });
        c.call(state.mapZoom).on("dblclick.zoom", null);

        // Botón flotante "ver toda Cantabria"
        const mc = document.getElementById("map-cont");
        if (!document.getElementById("map-reset-zoom")) {
            const rb = document.createElement("button");
            rb.id = "map-reset-zoom";
            rb.innerHTML = '<i class="ti ti-zoom-out-area" aria-hidden="true"></i>';
            rb.title = "Ver toda Cantabria";
            rb.setAttribute("aria-label", "Ver toda Cantabria");
            rb.onclick = () => { if (state.mapZoomedMuni) unzoomMuni(); else resetMapZoom(); };
            mc.appendChild(rb);
        }

        document.getElementById("map-load").style.display = "none", refreshMapVisited(), updateProgress(), showMyLocationOnMap()
    } catch (e) {
        document.getElementById("map-load").innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:12px;padding:20px;text-align:center">Error al cargar el mapa.</p>'
    }
}

// Punto "estás aquí" en el mapa, con GPS de alta precisión. Se ancla al grupo
// zoomable (se mueve y escala con el mapa) y se refresca al entrar al mapa.
function showMyLocationOnMap() {
    if (!navigator.geolocation || !state.mapProjection) return;
    navigator.geolocation.getCurrentPosition(pos => {
        state.lastLngLat = [pos.coords.longitude, pos.coords.latitude];
        const xy = state.mapProjection(state.lastLngLat);
        if (!xy || isNaN(xy[0])) return;
        const g = d3.select("#map-zoom-group");
        if (g.empty()) return;
        state._meXY = xy;
        const k = (state.mapSvgNode ? d3.zoomTransform(state.mapSvgNode).k : 1) || 1;
        let dot = g.select("#me-dot");
        if (dot.empty()) {
            dot = g.append("g").attr("id", "me-dot").attr("pointer-events", "none");
            dot.append("circle").attr("r", 7).attr("fill", "rgba(34,114,232,0.22)").attr("stroke", "rgba(34,114,232,0.45)").attr("stroke-width", 0.6);
            dot.append("circle").attr("r", 3.4).attr("fill", "#2272e8").attr("stroke", "#fff").attr("stroke-width", 1.4);
        }
        dot.attr("transform", "translate(" + xy[0] + "," + xy[1] + ") scale(" + (1 / k) + ")").raise();
    }, err => { console.warn("GPS mapa:", err && err.message); }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 10000 });
}

function refreshMapVisited() {
    d3.selectAll(".muni-path").each(function() {
        const e = d3.select(this).attr("data-name");
        state.visited[e] && d3.select(this).classed("visited", !0).classed("is-coast", !1)
    })
}

function updateClock() {
    const e = (new Date).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit"
    });
    document.querySelectorAll(".clock").forEach(t => {
        t.textContent = e
    })
}
async function checkForUpdates() {
    try {
        const e = document.querySelector('meta[name="app-version"]')?.content;
        if (!e) return;
        const t = localStorage.getItem("ce_version");
        if (t && t !== e) {
            if (console.log("Nueva versión detectada, limpiando cache..."), "caches" in window) {
                const e = await caches.keys();
                // Las cachés ylp-* las gestiona el service worker (offline)
                await Promise.all(e.filter(k => !k.startsWith("ylp-")).map(k => caches.delete(k)))
            }
            localStorage.setItem("ce_version", e)
        } else localStorage.setItem("ce_version", e)
    } catch (e) {
        console.log("checkForUpdates error:", e)
    }
}

function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    const v = document.querySelector('meta[name="app-version"]')?.content || "1";
    navigator.serviceWorker.register("sw.js?v=" + v).catch(e => console.warn("SW:", e));
}
async function init() {
    buildNavs(), renderDice(6), updateClock(), setInterval(updateClock, 3e4), setInterval(() => { if (state.user) loadNotifBadge(); }, 12e4);
    if (/type=recovery/.test(window.location.hash + window.location.search) || /access_token=/.test(window.location.hash)) {
        state.recoveryMode = !0;
    }
    const e = setTimeout(() => {
            document.getElementById("splash")?.remove(), showAuth()
        }, 5e3),
        {
            data: {
                session: t
            }
        } = await db.auth.getSession();
    clearTimeout(e);
    if (state.recoveryMode) {
        promptNuevaPassword();
    } else if (t?.user) {
        try { await loadUserData(t.user); } catch (err) { console.error("init:", err); }
        showApp(); loadMap(); loadEventos();
    } else showAuth();
    db.auth.onAuthStateChange(async (e, t) => {
        if ("PASSWORD_RECOVERY" === e) { state.recoveryMode = !0; return promptNuevaPassword(); }
        if (state.recoveryMode) return;
        "SIGNED_OUT" === e ? showAuth() : "SIGNED_IN" === e && t?.user && !state.user && (await loadUserData(t.user), showApp(), loadMap(), loadEventos())
    })
}
document.getElementById("av-in").addEventListener("change", async function(e) {
    const t = e.target.files[0];
    if (!t || !state.user) return;
    const i = document.getElementById("av-ring"),
        n = i.querySelector("#av-init")?.textContent || "EX";
    i.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;width:100%;height:100%">...</div>';
    try {
        const comp = await compressImage(t, 512, 0.85),
            blob = await (await fetch(comp.base64)).blob(),
            e = comp.mime.includes("png") ? "png" : "jpg",
            n = `${state.user.id}.${e}`;
        await db.storage.from("avatares").remove([n]);
        const {
            data: o,
            error: a
        } = await db.storage.from("avatares").upload(n, blob, {
            contentType: comp.mime,
            upsert: !0,
            cacheControl: "3600"
        });
        if (a) throw console.error("Upload error:", a), new Error(a.message);
        const {
            data: s
        } = db.storage.from("avatares").getPublicUrl(n), r = s?.publicUrl;
        if (!r) throw new Error("No se pudo obtener la URL pública");
        // Versión estable en la propia URL: caché eficiente y solo se invalida
        // cuando cambia el avatar (no en cada render).
        const versioned = r + "?v=" + Date.now();
        const {
                error: l
            } = await db.from("profiles").update({
                avatar_url: versioned
            }).eq("id", state.user.id);
        if (l) throw l;
        state.profile && (state.profile.avatar_url = versioned), i.innerHTML = `<img src="${versioned}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`
    } catch (e) {
        console.error("Avatar error:", e), i.innerHTML = `<span id="av-init">${n}</span><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`, toast("No se pudo subir el avatar. Inténtalo de nuevo.", "error")
    }
}), init();
const VAPID_PUBLIC_KEY = "BIeBLHW1SBvzcH4LO6B7Ode2x66CuXUa8bjY_BCXbO6oYGA2p1hcstmOao4gtW3Kc01Y6BEpInA6EOq1lKlA4Y4";
// La clave pública VAPID real se asigna a la constante existente abajo
async function registerPushNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return void alert("Este dispositivo no soporta notificaciones push.\n\nEn iPhone: añade la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.");
    }
    if (!state.user) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        // Si la suscripción existente se creó con OTRA clave VAPID, hay que rehacerla:
        // si no, el navegador reutiliza la vieja para siempre y el envío falla.
        if (sub) {
            try {
                const actual = new Uint8Array(sub.options?.applicationServerKey || []);
                const nueva = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
                const igual = actual.length === nueva.length && actual.every((v, i) => v === nueva[i]);
                if (!igual) { await sub.unsubscribe(); sub = null; }
            } catch (_) { try { await sub.unsubscribe(); } catch (__) {} sub = null; }
        }
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: !0,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }
        const { error } = await db.from("push_subscriptions").upsert(
            { user_id: state.user.id, subscription: sub.toJSON() },
            { onConflict: "user_id" }
        );
        if (error) throw error;
        state.pushRegistered = !0;
        console.log("✅ Push registrado");
    } catch (e) {
        console.error("Error registrando push:", e);
        throw e;
    }
}

function urlBase64ToUint8Array(e) {
    const t = (e + "=".repeat((4 - e.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"),
        i = window.atob(t),
        n = new Uint8Array(i.length);
    for (let e = 0; e < i.length; e++) n[e] = i.charCodeAt(e);
    return n
}

// ── Estado real de las notificaciones (permiso + suscripción) ──
async function getPushStatus() {
    if (window.nativePushRegister) return state.pushRegistered ? "activas" : "off";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "nosoporta";
    if (typeof Notification === "undefined") return "nosoporta";
    if (Notification.permission === "denied") return "bloqueadas";
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") return "activas";
    } catch (_) {}
    return "off";
}

async function syncNotifButton() {
    const b = document.getElementById("btn-notif");
    if (!b || !state.user) return;
    const st = await getPushStatus();
    state.pushRegistered = (st === "activas");
    b.disabled = false;
    if (st === "activas") {
        b.innerHTML = "🔔 Notificaciones activas";
        b.style.backgroundColor = "#14533a";
        b.style.color = "#8fe8bd";
        // Reasegura una sola vez por sesión que la suscripción sigue en Supabase
        if (!state._pushSynced) {
            state._pushSynced = true;
            try { await registerPushNotifications(); } catch (_) {}
        }
    } else if (st === "bloqueadas") {
        b.innerHTML = "🚫 Notificaciones bloqueadas";
        b.style.backgroundColor = "rgba(255,255,255,0.08)";
        b.style.color = "rgba(255,255,255,0.5)";
    } else {
        b.innerHTML = "🔕 Activar notificaciones";
        b.style.backgroundColor = "#1848a8";
        b.style.color = "#b0d4ff";
    }
}

async function toggleNotifications() {
    const b = document.getElementById("btn-notif");
    if (!b || !state.user) return;
    const st = await getPushStatus();

    // Ya activas → ofrecer desactivarlas
    if (st === "activas") {
        const ok = await confirmar(
            "Dejarás de recibir avisos de solicitudes de amistad y actividad de tus amigos.",
            { titulo: "¿Desactivar notificaciones?", ok: "Desactivar", cancel: "Cancelar", peligro: true }
        );
        if (!ok) return;
        b.textContent = "Desactivando..."; b.disabled = true;
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
            await db.from("push_subscriptions").delete().eq("user_id", state.user.id);
            state.pushRegistered = false;
            state._pushSynced = false;
            toast("Notificaciones desactivadas", "info");
        } catch (err) {
            toast("No se pudieron desactivar: " + err.message, "error");
        }
        return void syncNotifButton();
    }

    // Permiso denegado a nivel de navegador/sistema
    if (st === "bloqueadas") {
        return void alert("Tienes las notificaciones bloqueadas para esta app.\n\nActívalas desde los ajustes del navegador o del móvil (Ajustes → Notificaciones → Ya lo pisé) y vuelve aquí.");
    }

    // iPhone en Safari sin instalar
    if (st === "nosoporta") {
        return void alert("Para recibir notificaciones en iPhone, añade primero la app a la pantalla de inicio:\n\nCompartir → Añadir a pantalla de inicio, y ábrela desde ahí.");
    }

    // Activar
    b.textContent = "Activando..."; b.disabled = true;
    try {
        if (!window.nativePushRegister) {
            if ("granted" !== await Notification.requestPermission()) {
                toast("Necesitas dar permiso para activarlas", "error");
                return void syncNotifButton();
            }
        }
        await registerPushNotifications();
        state._pushSynced = true;
        toast("Notificaciones activadas 🔔", "success");
    } catch (err) {
        toast("Error activando notificaciones: " + err.message, "error");
    }
    syncNotifButton();
}

function subscribeToFriendActivity() {
    state.user && !state.realtimeSubscribed && (state.realtimeSubscribed = !0, db.channel("friend-visits").on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "visits"
    }, e => {
        const t = state.feedCache?.friendProfiles?.some(t => t.id === e.new.user_id);
        (t || e.new.user_id === state.user.id) && (state.feedCache = null, showFeedBadge())
    }).on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "photo_comments"
    }, e => {
        loadVisitComments(e.new.photo_id, null)
    }).subscribe())
}

function showFeedBadge() {
    document.querySelectorAll('[id^="nb-"][id$="-feed"]').forEach(e => {
        if (!e.querySelector(".feed-badge")) {
            const t = document.createElement("div");
            t.className = "feed-badge", t.style.cssText = "position:absolute;top:6px;right:10px;width:8px;height:8px;background:#e8288a;border-radius:50%;border:2px solid #0f1923", e.style.position = "relative", e.appendChild(t)
        }
    })
}

function clearFeedBadge() {
    document.querySelectorAll(".feed-badge").forEach(e => e.remove())
}

function checkInsignia(e, t) {
    // El sistema de insignias/niveles (refreshBadgesAndLevel) gestiona ahora
    // todos los logros, incluido "El Cántabru". Se deja como no-op por compat.
}

function showInsignia() {
    if (document.getElementById("insignia-modal")) return;
    const e = document.createElement("div");
    e.id = "insignia-modal", e.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center", e.innerHTML = '<div style="font-size:72px;margin-bottom:16px">🏔️</div><div style="font-family:Playfair Display,serif;font-size:28px;font-weight:700;color:#fff;margin-bottom:8px">¡El Cántabru!</div><div style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;margin-bottom:24px">Has pisado los 103 municipios de Cantabria.<br>Eres oficialmente un Cántabru de pura cepa.</div><div style="background:linear-gradient(135deg,#e8b820,#e86820);border-radius:16px;padding:16px 24px;margin-bottom:24px"><div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Insignia desbloqueada</div><div style="font-size:18px;font-weight:700;color:#fff">🏆 El Cántabru</div></div><button onclick="document.getElementById(\'insignia-modal\').remove()" style="padding:12px 28px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">¡A por más aventuras!</button>', document.getElementById("app").appendChild(e), launchConfetti(), launchConfetti(), launchConfetti()
}

function launchConfetti() {
    const e = ["#22b050", "#e8288a", "#e8b820", "#2272e8", "#e86820", "#ffffff"],
        t = document.getElementById("app");
    for (let i = 0; i < 60; i++) {
        const i = document.createElement("div"),
            n = e[Math.floor(Math.random() * e.length)],
            o = 8 * Math.random() + 4,
            a = 100 * Math.random(),
            s = .6 * Math.random(),
            r = 1.5 * Math.random() + 1;
        Math.random();
        i.style.cssText = "position:absolute;top:-20px;left:" + a + "%;width:" + o + "px;height:" + o + "px;background:" + n + ";border-radius:" + (Math.random() > .5 ? "50%" : "2px") + ";pointer-events:none;z-index:999;animation:confetti-fall " + r + "s ease-in " + s + "s forwards", t.appendChild(i), setTimeout(() => i.remove(), 1e3 * (s + r) + 100)
    }
}
async function loadEventos() {
    const [e, t] = await Promise.all([loadEventosSupabase(), loadEventosSantander()]), i = new Map;
    [...e, ...t].forEach(e => {
        const t = e.nombre + e.fecha;
        i.has(t) || i.set(t, e)
    }), state.eventos = [...i.values()].sort((e, t) => new Date(e.fecha) - new Date(t.fecha)), renderEventos()
}
async function loadEventosSupabase() {
    const {
        data: e
    } = await db.from("eventos").select("*").eq("activo", !0).order("fecha");
    return (e || []).map(e => ({
        ...e,
        source: "local"
    }))
}
async function loadEventosSantander() {
    try {
        const e = "https://datos.santander.es/api/rest/datasets/agenda_cultural.json?items=20",
            t = await fetch("https://api.allorigins.win/get?url=" + encodeURIComponent(e));
        if (!t.ok) return [];
        const i = await t.json(),
            n = JSON.parse(i.contents);
        return (n?.resources || n?.result?.resources || []).filter(e => {
            const t = e["dc:date"] || e.fecha || "";
            return t && new Date(t) >= new Date
        }).slice(0, 10).map(e => ({
            id: "stander-" + (e.uri || Math.random()),
            nombre: e["dc:title"] || e.titulo || "Evento cultural",
            lugar: e["vcard:locality"] || e.lugar || "Santander",
            fecha: e["dc:date"] || e.fecha || (new Date).toISOString(),
            dia_semana: new Date(e["dc:date"] || e.fecha).toLocaleDateString("es-ES", {
                weekday: "short"
            }),
            tipo: "cultura",
            descripcion: e["dc:description"] || e.descripcion || "",
            tipo_badge: "Agenda Santander",
            color_bg: "#1a0d2a",
            icon: "ti-star",
            activo: !0,
            source: "api",
            url: e["dc:identifier"] || ""
        }))
    } catch (e) {
        return console.log("API Santander no disponible:", e.message), []
    }
}
async function exportarMapa() {
    const btn = document.getElementById("btn-export-map");
    btn && (btn.textContent = "Generando...", btn.disabled = !0);
    try {
        let topo = state.topoData;
        if (!topo) topo = await d3.json("https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json");
        const feats = topojson.feature(topo, topo.objects.municipalities).features
            .filter(f => String(f.id || "").startsWith("39") || 53072 === f.id || "53072" === f.id);
        const coll = { type: "FeatureCollection", features: feats };

        const W = 1080, H = 1920;
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        const rr = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        };

        // Fondo
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#0f1923"); bg.addColorStop(.45, "#152b42"); bg.addColorStop(1, "#0f1923");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const g1 = ctx.createRadialGradient(W * .85, H * .16, 0, W * .85, H * .16, 430);
        g1.addColorStop(0, "rgba(34,176,80,0.20)"); g1.addColorStop(1, "rgba(34,176,80,0)");
        ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
        const g2 = ctx.createRadialGradient(W * .12, H * .8, 0, W * .12, H * .8, 470);
        g2.addColorStop(0, "rgba(232,104,32,0.15)"); g2.addColorStop(1, "rgba(232,104,32,0)");
        ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

        // Título + usuario
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = "italic bold 104px Georgia, 'Times New Roman', serif";
        ctx.fillText("Ya lo pisé", W / 2, 220);
        ctx.font = "40px -apple-system, Helvetica, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText("@" + (state.profile?.username || "explorer"), W / 2, 292);

        // Mapa
        const proj = d3.geoMercator().fitExtent([[80, 400], [W - 80, 1150]], coll);
        const path = d3.geoPath(proj, ctx);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 46; ctx.shadowOffsetY = 16;
        ctx.beginPath(); path(coll);
        ctx.fillStyle = "#2c3f54"; ctx.fill();
        ctx.restore();
        const nameOf = f => {
            let nm = f.properties.name || f.properties.NAME || f.properties.NAMEUNIT || "";
            return nm === "Comunidad de Campoo y Cabuérniga" ? "Mancomunidad de Campoo-Cabuérniga" : nm;
        };
        feats.forEach(f => {
            ctx.beginPath(); path(f);
            ctx.fillStyle = state.visited[nameOf(f)] ? "#24c25c" : "#2c3f54";
            ctx.fill();
            ctx.strokeStyle = "rgba(9,16,26,0.95)"; ctx.lineWidth = 1.6; ctx.stroke();
        });
        feats.filter(f => state.visited[nameOf(f)]).forEach(f => {
            ctx.beginPath(); path(f);
            ctx.fillStyle = "rgba(150,255,190,0.16)"; ctx.fill();
        });

        // Stats
        const total = state.totalMuni || 103,
            nv = Object.keys(state.visited).length,
            pct = Math.round(nv / total * 100);
        ctx.font = "bold 168px -apple-system, Helvetica, Arial, sans-serif";
        const t1 = String(nv), t2 = " / " + total;
        const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
        ctx.textAlign = "left";
        let x0 = (W - w1 - w2) / 2;
        ctx.fillStyle = "#2fdc6f"; ctx.fillText(t1, x0, 1395);
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillText(t2, x0 + w1, 1395);
        ctx.textAlign = "center";
        ctx.font = "42px -apple-system, Helvetica, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText("municipios conquistados", W / 2, 1465);

        // Barra de progreso
        const bw = 720, bx = (W - bw) / 2, by = 1525, bh = 26;
        rr(bx, by, bw, bh, 13); ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fill();
        if (pct > 0) {
            rr(bx, by, Math.max(26, bw * pct / 100), bh, 13);
            const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
            pg.addColorStop(0, "#2fdc6f"); pg.addColorStop(1, "#1a9a48");
            ctx.fillStyle = pg; ctx.fill();
        }
        ctx.font = "bold 58px -apple-system, Helvetica, Arial, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText(pct + "% de Cantabria", W / 2, 1665);

        // Pie
        ctx.font = "34px -apple-system, Helvetica, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillText(new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) + "  ·  " + location.host, W / 2, 1800);

        // Compartir (Instagram Stories sale en el menú) o descargar
        const blob = await new Promise(r => cv.toBlob(r, "image/png"));
        const file = new File([blob], "ya-lo-pise.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "Ya lo pisé" }).catch(() => {});
        } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "ya-lo-pise.png";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
        }
    } catch (err) {
        console.error("exportarMapa:", err);
        toast("No se pudo generar la imagen", "error");
    } finally {
        btn && (btn.textContent = "📸 Exportar mapa", btn.disabled = !1);
    }
}

function clearRecFoto() {
    recFotoBase64 = null; recFotoMime = null;
    document.getElementById("rec-foto-prev").style.display = "none";
    try { document.getElementById("rec-foto-in").value = ""; } catch (e) {}
}
document.getElementById("rec-foto-in")?.addEventListener("change", async function(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const { base64, mime } = await compressImage(f, 1280, 0.8);
    recFotoBase64 = base64; recFotoMime = mime;
    document.getElementById("rec-foto-img").src = base64;
    document.getElementById("rec-foto-prev").style.display = "block";
});
function openRecModal(e) {
    recMuni = e, recTipo = "sitio", document.getElementById("rec-muni-title").textContent = e, document.getElementById("rec-nombre").value = "", document.getElementById("rec-comentario").value = "";
    const lk = document.getElementById("rec-link"); if (lk) lk.value = "";
    clearRecFoto();
    setRecTipo("sitio"), document.getElementById("recomendacion-modal").style.display = "flex"
}

function closeRecModal() {
    document.getElementById("recomendacion-modal").style.display = "none"
}

function setRecTipo(e) {
    recTipo = e;
    const t = document.getElementById("rec-tipo-sitio"),
        i = document.getElementById("rec-tipo-comida");
    "sitio" === e ? (t.style.borderColor = "#2272e8", t.style.background = "rgba(34,114,232,0.15)", t.style.color = "#fff", i.style.borderColor = "rgba(255,255,255,0.1)", i.style.background = "transparent", i.style.color = "rgba(255,255,255,0.5)") : (i.style.borderColor = "#e8288a", i.style.background = "rgba(232,40,138,0.15)", i.style.color = "#fff", t.style.borderColor = "rgba(255,255,255,0.1)", t.style.background = "transparent", t.style.color = "rgba(255,255,255,0.5)")
}
async function guardarRecomendacion() {
    const nombre = document.getElementById("rec-nombre").value.trim();
    const coment = document.getElementById("rec-comentario").value.trim();
    let link = (document.getElementById("rec-link")?.value || "").trim();
    if (!nombre) return void toast("Ponle un nombre al sitio", "info");
    if (!state.user) return;
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    if (link && link.length > 300) return void toast("El enlace es demasiado largo", "info");
    const btn = document.getElementById("rec-save-btn");
    btn.textContent = "Guardando...", btn.disabled = !0;
    try {
        let fotoPath = null;
        if (recFotoBase64 && recFotoMime) {
            const blob = await (await fetch(recFotoBase64)).blob();
            const path = state.user.id + "/rec_" + Date.now() + ".jpg";
            const { error: upErr } = await db.storage.from("evidencias").upload(path, blob, { contentType: recFotoMime });
            if (!upErr) fotoPath = path;
        }
        // Ubicación GPS (si el usuario la tiene activada) para poder pintar
        // este sitio como un pin destacado en el mapa. No bloquea el
        // guardado si falla o no da tiempo: simplemente se queda sin pin.
        let recLat = null, recLng = null;
        if (navigator.geolocation) {
            try {
                const pos = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: !0, timeout: 4000, maximumAge: 120000 })
                );
                recLat = pos.coords.latitude; recLng = pos.coords.longitude;
            } catch (e) { /* sin GPS: la recomendación se guarda igual, solo sin pin */ }
        }
        const { error } = await db.from("recomendaciones").insert({
            user_id: state.user.id,
            municipio: recMuni,
            nombre: nombre,
            tipo: recTipo,
            comentario: coment || null,
            link: link || null,
            foto_path: fotoPath,
            lat: recLat,
            lng: recLng
        });
        if (error) throw error;
        closeRecModal();
        loadRecomendaciones(recMuni);
    } catch (err) {
        toast("Error: " + err.message, "error");
    } finally {
        btn.textContent = "Guardar recomendación", btn.disabled = !1;
    }
}

async function loadRecomendaciones(muni) {
    const cont = document.getElementById("mm-recomendaciones");
    if (!cont || !state.user) return;
    const { data: fs } = await db.from("friendships").select("follower_id, following_id")
        .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado");
    const fids = (fs || []).map(f => f.follower_id === state.user.id ? f.following_id : f.follower_id);
    const ids  = [...new Set([...fids, state.user.id])];

    const { data: recs } = await db.from("recomendaciones")
        .select("*, profiles(username, avatar_url)")
        .eq("municipio", muni).in("user_id", ids)
        .order("created_at", { ascending: !1 });

    if (!recs || !recs.length) {
        cont.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px;padding:4px 0">Nadie ha recomendado nada aquí aún. ¡Sé el primero!</div>';
        return;
    }

    // Respuestas del hilo + URLs firmadas, todo en lote
    const recIds = recs.map(r => r.id);
    const { data: replies } = await db.from("recomendacion_replies")
        .select("*, profiles(username, avatar_url)")
        .in("recomendacion_id", recIds)
        .order("created_at", { ascending: !0 });
    const repliesByRec = {};
    (replies || []).forEach(r => { (repliesByRec[r.recomendacion_id] = repliesByRec[r.recomendacion_id] || []).push(r); });

    const allPaths = [...new Set([
        ...recs.filter(r => r.foto_path).map(r => r.foto_path),
        ...(replies || []).filter(r => r.foto_path).map(r => r.foto_path),
    ])];
    const urls = {};
    if (allPaths.length) {
        const { data: signed } = await db.storage.from("evidencias").createSignedUrls(allPaths, 3600);
        (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
    }

    cont.innerHTML = recs.map(rec => {
        const u    = rec.profiles?.username || "Usuario";
        const mine = rec.user_id === state.user?.id;
        const tipoIco = "comida" === rec.tipo ? "🍽️" : "📍";
        const av = rec.profiles?.avatar_url
            ? '<img src="' + esc(rec.profiles.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(u) + '"/>'
            : getInitials(u);
        const del = mine
            ? '<button data-rid="' + esc(rec.id) + '" data-muni="' + esc(muni) + '" onclick="deleteRecomendacion(this.dataset.rid, this.dataset.muni)" style="background:rgba(232,40,40,0.12);border:1px solid rgba(232,40,40,0.3);color:#ff6b6b;cursor:pointer;font-size:11px;padding:4px 9px;border-radius:8px;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;font-family:Inter,sans-serif"><i class="ti ti-trash" aria-hidden="true"></i> Borrar</button>'
            : "";
        const foto = rec.foto_path && urls[rec.foto_path]
            ? '<img src="' + esc(urls[rec.foto_path]) + '" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px;margin:6px 0;display:block" alt="' + esc(rec.nombre) + '"/>'
            : "";
        const safeLink = rec.link && /^https?:\/\//i.test(rec.link) ? rec.link : null;
        const linkHtml = safeLink
            ? '<a href="' + esc(safeLink) + '" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#7ab3e8;text-decoration:none;margin-top:4px">🔗 Ver enlace</a>'
            : "";

        // Hilo de "yo también he estado"
        const reps = repliesByRec[rec.id] || [];
        const repsHtml = reps.map(rp => {
            const ru = rp.profiles?.username || "Usuario";
            const rav = rp.profiles?.avatar_url
                ? '<img src="' + esc(rp.profiles.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(ru) + '"/>'
                : getInitials(ru);
            const rfoto = rp.foto_path && urls[rp.foto_path]
                ? '<img src="' + esc(urls[rp.foto_path]) + '" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:5px;display:block" alt="foto"/>'
                : "";
            const rdel = rp.user_id === state.user?.id
                ? '<button data-rpid="' + esc(rp.id) + '" data-muni="' + esc(muni) + '" onclick="deleteRecReply(this.dataset.rpid, this.dataset.muni)" style="background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:10px;padding:0;margin-left:auto"><i class="ti ti-trash" aria-hidden="true"></i></button>'
                : "";
            return '<div style="margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.04);border-left:2px solid rgba(34,176,80,0.5);border-radius:0 10px 10px 0">'
                + '<div style="display:flex;align-items:center;gap:7px"><div style="width:18px;height:18px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:7px;color:rgba(255,255,255,0.6);flex-shrink:0;overflow:hidden">' + rav + '</div>'
                + '<span style="font-size:11px;color:#5DCAA5;font-weight:600">🙋 ' + esc(ru) + ' también ha estado</span>' + rdel + '</div>'
                + (rp.comentario ? '<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:4px;line-height:1.4">' + esc(rp.comentario) + '</div>' : "")
                + rfoto + '</div>';
        }).join("");

        const yoTambien = !mine
            ? '<button data-rid="' + esc(rec.id) + '" onclick="toggleRecReplyForm(this.dataset.rid)" style="margin-top:7px;padding:6px 12px;background:rgba(34,176,80,0.12);color:#5DCAA5;border:1px solid rgba(34,176,80,0.3);border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">🙋 Yo también he estado</button>'
            : "";
        const replyForm =
            '<div id="rec-reply-form-' + esc(rec.id) + '" style="display:none;margin-top:8px">'
            + '<textarea id="rec-reply-text-' + esc(rec.id) + '" class="rec-reply-input" placeholder="Cuenta tu experiencia... (opcional)" maxlength="140" rows="2" style="width:100%;padding:9px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;color:#fff;font-family:Inter,sans-serif;outline:none;resize:none;box-sizing:border-box"></textarea>'
            + '<input id="rec-reply-foto-' + esc(rec.id) + '" type="file" accept="image/*" style="display:none" onchange="recReplyFotoSel(this)"/>'
            + '<div style="display:flex;gap:6px;margin-top:6px;align-items:center">'
            + '<button data-rid="' + esc(rec.id) + '" onclick="document.getElementById(\'rec-reply-foto-\' + this.dataset.rid).click()" style="padding:6px 11px;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.6);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif">📷 Foto</button>'
            + '<span id="rec-reply-fname-' + esc(rec.id) + '" style="font-size:10px;color:rgba(255,255,255,0.35);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>'
            + '<button data-rid="' + esc(rec.id) + '" data-muni="' + esc(muni) + '" onclick="enviarRecReply(this.dataset.rid, this.dataset.muni, this)" style="padding:6px 14px;background:#22b050;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Publicar</button>'
            + '</div></div>';

        return '<div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:10px 12px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.07)">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:22px;height:22px;border-radius:50%;background:#1a2535;border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:8px;color:rgba(255,255,255,0.6);flex-shrink:0;overflow:hidden">' + av + '</div>'
            + '<span style="font-size:12px;color:rgba(255,255,255,0.5)">' + esc(u) + '</span>'
            + '<span style="font-size:10px;background:rgba(255,255,255,0.08);padding:2px 7px;border-radius:999px;color:rgba(255,255,255,0.4);margin-left:auto">' + tipoIco + " " + ("comida" === rec.tipo ? "Comida" : "Sitio") + '</span>' + del + '</div>'
            + '<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:' + (rec.comentario ? "4px" : "0") + '">' + esc(rec.nombre) + '</div>'
            + (rec.comentario ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.4">' + esc(rec.comentario) + '</div>' : "")
            + foto + linkHtml + repsHtml + yoTambien + replyForm
            + '</div>';
    }).join("");
}

let recReplyFotos = {}; // base64 por input
function recReplyFotoSel(input) {
    const f = input.files && input.files[0];
    const rid = input.id.replace("rec-reply-foto-", "");
    if (!f) return;
    compressImage(f, 1280, 0.8).then(({ base64, mime }) => {
        recReplyFotos[rid] = { base64, mime };
        const fn = document.getElementById("rec-reply-fname-" + rid);
        if (fn) fn.textContent = "📎 foto lista";
    });
}
function toggleRecReplyForm(rid) {
    const f = document.getElementById("rec-reply-form-" + rid);
    if (f) f.style.display = f.style.display === "none" ? "block" : "none";
}
async function enviarRecReply(rid, muni, btn) {
    if (!state.user) return;
    const texto = (document.getElementById("rec-reply-text-" + rid)?.value || "").trim();
    const foto  = recReplyFotos[rid];
    if (!texto && !foto) return void toast("Añade un comentario o una foto", "info");
    btn.textContent = "..."; btn.disabled = !0;
    try {
        let fotoPath = null;
        if (foto) {
            const blob = await (await fetch(foto.base64)).blob();
            const path = state.user.id + "/recreply_" + Date.now() + ".jpg";
            const { error: upErr } = await db.storage.from("evidencias").upload(path, blob, { contentType: foto.mime });
            if (!upErr) fotoPath = path;
        }
        const { error } = await db.from("recomendacion_replies").insert({
            recomendacion_id: rid,
            user_id: state.user.id,
            comentario: texto || null,
            foto_path: fotoPath
        });
        if (error) throw error;
        delete recReplyFotos[rid];
        loadRecomendaciones(muni);
    } catch (err) {
        toast("Error: " + err.message, "error");
        btn.textContent = "Publicar"; btn.disabled = !1;
    }
}
async function deleteRecReply(rpid, muni) {
    if (!await confirmar("¿Borrar tu respuesta?", { titulo: "Borrar respuesta", ok: "Borrar", peligro: !0 })) return;
    await db.from("recomendacion_replies").delete().eq("id", rpid).eq("user_id", state.user.id);
    loadRecomendaciones(muni);
}

async function deleteRecomendacion(e, t) {
    if (await confirmar("¿Borrar esta recomendación?", { titulo: "Borrar recomendación", ok: "Borrar", peligro: !0 })) { await db.from("recomendaciones").delete().eq("id", e).eq("user_id", state.user.id); loadRecomendaciones(t); }
}

// ═══ AUTOCOMPLETADO DE @MENCIONES ═══════════════════════════
// Al escribir @ en un campo de comentario, sugiere tus amigos.
let _friendsCache = null;
async function getFriendsCache() {
    if (_friendsCache && _friendsCache.length) return _friendsCache;
    if (!state.user) return [];
    const { data } = await db.from("friendships")
        .select("follower_id,following_id,follower:profiles!friendships_follower_id_fkey(id,username,avatar_url),following:profiles!friendships_following_id_fkey(id,username,avatar_url)")
        .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
        .eq("estado", "aceptado");
    const seen = new Set();
    _friendsCache = (data || [])
        .map(f => f.follower_id === state.user.id ? f.following : f.follower)
        .filter(p => p && !seen.has(p.id) && seen.add(p.id));
    return _friendsCache;
}

function getMentionDD() {
    let dd = document.getElementById("mention-dd");
    if (!dd) {
        dd = document.createElement("div");
        dd.id = "mention-dd";
        dd.style.cssText = "position:fixed;display:none;z-index:9999;background:#1a2535;border:1px solid rgba(255,255,255,0.15);border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.5);max-height:180px;overflow-y:auto;min-width:180px";
        document.body.appendChild(dd);
    }
    return dd;
}
function hideMentionDD() { const dd = document.getElementById("mention-dd"); if (dd) dd.style.display = "none"; }

let _mentionTarget = null;
async function handleMentionInput(input) {
    const pos  = input.selectionStart ?? input.value.length;
    const text = input.value.slice(0, pos);
    const m    = text.match(/@([\wáéíóúñÁÉÍÓÚÑ]*)$/);
    if (!m) return hideMentionDD();
    const query   = m[1].toLowerCase();
    const friends = await getFriendsCache();
    const matches = friends.filter(f => (f.username || "").toLowerCase().startsWith(query)).slice(0, 5);
    if (!matches.length) return hideMentionDD();

    _mentionTarget = { input, tokenStart: pos - m[0].length, pos };
    const dd = getMentionDD();
    dd.innerHTML = matches.map(f => {
        const av = f.avatar_url
            ? '<img src="' + esc(f.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt=""/>'
            : getInitials(f.username);
        return '<div class="mention-dd-item" data-uname="' + esc(f.username) + '" style="display:flex;align-items:center;gap:9px;padding:9px 13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05)">'
            + '<div style="width:24px;height:24px;border-radius:50%;background:#0f1923;display:flex;align-items:center;justify-content:center;font-size:9px;color:#7ab3e8;flex-shrink:0;overflow:hidden">' + av + '</div>'
            + '<span style="font-size:13px;color:#fff">@' + esc(f.username) + '</span></div>';
    }).join("");
    const r = input.getBoundingClientRect();
    dd.style.left  = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + "px";
    dd.style.top   = (r.bottom + 4) + "px";
    dd.style.display = "block";
}
function applyMention(uname) {
    if (!_mentionTarget) return;
    const { input, tokenStart, pos } = _mentionTarget;
    input.value = input.value.slice(0, tokenStart) + "@" + uname + " " + input.value.slice(pos);
    input.focus();
    const np = tokenStart + uname.length + 2;
    try { input.setSelectionRange(np, np); } catch (e) {}
    hideMentionDD();
}
document.addEventListener("input", e => {
    const t = e.target;
    if (t && (t.classList?.contains("comment-input") || t.classList?.contains("rec-reply-input") || t.id === "evidencia-desc" || t.id === "rec-comentario")) {
        handleMentionInput(t);
    }
});
// mousedown (no click) para ganar al blur del input
document.addEventListener("mousedown", e => {
    const item = e.target.closest?.(".mention-dd-item");
    if (item) { e.preventDefault(); applyMention(item.dataset.uname); }
    else if (!e.target.closest?.("#mention-dd")) hideMentionDD();
});
// touchstart para móvil (gana al blur del teclado)
document.addEventListener("touchstart", e => {
    const item = e.target.closest?.(".mention-dd-item");
    if (item) { e.preventDefault(); applyMention(item.dataset.uname); }
}, { passive: !1 });
window.addEventListener("scroll", hideMentionDD, true);


// Activar modo offline
registerSW();

// ═══ REPORTAR Y BLOQUEAR ════════════════════════════════════
async function reportarContenido(tipo, contenidoId, usuarioId) {
    if (!state.user) return;
    const motivo = prompt("¿Por qué quieres reportarlo?\n(spam, contenido inapropiado, acoso, suplantación...)");
    if (motivo === null) return;
    try {
        await db.from("reports").insert({
            reporter_id: state.user.id,
            reported_user_id: usuarioId || null,
            content_type: tipo,
            content_id: String(contenidoId || ""),
            motivo: (motivo.trim() || "sin motivo").slice(0, 300)
        });
        toast("Gracias, hemos recibido tu reporte", "success");
    } catch (err) {
        toast("No se pudo enviar el reporte", "error");
    }
}

async function bloquearUsuario(uid, uname) {
    if (!state.user || !uid || uid === state.user.id) return;
    if (!await confirmar("Dejaréis de ser amigos y no verás su contenido ni sus comentarios.", { titulo: "¿Bloquear a " + (uname || "este usuario") + "?", ok: "Bloquear", peligro: !0 })) return;
    try {
        await db.from("blocks").upsert({ blocker_id: state.user.id, blocked_id: uid });
        await db.from("friendships").delete()
            .or(`and(follower_id.eq.${state.user.id},following_id.eq.${uid}),and(follower_id.eq.${uid},following_id.eq.${state.user.id})`);
        (state.blockedIds = state.blockedIds || new Set()).add(uid);
        _friendsCache = null;
        state.feedCache = null;
        if (typeof closeFriendProfile === "function") closeFriendProfile();
        if (typeof loadFriendCount === "function") loadFriendCount();
        toast("Usuario bloqueado", "info");
    } catch (err) {
        toast("Error al bloquear: " + err.message, "error");
    }
}

//nievi
async function verBloqueados() {
    if (!state.user) return;
    let ov = document.getElementById("bloqueados-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "bloqueados-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:360;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:80vh;overflow-y:auto;padding:20px 18px 26px" onclick="event.stopPropagation()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:700;color:#fff">🚫 Usuarios bloqueados</div><button onclick="document.getElementById(\'bloqueados-modal\').style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer">✕</button></div>'
        + '<div id="bloqueados-list"><div style="color:rgba(255,255,255,0.4);font-size:13px">Cargando...</div></div></div>';
    ov.style.display = "flex";
    try {
        const { data: bl } = await db.from("blocks").select("blocked_id").eq("blocker_id", state.user.id);
        const ids = (bl || []).map(b => b.blocked_id);
        const cont = document.getElementById("bloqueados-list");
        if (!ids.length) { cont.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:10px 0">No has bloqueado a nadie.</div>'; return; }
        const { data: profs } = await db.from("profiles").select("id,username,avatar_url").in("id", ids);
        cont.innerHTML = (profs || []).map(p => {
            const av = p.avatar_url
                ? '<img src="' + esc(p.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt=""/>'
                : getInitials(p.username);
            return '<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">'
                + '<div style="width:36px;height:36px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:12px;color:#7ab3e8;flex-shrink:0;overflow:hidden">' + av + '</div>'
                + '<span style="flex:1;font-size:14px;color:#fff">' + esc(p.username) + '</span>'
                + '<button data-uid="' + esc(p.id) + '" onclick="desbloquearUsuario(this.dataset.uid, this)" style="padding:7px 14px;background:rgba(34,176,80,0.15);color:#5DCAA5;border:1px solid rgba(34,176,80,0.35);border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Desbloquear</button>'
                + '</div>';
        }).join("");
    } catch (e) {
        document.getElementById("bloqueados-list").innerHTML = '<div style="color:#ff6b6b;font-size:12px">Error al cargar</div>';
    }
}

async function desbloquearUsuario(uid, btn) {
    if (!state.user || !uid) return;
    if (btn) { btn.disabled = !0; btn.textContent = "..."; }
    try {
        await db.from("blocks").delete().eq("blocker_id", state.user.id).eq("blocked_id", uid);
        state.blockedIds?.delete(uid);
        state.feedCache = null; _friendsCache = null;
        if (btn) { const row = btn.closest("div"); if (row) row.remove(); }
        toast("Usuario desbloqueado. Si quieres volver a ser amigos, tendrás que enviarle la solicitud otra vez.", "success");
    } catch (e) {
        toast("No se pudo desbloquear: " + (e.message || e), "error");
        if (btn) { btn.disabled = !1; btn.textContent = "Desbloquear"; }
    }
}
// ═══ FICHA DE EVENTO ════════════════════════════════════════

// — Programa por horas (ev.programa = [{hora, acto}] o JSON string) —
function _parsePrograma(p) {
  if (!p) return [];
  try { const a = typeof p === "string" ? JSON.parse(p) : p; return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function _evIntKey(eid) { return "ylp_evint_" + eid; }
function _evInterests(eid) { try { return JSON.parse(localStorage.getItem(_evIntKey(eid)) || "[]"); } catch (_) { return []; } }
function toggleEventInterest(eid, idx, el) {
  let arr = _evInterests(eid); idx = +idx;
  if (arr.includes(idx)) arr = arr.filter(x => x !== idx); else arr.push(idx);
  localStorage.setItem(_evIntKey(eid), JSON.stringify(arr));
  if (el) { const on = arr.includes(idx); el.textContent = on ? "★" : "☆"; el.style.background = on ? "rgba(34,176,80,0.2)" : "transparent"; el.style.color = on ? "#5DCAA5" : "rgba(255,255,255,0.4)"; }
}
function renderProgramaHtml(ev) {
  const prog = _parsePrograma(ev.programa);
  if (!prog.length) return "";
  const ints = _evInterests(ev.id);
  return '<div style="margin-top:16px"><div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">🕐 Programa · marca a qué quieres ir</div>'
    + prog.map((p, i) => {
      const on = ints.includes(i);
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">'
        + '<div style="font-size:12px;font-weight:700;color:#e8b820;min-width:48px">' + esc(p.hora || "") + '</div>'
        + '<div style="flex:1;font-size:13px;color:rgba(255,255,255,0.82)">' + esc(p.acto || "") + '</div>'
        + '<button onclick="toggleEventInterest(\'' + esc(ev.id) + '\',' + i + ',this)" title="Me interesa" style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:' + (on ? "rgba(34,176,80,0.2)" : "transparent") + ';color:' + (on ? "#5DCAA5" : "rgba(255,255,255,0.4)") + ';cursor:pointer;font-size:15px;flex-shrink:0">' + (on ? "★" : "☆") + '</button>'
        + '</div>';
    }).join("") + '</div>';
}

// — Quién va (con caras) —
async function loadEventGoing(eid) {
  const cont = document.getElementById("evm-going"); if (!cont) return;
  try {
    const { data } = await db.from("event_signups").select("user_id").eq("event_id", eid);
    const uids = [...new Set((data || []).map(d => d.user_id))].filter(u => !state.blockedIds?.has(u));
    if (!uids.length) { cont.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.35)">Nadie se ha apuntado aún. ¡Sé el primero! 🎉</div>'; return; }
    const { data: profs } = await db.from("profiles").select("id,username,avatar_url").in("id", uids);
    const friends = await getFriendsCache().catch(() => []);
    const friendIds = new Set((friends || []).map(f => f.id));
    const ordered = (profs || []).sort((a, b) => ((friendIds.has(b.id) || b.id === state.user.id) ? 1 : 0) - ((friendIds.has(a.id) || a.id === state.user.id) ? 1 : 0));
    const shown = ordered.slice(0, 12);
    const avatars = shown.map(p => {
      const isF = friendIds.has(p.id) || p.id === state.user.id;
      const ring = "border:2px solid " + (isF ? "#5DCAA5" : "#22324a");
      return p.avatar_url
        ? '<img src="' + esc(p.avatar_url) + '" title="' + esc(p.username || "") + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;' + ring + ';margin-left:-9px"/>'
        : '<div title="' + esc(p.username || "") + '" style="width:34px;height:34px;border-radius:50%;background:#22324a;' + ring + ';margin-left:-9px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#9cc4f0">' + esc(getInitials(p.username || "?")) + '</div>';
    }).join("");
    const friendsGoing = ordered.filter(p => friendIds.has(p.id)).map(p => p.username).filter(Boolean);
    const extra = uids.length > 12 ? '<div style="margin-left:4px;font-size:12px;color:rgba(255,255,255,0.5)">+' + (uids.length - 12) + '</div>' : '';
    cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">👥 Quién va</div>'
      + '<div style="display:flex;align-items:center;padding-left:9px">' + avatars + extra + '</div>'
      + '<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:7px"><strong style="color:#fff">' + uids.length + '</strong> apuntados'
      + (friendsGoing.length ? ' · 👥 van ' + esc(friendsGoing.slice(0, 3).join(", ")) + (friendsGoing.length > 3 ? " y " + (friendsGoing.length - 3) + " más" : "") : "") + '</div>';
  } catch (e) { console.error("loadEventGoing", e); cont.innerHTML = ""; }
}

// — Recordatorio local (sin servidor: avisa al abrir la app cerca de la fecha) —
function _remindList() { try { return JSON.parse(localStorage.getItem("ylp_evremind") || "[]"); } catch (_) { return []; } }
function toggleEventRemind(eid, el) {
  let arr = _remindList(); eid = String(eid);
  const on = arr.includes(eid);
  if (on) arr = arr.filter(x => x !== eid); else arr.push(eid);
  localStorage.setItem("ylp_evremind", JSON.stringify(arr));
  const nowOn = !on;
  if (el) { el.innerHTML = nowOn ? '🔔 Te avisaré' : '🔔 Recuérdame'; el.style.background = nowOn ? "rgba(34,176,80,0.18)" : "rgba(255,255,255,0.06)"; el.style.color = nowOn ? "#5DCAA5" : "rgba(255,255,255,0.75)"; }
  toast(nowOn ? "Te lo recordaré al abrir la app cerca de la fecha" : "Recordatorio quitado", nowOn ? "success" : "info");
}
function checkEventReminders() {
  try {
    const arr = _remindList(); if (!arr.length || !state.eventos) return;
    const now = new Date(), soon = [];
    arr.forEach(eid => {
      const ev = state.eventos.find(x => String(x.id) === String(eid));
      if (!ev || !ev.fecha) return;
      const diff = (new Date(ev.fecha) - now) / 3600e3;
      if (diff > -18 && diff < 40) soon.push(ev);
    });
    if (soon.length) {
      const names = soon.map(e => e.nombre + (e.lugar ? " (" + e.lugar + ")" : "")).slice(0, 3).join(", ");
      setTimeout(() => toast("🔔 Pronto: " + names, "info"), 1600);
    }
  } catch (_) {}
}

// — Compartir la fiesta (imagen) —
function _wrapTextEv(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(" "); let line = "", yy = y;
  for (const w of words) { const t = line + w + " "; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line.trim(), x, yy); line = w + " "; yy += lh; } else line = t; }
  ctx.fillText(line.trim(), x, yy); return yy;
}
async function shareEvento(eid) {
  const ev = (state.eventos || []).find(x => String(x.id) === String(eid)); if (!ev) return;
  try {
    const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    // Fondo degradado festivo
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1b1030"); g.addColorStop(0.55, "#3a1338"); g.addColorStop(1, "#5a1840");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // Confeti
    const cols = ["#e8288a", "#e8c93a", "#5DCAA5", "#7ab3e8", "#f08fc4", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      x.save(); x.translate(Math.random() * W, Math.random() * H); x.rotate(Math.random() * Math.PI);
      x.globalAlpha = 0.5 + Math.random() * 0.4; x.fillStyle = cols[i % cols.length];
      const s = 7 + Math.random() * 14; x.fillRect(-s / 2, -s / 2, s, s * 0.5); x.restore();
    }
    x.globalAlpha = 1;
    // Tarjeta central tipo "entrada"
    const cardX = 90, cardY = 250, cardW = W - 180, cardH = H - 520, r = 36;
    x.fillStyle = "rgba(10,8,20,0.55)"; roundRect(x, cardX, cardY, cardW, cardH, r); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 2; roundRect(x, cardX, cardY, cardW, cardH, r); x.stroke();
    // Contenido tarjeta
    x.textAlign = "center";
    x.fillStyle = "#e8c93a"; x.font = "bold 40px Inter, Arial, sans-serif"; x.fillText("· F I E S T A ·", W / 2, cardY + 90);
    x.fillStyle = "#fff"; x.font = "bold 92px Georgia, serif";
    const yEnd = _wrapTextEv(x, ev.nombre, W / 2, cardY + 220, cardW - 120, 100);
    // Línea separadora punteada
    x.strokeStyle = "rgba(255,255,255,0.2)"; x.setLineDash([10, 12]); x.beginPath(); x.moveTo(cardX + 60, yEnd + 60); x.lineTo(cardX + cardW - 60, yEnd + 60); x.stroke(); x.setLineDash([]);
    x.fillStyle = "rgba(255,255,255,0.92)"; x.font = "46px Inter, Arial, sans-serif";
    const fch = ev.fecha ? new Date(ev.fecha).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "";
    x.fillText("📅  " + fch, W / 2, yEnd + 150);
    if (ev.lugar) { x.font = "44px Inter, Arial, sans-serif"; x.fillStyle = "rgba(255,255,255,0.8)"; x.fillText("📍  " + ev.lugar, W / 2, yEnd + 225); }
    // Otros pueblos del festival
    const sibs = (state.eventos || []).filter(e => (e.festival || e.nombre) === (ev.festival || ev.nombre) && (e.lugar || e.municipio) !== ev.lugar);
    if (sibs.length) {
      x.font = "32px Inter, Arial, sans-serif"; x.fillStyle = "rgba(255,255,255,0.55)";
      _wrapTextEv(x, "También en: " + sibs.map(s => s.lugar || s.municipio).join(", "), W / 2, yEnd + 300, cardW - 140, 42);
    }
    // Pie con marca
    x.fillStyle = "rgba(255,255,255,0.85)"; x.font = "bold 44px Georgia, serif"; x.fillText("Ya lo pisé", W / 2, H - 150);
    x.fillStyle = "rgba(255,255,255,0.45)"; x.font = "30px Inter, Arial, sans-serif"; x.fillText("Conquista Cantabria · app.yalopise.com", W / 2, H - 95);
    const blob = await new Promise(rz => c.toBlob(rz, "image/png"));
    const file = new File([blob], "fiesta.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: ev.nombre, text: "¡Vente a " + ev.nombre + "! 🎉" });
    } else {
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "fiesta.png"; a.click(); URL.revokeObjectURL(url);
      toast("Imagen descargada para compartir 📤", "success");
    }
  } catch (e) { toast("No se pudo compartir", "error"); }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// — Distancia a la fiesta (si hay GPS y conocemos el municipio) —
function _eventDistanceHtml(ev) {
  try {
    if (!state.lastLngLat || !state.muniFeatures) return "";
    const muni = state.muniFeatures[ev.municipio] || state.muniFeatures[ev.lugar];
    if (!muni) return "";
    const c = d3.geoCentroid(muni); if (!c || isNaN(c[0])) return "";
    const km = _haversineKm(state.lastLngLat, c);
    return '<span style="color:#9fe0bf"> · 📍 a ' + km.toFixed(0) + ' km (~' + Math.max(2, Math.round(km * 1.3 / 50 * 60)) + ' min)</span>';
  } catch (_) { return ""; }
}

// Devuelve los datos del municipio de una fiesta (para su foto de cabecera).
function _muniDeEvento(ev) {
    if (!state.municipiosData) return null;
    const cand = [ev.municipio, ev.lugar];
    if (ev.lugar) {
        const m = ev.lugar.match(/\(([^)]+)\)/);      // "Silió (Molledo)" → "Molledo"
        if (m) cand.push(m[1].trim());
        cand.push(ev.lugar.replace(/\s*\(.*\)/, "").trim());
    }
    for (const c of cand) if (c && state.municipiosData[c]) return state.municipiosData[c];
    return null;
}

function openEventModal(eid) {
    const ev = (state.eventos || []).find(x => String(x.id) === String(eid));
    if (!ev) return;
    let ov = document.getElementById("event-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "event-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:300;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) closeEventModal(); });
        document.body.appendChild(ov);
    }
    const coast = !1;
    const isPast = ev.fecha && new Date(ev.fecha) < new Date(new Date().toDateString());
    const recapBanner = isPast
        ? '<div style="margin-top:14px;padding:11px 13px;background:rgba(232,90,160,0.1);border:1px solid rgba(232,90,160,0.3);border-radius:12px;font-size:12px;color:#f0a8cf">📸 <b>Recap del evento</b> — mira las fotos que subió la gente y quién fue.</div>'
        : "";
    const fecha = ev.fecha ? new Date(ev.fecha).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "";
    // Contacto: @usuario de IG, URL o texto plano
    let contactoHtml = "";
    const ct = (ev.contacto || "").trim();
    if (ct) {
        let href = null, label = ct;
        if (ct.startsWith("@")) { href = "https://instagram.com/" + ct.slice(1); label = ct + " (Instagram)"; }
        else if (/^https?:\/\//i.test(ct)) { href = ct; }
        contactoHtml = '<div style="margin-top:12px;padding:11px 13px;background:rgba(34,114,232,0.08);border:1px solid rgba(34,114,232,0.25);border-radius:12px">'
            + '<div style="font-size:10px;font-weight:600;color:#85B7EB;margin-bottom:4px;letter-spacing:.05em;text-transform:uppercase">📞 Organización</div>'
            + (href
                ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" style="font-size:13px;color:#7ab3e8;text-decoration:none">' + esc(label) + ' ↗</a>'
                : '<span style="font-size:13px;color:rgba(255,255,255,0.7)">' + esc(label) + '</span>')
            + '</div>';
    }
    const recoHtml = ev.recomendacion
        ? '<div style="margin-top:10px;padding:11px 13px;background:rgba(232,201,58,0.08);border:1px solid rgba(232,201,58,0.25);border-radius:12px">'
          + '<div style="font-size:10px;font-weight:600;color:#e8c93a;margin-bottom:4px;letter-spacing:.05em;text-transform:uppercase">💡 Recomendación</div>'
          + '<div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.5">' + esc(ev.recomendacion) + '</div></div>'
        : "";

    // Cabecera: foto del MUNICIPIO al que pertenece la fiesta
    const _muniData = _muniDeEvento(ev);
    const cartel = _muniData?.imagen_url
        ? '<div style="width:100%;height:210px;overflow:hidden;position:relative"><img src="' + esc(_muniData.imagen_url) + '" style="width:100%;height:100%;object-fit:cover;display:block" alt="' + esc(ev.lugar || ev.nombre) + '"/><div style="position:absolute;inset:0;background:linear-gradient(to top,#141e2c 5%,transparent 60%)"></div></div>'
        : '<div style="width:100%;height:110px;background:linear-gradient(135deg,#2a1f3d,#3d1f33);display:flex;align-items:center;justify-content:center;font-size:42px">🎉</div>';
    // Programación: la foto (ev.imagen_url) si la hay; si no, mensaje de espera
    const programaFoto = ev.imagen_url
        ? '<div style="margin-top:16px"><div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase">📋 Programación</div><img src="' + esc(ev.imagen_url) + '" style="width:100%;border-radius:12px;display:block;border:1px solid rgba(255,255,255,0.08)" alt="Programación de ' + esc(ev.nombre) + '"/></div>'
        : '<div style="margin-top:16px;padding:15px 14px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.16);border-radius:12px;text-align:center;font-size:12px;color:rgba(255,255,255,0.5);line-height:1.5">⏳ Esperando a que nos envíen la programación de las fiestas.</div>';
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;position:relative" onclick="event.stopPropagation()">'
        + '<button onclick="closeEventModal()" style="position:absolute;top:12px;right:12px;z-index:2;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:none;font-size:15px;cursor:pointer">✕</button>'
        + cartel
        + '<div style="padding:16px 18px 26px">'
        + '<div style="font-family:\'Playfair Display\',Georgia,serif;font-size:22px;font-weight:700;color:#fff;line-height:1.25">' + esc(ev.nombre) + '</div>'
        + '<div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.55)">📅 ' + esc(fecha) + (ev.lugar ? ' · 📍 ' + esc(ev.lugar) : '') + _eventDistanceHtml(ev) + '</div>'
        + (ev.descripcion ? '<div style="margin-top:10px;font-size:13px;color:rgba(255,255,255,0.65);line-height:1.55">' + esc(ev.descripcion) + '</div>' : '')
        + contactoHtml + recoHtml
        + recapBanner
        + '<div id="evm-map"></div>'
        + programaFoto
        + renderProgramaHtml(ev)
        + '<div id="evm-going" style="margin-top:16px"></div>'
        + '<div id="evm-fotos" style="margin-top:14px"></div>'
        + '<div style="display:flex;gap:8px;margin-top:10px">'
        + '<button data-eid="' + esc(ev.id) + '" onclick="toggleEventRemind(this.dataset.eid,this)" style="flex:1;padding:11px;background:' + (_remindList().includes(String(ev.id)) ? 'rgba(34,176,80,0.18);color:#5DCAA5' : 'rgba(255,255,255,0.06);color:rgba(255,255,255,0.75)') + ';border:1px solid rgba(255,255,255,0.12);border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">' + (_remindList().includes(String(ev.id)) ? '🔔 Te avisaré' : '🔔 Recuérdame') + '</button>'
        + '<button data-eid="' + esc(ev.id) + '" onclick="shareEvento(this.dataset.eid)" style="flex:1;padding:11px;background:rgba(232,90,160,0.14);color:#f08fc4;border:1px solid rgba(232,90,160,0.35);border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📤 Compartir</button>'
        + '</div>'
        + '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<button data-eid="' + esc(ev.id) + '" data-ename="' + esc(ev.nombre) + '" onclick="closeEventModal();setTimeout(()=>openEventFotoSheet(this.dataset.eid, this.dataset.ename),60)" style="flex:1;padding:13px;background:rgba(232,184,32,0.18);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📸 Subir foto del evento</button>'
        + '<button data-eid="' + esc(ev.id) + '" onclick="toggleInscripcion(this.dataset.eid);closeEventModal()" style="flex:1;padding:13px;background:' + (state.inscripciones[ev.id] ? 'rgba(34,176,80,0.18);color:#5DCAA5;border:1px solid rgba(34,176,80,0.4)' : '#22b050;color:#fff;border:none') + ';border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">' + (state.inscripciones[ev.id] ? '✓ Apuntado' : 'Apuntarme') + '</button>'
        + '</div></div>';
    ov.style.display = "flex";
    loadEventPhotos(ev.id, "evm-fotos");
    loadEventGoing(ev.id);
    renderFestMiniMap(ev);
}
async function loadPendingSuggestionsBadge() {
    try {
        const { count } = await db.from("event_suggestions").select("id", { count: "exact", head: !0 }).eq("estado", "pendiente");
        const b = document.getElementById("sug-pend-badge");
        if (b && count) { b.textContent = count; b.style.display = "inline-block"; }
    } catch (_) {}
}

// — Mini-mapa con los pueblos donde se celebra el festival —
function renderFestMiniMap(ev) {
    const cont = document.getElementById("evm-map");
    if (!cont || !state.muniFeatures || typeof d3 === "undefined") { if (cont) cont.innerHTML = ""; return; }
    const entries = Object.entries(state.muniFeatures).filter(([n, f]) => f);
    if (!entries.length) { cont.innerHTML = ""; return; }
    const sibs = (state.eventos || []).filter(e => (e.festival || e.nombre) === (ev.festival || ev.nombre));
    const targets = new Set();
    sibs.forEach(s => [s.municipio, s.lugar].forEach(n => { if (n && state.muniFeatures[n]) targets.add(n); }));
    if (!targets.size && ev.lugar && state.muniFeatures[ev.lugar]) targets.add(ev.lugar);
    if (!targets.size && ev.municipio && state.muniFeatures[ev.municipio]) targets.add(ev.municipio);
    if (!targets.size) { cont.innerHTML = ""; return; }
    const W = 460, H = 230;
    try {
        const fc = { type: "FeatureCollection", features: entries.map(([n, f]) => f) };
        const proj = d3.geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], fc);
        const path = d3.geoPath(proj);
        let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">';
        entries.forEach(([name, f]) => {
            const hit = targets.has(name);
            svg += '<path d="' + path(f) + '" fill="' + (hit ? "#e8288a" : "rgba(255,255,255,0.06)") + '" stroke="' + (hit ? "#fff" : "rgba(255,255,255,0.1)") + '" stroke-width="' + (hit ? 1.1 : 0.4) + '"/>';
        });
        const labels = [...targets].map(n => { const c = path.centroid(state.muniFeatures[n]); return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3.2" fill="#fff" stroke="#e8288a" stroke-width="1"/>'; }).join("");
        svg += labels + '</svg>';
        cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin:16px 0 6px;letter-spacing:.05em;text-transform:uppercase">🗺️ Dónde se celebra</div>'
            + '<div style="background:#0d1622;border-radius:12px;padding:8px;border:1px solid rgba(255,255,255,0.08)">' + svg + '</div>'
            + '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:5px">' + [...targets].map(esc).join(" · ") + '</div>';
    } catch (e) { cont.innerHTML = ""; }
}

function isAdmin() { return state.profile?.rol === "admin" || (state.profile?.username || "").toLowerCase() === "itsvalvs"; }

// — Panel de reportes recibidos (solo admin) —
async function openReportsReview() {
    if (!isAdmin()) return;
    let ov = document.getElementById("reprev-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "reprev-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:345;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:20px 18px 26px" onclick="event.stopPropagation()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:700;color:#fff">🚩 Reportes recibidos</div><button onclick="document.getElementById(\'reprev-modal\').style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer">✕</button></div>'
        + '<div id="reprev-list"><div style="color:rgba(255,255,255,0.4);font-size:13px">Cargando...</div></div></div>';
    ov.style.display = "flex";
    try {
        const { data, error } = await db.from("reports").select("*").eq("estado", "pendiente").order("created_at", { ascending: !1 });
        if (error) throw error;
        const uids = [...new Set([].concat(...(data || []).map(r => [r.reporter_id, r.reported_user_id])).filter(Boolean))];
        let nameById = {};
        if (uids.length) {
            const { data: profs } = await db.from("profiles").select("id,username").in("id", uids);
            (profs || []).forEach(p => { nameById[p.id] = p.username; });
        }
        document.getElementById("reprev-list").innerHTML = (!data || !data.length)
            ? '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:6px 0">Sin reportes pendientes 🎉</div>'
            : data.map(r => {
                const quien = nameById[r.reporter_id] ? "@" + esc(nameById[r.reporter_id]) : "alguien";
                const contra = nameById[r.reported_user_id] ? "@" + esc(nameById[r.reported_user_id]) : "—";
                const f = r.created_at ? new Date(r.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                return '<div style="padding:13px;border:1px solid rgba(255,255,255,0.1);border-radius:14px;margin-bottom:10px">'
                    + '<div style="font-size:13px;color:#ff9b9b;font-weight:700">🚩 ' + esc(r.content_type || "contenido") + ' · contra ' + contra + '</div>'
                    + '<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:3px">Reportado por ' + quien + ' · ' + f + '</div>'
                    + '<div style="font-size:12.5px;color:rgba(255,255,255,0.75);margin-top:7px;line-height:1.45">' + esc(r.motivo || "") + '</div>'
                    + (r.content_id ? '<div style="font-size:10.5px;color:rgba(255,255,255,0.3);margin-top:5px;word-break:break-all">id: ' + esc(r.content_id) + '</div>' : '')
                    + '<div style="display:flex;gap:7px;margin-top:10px">'
                    + '<button data-rid="' + esc(r.id) + '" onclick="resolverReporte(this.dataset.rid,\'revisado\')" style="flex:1;padding:8px;background:rgba(34,176,80,0.15);color:#5DCAA5;border:1px solid rgba(34,176,80,0.35);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">✓ Revisado</button>'
                    + '<button data-rid="' + esc(r.id) + '" onclick="resolverReporte(this.dataset.rid,\'descartado\')" style="flex:1;padding:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Descartar</button>'
                    + '</div></div>';
            }).join("");
    } catch (e) {
        const l = document.getElementById("reprev-list");
        if (l) l.innerHTML = '<div style="color:#ff6b6b;font-size:13px">Error: ' + esc(e.message || e) + '</div>';
    }
}

async function resolverReporte(id, estado) {
    if (!isAdmin()) return;
    try {
        await db.from("reports").update({ estado }).eq("id", id);
        openReportsReview(); loadPendingReportsBadge();
    } catch (e) { toast("No se pudo actualizar", "error"); }
}

async function loadPendingReportsBadge() {
    if (!isAdmin()) return;
    try {
        const { count } = await db.from("reports").select("id", { count: "exact", head: !0 }).eq("estado", "pendiente");
        const b = document.getElementById("rep-pend-badge");
        if (b) { b.textContent = count || 0; b.style.display = count ? "inline-block" : "none"; }
    } catch (_) {}
}

async function openSuggestionsReview() {
    if (!isAdmin()) return;
    let ov = document.getElementById("sugrev-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "sugrev-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:345;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:20px 18px 26px" onclick="event.stopPropagation()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:700;color:#fff">🛡️ Sugerencias pendientes</div><button onclick="document.getElementById(\'sugrev-modal\').style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer">✕</button></div>'
        + '<div id="sugrev-list"><div style="color:rgba(255,255,255,0.4);font-size:13px">Cargando...</div></div></div>';
    ov.style.display = "flex";
    try {
        const { data, error } = await db.from("event_suggestions").select("*").eq("estado", "pendiente").order("created_at", { ascending: !1 });
        if (error) throw error;
        const uids = [...new Set(data.map(s => s.user_id).filter(Boolean))];
        let nameById = {};
        if (uids.length) {
            const { data: profs } = await db.from("profiles").select("id,username").in("id", uids);
            (profs || []).forEach(p => { nameById[p.id] = p.username; });
        }
        const evHtml = (!data || !data.length)
            ? '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:6px 0 14px">Sin fiestas pendientes</div>'
            : data.map(s => {
            const who = nameById[s.user_id] ? "@" + esc(nameById[s.user_id]) : "";
            const f = s.fecha ? new Date(s.fecha).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "sin fecha";
            return '<div style="padding:13px;border:1px solid rgba(255,255,255,0.1);border-radius:14px;margin-bottom:10px">'
                + '<div style="font-size:14px;font-weight:700;color:#fff">' + esc(s.nombre) + '</div>'
                + '<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px">📍 ' + esc(s.lugar) + ' · 📅 ' + f + ' · ' + esc(s.tipo || "fiesta") + (who ? ' · ' + who : '') + '</div>'
                + (s.descripcion ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:5px;line-height:1.4">' + esc(s.descripcion) + '</div>' : '')
                + '<div style="display:flex;gap:8px;margin-top:10px">'
                + '<button data-sid="' + s.id + '" onclick="approveSuggestion(this.dataset.sid,this)" style="flex:1;padding:9px;background:#22b050;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">✓ Aprobar y publicar</button>'
                + '<button data-sid="' + s.id + '" onclick="rejectSuggestion(this.dataset.sid,this)" style="padding:9px 14px;background:rgba(232,40,40,0.15);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Rechazar</button>'
                + '</div></div>';
        }).join("");
        document.getElementById("sugrev-list").innerHTML = '<div style="font-size:11px;font-weight:700;color:#f08fc4;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">🎉 Fiestas</div>' + evHtml
            + '<div style="font-size:11px;font-weight:700;color:#5DCAA5;margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em">🥾 Rutas</div><div id="sugrev-rutas"><div style="color:rgba(255,255,255,0.3);font-size:12px">Cargando...</div></div>';
        loadRutaSuggestionsReview();
    } catch (e) {
        document.getElementById("sugrev-list").innerHTML = '<div style="color:#ff6b6b;font-size:12px">Error: ' + esc(e.message || "") + '. ¿Ejecutaste el SQL de admin (migración 9)?</div>';
    }
}

async function approveSuggestion(sid, btn) {
    if (!isAdmin()) return;
    btn.disabled = !0; btn.textContent = "Publicando...";
    try {
        const { data: s, error: e1 } = await db.from("event_suggestions").select("*").eq("id", sid).single();
        if (e1) throw e1;
        const { error: e2 } = await db.from("eventos").insert({
            nombre: s.nombre, lugar: s.lugar, municipio: s.lugar, fecha: s.fecha,
            tipo: s.tipo || "fiesta", tipo_badge: "Fiesta", descripcion: s.descripcion || null,
            activo: !0, color_bg: "#3a1a3a", icon: "ti-confetti"
        });
        if (e2) throw e2;
        await db.from("event_suggestions").update({ estado: "aprobada" }).eq("id", sid);
        toast("Fiesta publicada 🎉", "success");
        btn.closest("div[style*='border-radius:14px']")?.remove();
        loadEventos();
    } catch (e) {
        toast("No se pudo: " + (e.message || e), "error");
        btn.disabled = !1; btn.textContent = "✓ Aprobar y publicar";
    }
}
async function rejectSuggestion(sid, btn) {
    if (!isAdmin()) return;
    try {
        await db.from("event_suggestions").update({ estado: "rechazada" }).eq("id", sid);
        btn.closest("div[style*='border-radius:14px']")?.remove();
        toast("Sugerencia rechazada", "info");
    } catch (e) { toast("Error: " + (e.message || e), "error"); }
}

function closeEventModal() {
    const ov = document.getElementById("event-modal");
    if (ov) ov.style.display = "none";
}

// — Sugerir una fiesta (la revisa el equipo antes de publicarla) —
function openSugerirEvento() {
    if (!state.user) { toast("Inicia sesión para sugerir una fiesta", "info"); return; }
    let ov = document.getElementById("sug-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "sug-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:340;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
        document.body.appendChild(ov);
    }
    const inp = "width:100%;margin-top:8px;padding:11px 12px;background:#1a2535;border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:13px;color:#fff;font-family:Inter,sans-serif;outline:none;box-sizing:border-box";
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:20px 18px 26px" onclick="event.stopPropagation()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:700;color:#fff">➕ Sugerir una fiesta</div><button onclick="document.getElementById(\'sug-modal\').style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer">✕</button></div>'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:6px">La revisaremos antes de publicarla. ¡Gracias por ayudar a completar la agenda!</div>'
        + '<input id="sug-nombre" placeholder="Nombre de la fiesta (ej. San Pelayo)" style="' + inp + '"/>'
        + '<input id="sug-lugar" placeholder="Pueblo / municipio" style="' + inp + '"/>'
        + '<input id="sug-fecha" type="date" style="' + inp + '"/>'
        + '<select id="sug-tipo" style="' + inp + '"><option value="fiesta">Fiesta</option><option value="romeria">Romería</option><option value="gastronomica">Gastronómica</option><option value="concierto">Concierto</option><option value="mercado">Mercado</option><option value="deporte">Deporte</option><option value="infantil">Infantil</option><option value="cultura">Cultura</option></select>'
        + '<textarea id="sug-desc" placeholder="Programa / detalles (opcional)" style="' + inp + ';min-height:70px;resize:none"></textarea>'
        + '<button onclick="enviarSugerencia(this)" style="width:100%;margin-top:12px;padding:13px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">Enviar sugerencia</button>'
        + '</div>';
    ov.style.display = "flex";
}
async function enviarSugerencia(btn) {
    const nombre = document.getElementById("sug-nombre")?.value.trim();
    const lugar = document.getElementById("sug-lugar")?.value.trim();
    const fecha = document.getElementById("sug-fecha")?.value || null;
    const tipo = document.getElementById("sug-tipo")?.value || "fiesta";
    const desc = document.getElementById("sug-desc")?.value.trim() || null;
    if (!nombre || !lugar) { toast("Pon al menos el nombre y el pueblo", "info"); return; }
    btn.disabled = !0; btn.textContent = "Enviando...";
    try {
        const { error } = await db.from("event_suggestions").insert({
            user_id: state.user.id, nombre, lugar, fecha, tipo, descripcion: desc, estado: "pendiente"
        });
        if (error) throw error;
        document.getElementById("sug-modal").style.display = "none";
        toast("¡Sugerencia enviada! La revisaremos pronto 🙌", "success");
    } catch (e) {
        toast("No se pudo enviar: " + (e.message || e), "error");
    } finally { btn.disabled = !1; btn.textContent = "Enviar sugerencia"; }
}


// Desde un post de evento del feed → pantalla Eventos + su ficha
function goToEvento(label) {
    const nombre = String(label || "").replace(/^🎉\s*/, "").trim();
    switchScreen("eventos");
    setTimeout(() => {
        const ev = (state.eventos || []).find(x => (x.nombre || "").trim() === nombre);
        if (ev) openEventModal(ev.id);
    }, 350);
}


// ═══ AMIGOS DE MIS AMIGOS ═══════════════════════════════════
// Usa la función SQL friends_of() (SECURITY DEFINER): solo
// puedes ver los amigos de alguien si tú eres su amigo.
async function renderFriendsOfFriend(uid, antesDe) {
    let cont = document.getElementById("fp-friends-of");
    if (!cont) {
        cont = document.createElement("div");
        cont.id = "fp-friends-of";
        antesDe.parentNode.insertBefore(cont, antesDe);
    }
    cont.innerHTML = "";
    try {
        let amigos = null;
        const rpc = await db.rpc("friends_of", { target: uid });
        if (!rpc.error && Array.isArray(rpc.data)) amigos = rpc.data;
        if (!amigos) {
            const { data: fs } = await db.from("friendships")
                .select("follower_id,following_id")
                .eq("estado", "aceptado")
                .or(`follower_id.eq.${uid},following_id.eq.${uid}`);
            const ids = [...new Set((fs || [])
                .map(f => f.follower_id === uid ? f.following_id : f.follower_id)
                .filter(id => id && id !== uid))];
            if (ids.length) {
                const { data: profs } = await db.from("profiles").select("id,username,avatar_url").in("id", ids);
                amigos = profs || [];
            } else amigos = [];
        }
        if (!amigos.length) {
            const _fc0 = document.getElementById("fp-friends-count"); if (_fc0) _fc0.textContent = "0";
            cont.style.display = "none"; return;
        }

        // Mi relación con cada uno: amigos / pendiente / nada
        const mios = new Set((await getFriendsCache()).map(p => p.id));
        const { data: pend } = await db.from("friendships").select("follower_id,following_id")
            .eq("estado", "pendiente")
            .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`);
        const pendientes = new Set((pend || []).flatMap(f => [f.follower_id, f.following_id]));

        const _vistos = new Set();
        const amigosUnicos = amigos.filter(x => x && x.id && !_vistos.has(x.id) && _vistos.add(x.id));
        const _fc = document.getElementById("fp-friends-count");
        if (_fc) _fc.textContent = amigosUnicos.length;
        const items = amigosUnicos
            .filter(a => a.id !== state.user.id && !state.blockedIds?.has(a.id))
            .map(a => {
                const av = a.avatar_url
                    ? '<img src="' + esc(a.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(a.username) + '"/>'
                    : getInitials(a.username);
                let accion;
                if (mios.has(a.id)) accion = '<span style="font-size:10px;color:#5DCAA5">✓ Amigos</span>';
                else if (pendientes.has(a.id)) accion = '<span style="font-size:10px;color:rgba(255,255,255,0.35)">Pendiente</span>';
                else accion = '<button data-uid="' + esc(a.id) + '" data-uname="' + esc(a.username) + '" onclick="sendFriendRequest(this.dataset.uid, this.dataset.uname, this)" style="padding:5px 11px;background:#2272e8;color:#fff;border:none;border-radius:999px;font-size:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">+ Añadir</button>';
                return '<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">'
                    + '<div style="width:30px;height:30px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:10px;color:#7ab3e8;flex-shrink:0;overflow:hidden">' + av + '</div>'
                    + '<span style="flex:1;font-size:13px;color:#fff">' + esc(a.username) + '</span>'
                    + accion + '</div>';
            }).join("");
        if (!items) { cont.style.display = "none"; return; }
        cont.style.cssText = "margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);display:block";
        cont.innerHTML = '<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase">👥 Sus amigos</div>' + items;
    } catch (err) {
        cont.style.display = "none";
    }
}


// ═══ WISHLIST DE SITIOS A VISITAR ═══════════════════════════
// state.wishlist es un Set de nombres de municipio
async function loadWishlist() {
    if (!state.user) { state.wishlist = new Set(); return; }
    try {
        const { data } = await db.from("wishlist").select("municipio").eq("user_id", state.user.id);
        state.wishlist = new Set((data || []).map(w => w.municipio));
    } catch (e) { state.wishlist = new Set(); }
}

function updateWishBtn(muni) {
    const lbl = document.getElementById("mm-wish-label");
    const btn = document.getElementById("mm-btn-wish");
    if (!lbl || !btn) return;
    const on = state.wishlist?.has(muni);
    lbl.textContent = on ? "En tu wishlist ✓" : "Añadir a mi wishlist";
    btn.style.background = on ? "rgba(232,90,160,0.28)" : "rgba(232,90,160,0.15)";
    btn.style.color = on ? "#ffa8d4" : "#f08fc4";
}

async function toggleWishlist(muni) {
    if (!state.user || !muni) return;
    state.wishlist = state.wishlist || new Set();
    const estaba = state.wishlist.has(muni);
    try {
        if (estaba) {
            await db.from("wishlist").delete().eq("user_id", state.user.id).eq("municipio", muni);
            state.wishlist.delete(muni);
        } else {
            await db.from("wishlist").upsert(
                { user_id: state.user.id, municipio: muni },
                { onConflict: "user_id,municipio" }
            );
            state.wishlist.add(muni);
        }
        updateWishBtn(muni);
        // Si el filtro wishlist está activo en el mapa, refrescar
        if (mapFilter === "wishlist") applyMapFilter();
    } catch (e) {
        toast("No se pudo actualizar tu wishlist. Inténtalo de nuevo.", "error");
    }
}


// ═══ RANKING GLOBAL: top 10 por municipios verificados ══════
async function renderRankingGlobal() {
    let cont = document.getElementById("ranking-global");
    if (!cont) {
        cont = document.createElement("div");
        cont.id = "ranking-global";
        const fp = document.getElementById("feed-posts");
        fp.parentNode.insertBefore(cont, fp);
    }
    cont.innerHTML = '<div style="text-align:center;padding:14px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 8px"></div>Cargando ranking...</div>';
    try {
        // Traer visitas verificadas por GPS (paginado por si hay muchas)
        let all = [], from = 0;
        for (let p = 0; p < 20; p++) {
            const { data, error } = await db.from("visits")
                .select("user_id, municipio")
                .eq("gps_verificada", !0)
                .range(from, from + 999);
            if (error) {
                // Si la columna no existe aún, ocultar el ranking
                cont.style.display = "none"; return;
            }
            if (!data || !data.length) break;
            all = all.concat(data);
            if (data.length < 1000) break;
            from += 1000;
        }
        // Contar municipios DISTINTOS verificados por usuario
        const porUser = {};
        all.forEach(v => {
            (porUser[v.user_id] = porUser[v.user_id] || new Set()).add(v.municipio);
        });
        const ids = Object.keys(porUser);
        if (!ids.length) {
            cont.innerHTML = '<div style="background:var(--bg2,#141e2c);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;margin-bottom:14px;text-align:center;color:rgba(255,255,255,0.4);font-size:13px">🏆 Aún no hay visitas verificadas por GPS. ¡Sé el primero en aparecer en el ranking!</div>';
            return;
        }
        // Top 10
        const ranking = ids.map(id => ({ id, n: porUser[id].size }))
            .sort((a, b) => b.n - a.n).slice(0, 10);
        // Nombres y avatares
        const { data: profs } = await db.from("profiles")
            .select("id, username, avatar_url").in("id", ranking.map(r => r.id));
        const pById = {};
        (profs || []).forEach(p => { pById[p.id] = p; });

        const medalla = i => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + "º";
        const filas = ranking.map((r, i) => {
            const p = pById[r.id] || {};
            const u = p.username || "Usuario";
            const mine = r.id === state.user?.id;
            const av = p.avatar_url
                ? '<img src="' + esc(p.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(u) + '"/>'
                : getInitials(u);
            return '<div style="display:flex;align-items:center;gap:11px;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,0.05)' + (mine ? ';background:rgba(34,176,80,0.08);border-radius:10px' : '') + '">'
                + '<span style="font-size:15px;width:30px;text-align:center;flex-shrink:0">' + medalla(i) + '</span>'
                + '<div style="width:34px;height:34px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:11px;color:#7ab3e8;flex-shrink:0;overflow:hidden">' + av + '</div>'
                + '<span style="flex:1;font-size:14px;color:#fff;font-weight:' + (mine ? "700" : "500") + '">' + esc(u) + (mine ? ' <span style="font-size:10px;color:#5DCAA5">(tú)</span>' : '') + '</span>'
                + '<span style="font-size:15px;font-weight:700;color:#5DCAA5">' + r.n + '</span>'
                + '<span style="font-size:10px;color:rgba(255,255,255,0.35)">📍</span>'
                + '</div>';
        }).join("");

        cont.innerHTML = '<div style="background:var(--bg2,#141e2c);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;margin-bottom:16px">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font-size:18px">🏆</span><span style="font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:17px;color:#fff">Top exploradores</span></div>'
            + '<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:10px">Municipios conquistados con ubicación verificada</div>'
            + filas + '</div>';
    } catch (err) {
        cont.style.display = "none";
    }
}


// ═══ RESTABLECER CONTRASEÑA (tras pulsar el enlace del email) ═══
async function promptNuevaPassword() {
    document.getElementById("splash")?.remove();
    document.getElementById("app").style.display = "none";
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("auth-choice").style.display = "none";
    const form = document.getElementById("auth-form");
    form.style.display = "block";
    form.innerHTML = '<div style="font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:12px;text-align:center">Elige tu nueva contraseña</div>'
        + '<input class="auth-input" id="new-pass" type="password" placeholder="Nueva contraseña (mín. 6)" autocomplete="new-password"/>'
        + '<input class="auth-input" id="new-pass2" type="password" placeholder="Repite la contraseña" autocomplete="new-password"/>'
        + '<button class="btn-login-main" onclick="guardarNuevaPassword()">Guardar contraseña</button>';
}
async function guardarNuevaPassword() {
    const p1 = document.getElementById("new-pass").value;
    const p2 = document.getElementById("new-pass2").value;
    const msg = document.getElementById("auth-msg");
    msg.style.color = "#e8288a";
    if (p1.length < 6) { msg.textContent = "Mínimo 6 caracteres"; msg.style.display = "block"; return; }
    if (p1 !== p2) { msg.textContent = "Las contraseñas no coinciden"; msg.style.display = "block"; return; }
    setAuthLoading(!0);
    const { error } = await db.auth.updateUser({ password: p1 });
    setAuthLoading(!1);
    if (error) {
        msg.textContent = "Error: " + error.message; msg.style.display = "block";
    } else {
        msg.style.color = "#5DCAA5";
        msg.textContent = "✅ Contraseña cambiada. Entrando...";
        msg.style.display = "block";
    }
}


// Enter en los campos de login/registro = enviar
["auth-email", "auth-pass", "auth-username"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", e => { if (e.key === "Enter") submitAuth(); });
});


// ═══ SELECCIÓN DE UNA RUTA CONCRETA ═════════════════════════
// ═══ FICHA DE RUTA COMPLETA ═════════════════════════════════
function _rutaChips(r) {
  const chips = [];
  const dif = (r.dificultad || "").toLowerCase();
  if (dif) { const cdif = dif.includes("fác") || dif.includes("fac") ? "#5DCAA5" : dif.includes("dif") ? "#ff6b6b" : "#e8c93a"; chips.push('<span style="background:rgba(255,255,255,0.06);border:1px solid ' + cdif + '55;color:' + cdif + ';padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600">⛰️ ' + esc(r.dificultad) + '</span>'); }
  if (r.desnivel) chips.push('<span style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:999px;font-size:11px">📈 ' + esc(String(r.desnivel)) + ' m</span>');
  if (r.duracion) chips.push('<span style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:999px;font-size:11px">⏱️ ' + esc(r.duracion) + '</span>');
  if (r.tipo) chips.push('<span style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:999px;font-size:11px">🔄 ' + esc(r.tipo) + '</span>');
  if (r.comarca) chips.push('<span style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);padding:4px 10px;border-radius:999px;font-size:11px">🗺️ ' + esc(r.comarca) + '</span>');
  if (r.apta_ninos) chips.push('<span style="background:rgba(34,176,80,0.12);color:#5DCAA5;padding:4px 10px;border-radius:999px;font-size:11px">👶 Apta niños</span>');
  if (r.apta_perros) chips.push('<span style="background:rgba(34,114,232,0.12);color:#9cc4f0;padding:4px 10px;border-radius:999px;font-size:11px">🐕 Apta perros</span>');
  return chips.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + chips.join("") + '</div>' : "";
}

function openRutaModal(idx) {
  const r = getRutas()[+idx]; if (!r) return;
  let ov = document.getElementById("ruta-modal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "ruta-modal";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:320;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
    ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
    document.body.appendChild(ov);
  }
  const rt = state.rutaRatings?.[r.nombre];
  const stars = rt
    ? '<div style="font-size:13px;color:#e8c93a;margin-top:6px">' + "★".repeat(Math.round(rt.media)) + '<span style="color:rgba(255,255,255,0.18)">' + "★".repeat(Math.max(0, 5 - Math.round(rt.media))) + '</span> <span style="color:rgba(255,255,255,0.6)">' + rt.media.toFixed(1) + ' · ' + rt.n + ' valoración' + (rt.n === 1 ? "" : "es") + '</span></div>'
    : '<div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:6px">Aún sin valoraciones · ¡sé el primero!</div>';
  const inWish = state.rutaWishlist?.has(r.nombre);
  ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;position:relative" onclick="event.stopPropagation()">'
    + '<button onclick="document.getElementById(\'ruta-modal\').style.display=\'none\'" style="position:absolute;top:12px;right:12px;z-index:2;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:none;font-size:15px;cursor:pointer">✕</button>'
    + (state.municipiosData?.[r.muni]?.imagen_url
        ? '<div style="width:100%;height:150px;background-image:linear-gradient(to top,rgba(20,30,44,0.92),rgba(20,30,44,0.05)),url(' + esc(state.municipiosData[r.muni].imagen_url) + ');background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:12px 16px">'
            + '<span style="font-size:11.5px;font-weight:600;color:#fff;background:rgba(0,0,0,0.5);padding:4px 11px;border-radius:999px;backdrop-filter:blur(4px)">📍 ' + esc(r.muni) + '</span>'
          + '</div>'
        : '<div style="width:100%;height:96px;background:linear-gradient(135deg,#13361f,#1f4d34);display:flex;align-items:center;justify-content:center;font-size:40px">🥾</div>')
    + '<div style="padding:16px 18px 26px">'
    + '<div style="font-family:\'Playfair Display\',serif;font-size:22px;font-weight:700;color:#fff;line-height:1.2">' + esc(r.nombre) + '</div>'
    + '<div style="margin-top:5px;font-size:13px;color:rgba(255,255,255,0.55)">📏 ' + r.km + ' km · 📍 ' + esc(r.muni) + '</div>'
    + stars + _rutaChips(r)
    + (r.descripcion ? '<div style="margin-top:12px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.55">' + esc(r.descripcion) + '</div>' : "")
    + (r.mejor_epoca ? '<div style="margin-top:8px;font-size:12px;color:#9fe0bf">🌤️ Mejor época: ' + esc(r.mejor_epoca) + '</div>' : "")
    + (r.consejos ? '<div style="margin-top:6px;padding:9px 11px;background:rgba(232,201,58,0.08);border:1px solid rgba(232,201,58,0.22);border-radius:10px;font-size:12px;color:#e8d98a">💡 ' + esc(r.consejos) + '</div>' : "")
    + '<div id="rm-weather" style="margin-top:12px"></div>'
    + '<div id="rm-map" style="margin-top:14px"></div>'
    + '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">'
    + '<button data-ridx="' + idx + '" onclick="comoLlegarRuta(this.dataset.ridx)" style="flex:1;min-width:120px;padding:11px;background:rgba(34,114,232,0.14);color:#9cc4f0;border:1px solid rgba(34,114,232,0.35);border-radius:11px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">🧭 Cómo llegar</button>'
    + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer" style="flex:1;min-width:120px;padding:11px;background:rgba(255,255,255,0.06);color:#7ab3e8;border:1px solid rgba(255,255,255,0.12);border-radius:11px;font-size:12px;font-weight:600;text-align:center;text-decoration:none;font-family:Inter,sans-serif">🔗 Wikiloc ↗</a>' : "")
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button data-rn="' + esc(r.nombre) + '" onclick="toggleRutaWishlist(this.dataset.rn,this)" style="flex:1;padding:11px;background:' + (inWish ? "rgba(232,90,160,0.15);color:#f08fc4;border:1px solid rgba(232,90,160,0.4)" : "rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.12)") + ';border-radius:11px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">' + (inWish ? "💖 En tu lista" : "🤍 Quiero hacerla") + '</button>'
    + '<button data-ridx="' + idx + '" onclick="shareRuta(this.dataset.ridx)" style="flex:1;padding:11px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.12);border-radius:11px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📤 Compartir</button>'
    + '</div>'
    + '<button data-rn="' + esc(r.nombre) + '" onclick="document.getElementById(\'ruta-modal\').style.display=\'none\';setTimeout(()=>openRutaUpload(this.dataset.rn),60)" style="display:block;width:100%;margin-top:8px;padding:13px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">✅ La he hecho — valorar y subir fotos</button>'
    + '<div id="rm-friends" style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.5)"></div>'
    + '<div id="rm-gallery" style="margin-top:14px"></div>'
    + '<div id="rm-tips" style="margin-top:16px"></div>'
    + '</div></div>';
  ov.style.display = "flex";
  renderRutaMiniMap(r);
  loadRutaWeather(r);
  loadRutaFriendsModal(r.nombre);
  loadRutaGallery(r.nombre);
  loadRutaTips(r.nombre);
}

// Mini-mapa con el municipio de inicio (y punto de parking si hay coords)
function renderRutaMiniMap(r) {
  const cont = document.getElementById("rm-map");
  if (!cont || !state.muniFeatures || typeof d3 === "undefined") { if (cont) cont.innerHTML = ""; return; }
  const entries = Object.entries(state.muniFeatures).filter(([n, f]) => f);
  const target = r.muni;
  if (!entries.length || !state.muniFeatures[target]) { cont.innerHTML = ""; return; }
  const W = 460, H = 230;
  try {
    const fc = { type: "FeatureCollection", features: entries.map(([n, f]) => f) };
    const proj = d3.geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], fc);
    const path = d3.geoPath(proj);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">';
    entries.forEach(([name, f]) => {
      const hit = name === target;
      svg += '<path d="' + path(f) + '" fill="' + (hit ? "#22b050" : "rgba(255,255,255,0.06)") + '" stroke="' + (hit ? "#fff" : "rgba(255,255,255,0.1)") + '" stroke-width="' + (hit ? 1.1 : 0.4) + '"/>';
    });
    if (r.parking_lat && r.parking_lng) { const p = proj([+r.parking_lng, +r.parking_lat]); if (p) svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="#e8c93a" stroke="#fff" stroke-width="1.5"/>'; }
    else { const c = path.centroid(state.muniFeatures[target]); svg += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3.5" fill="#fff" stroke="#22b050" stroke-width="1"/>'; }
    svg += '</svg>';
    cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase">🗺️ Inicio de la ruta</div><div style="background:#0d1622;border-radius:12px;padding:8px;border:1px solid rgba(255,255,255,0.08)">' + svg + '</div>';
  } catch (e) { cont.innerHTML = ""; }
}

function comoLlegarRuta(idx) {
  const r = getRutas()[+idx]; if (!r) return;
  let url;
  if (r.parking_lat && r.parking_lng) url = "https://www.google.com/maps/dir/?api=1&destination=" + r.parking_lat + "," + r.parking_lng;
  else url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(r.muni + ", Cantabria");
  window.open(url, "_blank", "noopener");
}

// Clima de la zona de la ruta (open-meteo, sin API key)
async function loadRutaWeather(r) {
  const cont = document.getElementById("rm-weather"); if (!cont) return;
  let lat = r.parking_lat, lng = r.parking_lng;
  if ((!lat || !lng) && state.muniFeatures?.[r.muni] && typeof d3 !== "undefined") {
    try { const c = d3.geoCentroid(state.muniFeatures[r.muni]); lng = c[0]; lat = c[1]; } catch (_) {}
  }
  if (!lat || !lng) { cont.innerHTML = ""; return; }
  try {
    const u = "https://api.open-meteo.com/v1/forecast?latitude=" + (+lat).toFixed(3) + "&longitude=" + (+lng).toFixed(3) + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto";
    const res = await fetch(u); const j = await res.json();
    if (!j.daily) { cont.innerHTML = ""; return; }
    const ic = c => c === 0 ? "☀️" : c < 4 ? "🌤️" : c < 50 ? "☁️" : c < 70 ? "🌧️" : c < 80 ? "🌦️" : "⛈️";
    const days = j.daily.time.map((t, i) => {
      const d = new Date(t).toLocaleDateString("es-ES", { weekday: "short" });
      return '<div style="flex:1;text-align:center;background:rgba(255,255,255,0.04);border-radius:10px;padding:8px 4px">'
        + '<div style="font-size:10px;color:rgba(255,255,255,0.5);text-transform:capitalize">' + d + '</div>'
        + '<div style="font-size:20px;margin:2px 0">' + ic(j.daily.weather_code[i]) + '</div>'
        + '<div style="font-size:11px;color:#fff;font-weight:600">' + Math.round(j.daily.temperature_2m_max[i]) + '°<span style="color:rgba(255,255,255,0.4)">/' + Math.round(j.daily.temperature_2m_min[i]) + '°</span></div>'
        + '<div style="font-size:9px;color:#7ab3e8">💧' + (j.daily.precipitation_probability_max[i] ?? 0) + '%</div>'
        + '</div>';
    }).join("");
    cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase">🌤️ El tiempo en la zona</div><div style="display:flex;gap:6px">' + days + '</div>';
  } catch (e) { cont.innerHTML = ""; }
}

async function loadRutaFriendsModal(nombre) {
  const el = document.getElementById("rm-friends"); if (!el || !state.user) return;
  try {
    const friends = await getFriendsCache().catch(() => []);
    const nameById = {}; (friends || []).forEach(f => nameById[f.id] = f.username);
    const all = [...(friends || []).map(f => f.id), state.user.id];
    const { data } = await db.from("photos").select("user_id").eq("municipio", "🥾 " + nombre).in("user_id", all);
    const users = [...new Set((data || []).map(d => d.user_id))];
    if (!users.length) { el.textContent = ""; return; }
    const otros = users.filter(u => u !== state.user.id).map(u => nameById[u]).filter(Boolean);
    const partes = []; if (users.includes(state.user.id)) partes.push("tú"); partes.push(...otros);
    el.innerHTML = "👥 La han hecho: " + esc(partes.join(", "));
  } catch (_) { el.textContent = ""; }
}

// Galería: todas las fotos de la ruta (tuyas + amigos)
async function loadRutaGallery(nombre) {
  const cont = document.getElementById("rm-gallery"); if (!cont || !state.user) return;
  try {
    const friends = await getFriendsCache().catch(() => []);
    const ids = [...new Set([...(friends || []).map(f => f.id), state.user.id])];
    let cols = "id,user_id,storage_path,thumb_path,visibilidad";
    let { data, error } = await db.from("photos").select(cols).in("user_id", ids).eq("municipio", "🥾 " + nombre).neq("storage_path", "text_only").order("created_at", { ascending: !1 }).limit(30);
    if (error && /thumb_path|column|schema cache/i.test(error.message || "")) ({ data } = await db.from("photos").select("id,user_id,storage_path,visibilidad").in("user_id", ids).eq("municipio", "🥾 " + nombre).neq("storage_path", "text_only").limit(30));
    const fotos = (data || []).filter(f => f.user_id === state.user.id || ["amigos", "publico"].includes(f.visibilidad));
    if (!fotos.length) { cont.innerHTML = ""; return; }
    const paths = [...new Set([...fotos.map(f => f.thumb_path).filter(Boolean), ...fotos.map(f => f.storage_path).filter(Boolean)])];
    const urls = await signPaths(paths);
    const cells = fotos.map(f => {
      const t = f.thumb_path ? urls[f.thumb_path] : null, fu = urls[f.storage_path] || null;
      return '<div onclick="openPhotoLightbox(this.dataset.f)" data-f="' + esc(fu || t || "") + '" style="aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;background:#0d2030"><img src="' + esc(t || fu || "") + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"' + (t && fu ? ' onerror="this.onerror=null;this.src=\'' + esc(fu) + '\'"' : "") + '/></div>';
    }).join("");
    cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">📸 Fotos de la ruta (' + fotos.length + ')</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' + cells + '</div>';
  } catch (e) { cont.innerHTML = ""; }
}

// Reseñas / consejos de la comunidad
async function loadRutaTips(nombre) {
  const cont = document.getElementById("rm-tips"); if (!cont || !state.user) return;
  cont.innerHTML = '<div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-bottom:8px;letter-spacing:.05em;text-transform:uppercase">💬 Consejos de la gente</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:10px"><input id="rm-tip-input" placeholder="Deja un consejo (parking, época, dificultad...)" style="flex:1;padding:9px 11px;background:#1a2535;border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;color:#fff;font-family:Inter,sans-serif;outline:none"/><button data-rn="' + esc(nombre) + '" onclick="addRutaTip(this.dataset.rn,this)" style="padding:9px 13px;background:#22b050;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer">Enviar</button></div>'
    + '<div id="rm-tip-list"><div style="font-size:12px;color:rgba(255,255,255,0.3)">Cargando...</div></div>';
  try {
    const { data, error } = await db.from("ruta_tips").select("*").eq("ruta", nombre).order("created_at", { ascending: !1 }).limit(20);
    if (error) throw error;
    const lst = document.getElementById("rm-tip-list");
    const uids = [...new Set((data || []).map(t => t.user_id))];
    let nm = {};
    if (uids.length) { const { data: ps } = await db.from("profiles").select("id,username").in("id", uids); (ps || []).forEach(p => nm[p.id] = p.username); }
    if (!data || !data.length) { lst.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.3)">Aún no hay consejos. ¡Deja el primero!</div>'; return; }
    lst.innerHTML = data.map(t => '<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="font-size:12px;color:#fff;line-height:1.4">' + esc(t.texto) + '</div><div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:3px">@' + esc(nm[t.user_id] || "alguien") + '</div></div>').join("");
  } catch (e) {
    document.getElementById("rm-tip-list").innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.3)">Activa los consejos ejecutando el SQL (migración 10).</div>';
  }
}
async function addRutaTip(nombre, btn) {
  const inp = document.getElementById("rm-tip-input"); const txt = (inp?.value || "").trim();
  if (!txt) return;
  btn.disabled = !0;
  try {
    const { error } = await db.from("ruta_tips").insert({ ruta: nombre, user_id: state.user.id, texto: txt.slice(0, 300) });
    if (error) throw error;
    inp.value = ""; loadRutaTips(nombre); toast("¡Gracias por el consejo!", "success");
  } catch (e) { toast("No se pudo enviar: " + (e.message || e), "error"); }
  finally { btn.disabled = !1; }
}

async function toggleRutaWishlist(nombre, el) {
  if (!state.user) return;
  state.rutaWishlist = state.rutaWishlist || new Set();
  const has = state.rutaWishlist.has(nombre);
  try {
    if (has) { await db.from("ruta_wishlist").delete().eq("user_id", state.user.id).eq("ruta", nombre); state.rutaWishlist.delete(nombre); }
    else { await db.from("ruta_wishlist").upsert({ user_id: state.user.id, ruta: nombre }, { onConflict: "user_id,ruta" }); state.rutaWishlist.add(nombre); }
    const now = !has;
    if (el) { el.innerHTML = now ? "💖 En tu lista" : "🤍 Quiero hacerla"; el.style.background = now ? "rgba(232,90,160,0.15)" : "rgba(255,255,255,0.06)"; el.style.color = now ? "#f08fc4" : "rgba(255,255,255,0.7)"; el.style.border = now ? "1px solid rgba(232,90,160,0.4)" : "1px solid rgba(255,255,255,0.12)"; }
  } catch (e) { toast("No se pudo (¿SQL migración 10?)", "error"); }
}

async function loadRutaWishlist() {
  if (!state.user) return;
  try { const { data } = await db.from("ruta_wishlist").select("ruta").eq("user_id", state.user.id); state.rutaWishlist = new Set((data || []).map(d => d.ruta)); } catch (_) { state.rutaWishlist = new Set(); }
}

// Compartir ruta (imagen sencilla reutilizando el estilo de fiesta)
async function shareRuta(idx) {
  const r = getRutas()[+idx]; if (!r) return;
  try {
    const W = 1080, H = 1080, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0d2a1e"); g.addColorStop(1, "#13361f"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.textAlign = "center"; x.font = "120px serif"; x.fillText("🥾", W / 2, 230);
    x.fillStyle = "#fff"; x.font = "bold 76px Georgia, serif"; const yy = _wrapTextEv(x, r.nombre, W / 2, 380, 900, 88);
    x.fillStyle = "rgba(255,255,255,0.85)"; x.font = "44px Inter, Arial, sans-serif"; x.fillText("📏 " + r.km + " km · 📍 " + r.muni, W / 2, yy + 120);
    const rt = state.rutaRatings?.[r.nombre];
    if (rt) { x.fillStyle = "#e8c93a"; x.font = "48px Arial"; x.fillText("★".repeat(Math.round(rt.media)) + "  " + rt.media.toFixed(1), W / 2, yy + 200); }
    x.fillStyle = "rgba(255,255,255,0.5)"; x.font = "30px Inter, Arial, sans-serif"; x.fillText("Ya lo pisé · Conquista Cantabria", W / 2, H - 80);
    const blob = await new Promise(rz => c.toBlob(rz, "image/png"));
    const file = new File([blob], "ruta.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: r.nombre, text: "¡Esta ruta mola! 🥾" });
    else { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "ruta.png"; a.click(); URL.revokeObjectURL(url); toast("Imagen descargada", "success"); }
  } catch (e) { toast("No se pudo compartir", "error"); }
}

async function loadRutaSuggestionsReview() {
    const cont = document.getElementById("sugrev-rutas"); if (!cont) return;
    try {
        const { data, error } = await db.from("ruta_suggestions").select("*").eq("estado", "pendiente").order("created_at", { ascending: !1 });
        if (error) throw error;
        if (!data || !data.length) { cont.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px">Sin rutas pendientes</div>'; return; }
        cont.innerHTML = data.map(s => '<div style="padding:13px;border:1px solid rgba(255,255,255,0.1);border-radius:14px;margin-bottom:10px">'
            + '<div style="font-size:14px;font-weight:700;color:#fff">🥾 ' + esc(s.nombre) + '</div>'
            + '<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px">📍 ' + esc(s.muni || "") + (s.km ? ' · ' + s.km + ' km' : '') + (s.dificultad ? ' · ' + esc(s.dificultad) : '') + '</div>'
            + (s.descripcion ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:5px;line-height:1.4">' + esc(s.descripcion) + '</div>' : '')
            + '<div style="display:flex;gap:8px;margin-top:10px">'
            + '<button data-sid="' + s.id + '" onclick="approveRutaSuggestion(this.dataset.sid,this)" style="flex:1;padding:9px;background:#22b050;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">✓ Aprobar y publicar</button>'
            + '<button data-sid="' + s.id + '" onclick="rejectRutaSuggestion(this.dataset.sid,this)" style="padding:9px 14px;background:rgba(232,40,40,0.15);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">Rechazar</button>'
            + '</div></div>').join("");
    } catch (e) { cont.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px">Ejecuta el SQL de rutas (migración 10).</div>'; }
}

// — Sugerir una ruta (la revisa el admin Itsvalvs) —
function openSugerirRuta() {
    if (!state.user) { toast("Inicia sesión para sugerir una ruta", "info"); return; }
    let ov = document.getElementById("sugruta-modal");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "sugruta-modal";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:340;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)";
        ov.addEventListener("click", e => { if (e.target === ov) ov.style.display = "none"; });
        document.body.appendChild(ov);
    }
    const inp = "width:100%;margin-top:8px;padding:11px 12px;background:#1a2535;border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:13px;color:#fff;font-family:Inter,sans-serif;outline:none;box-sizing:border-box";
    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:20px 18px 26px" onclick="event.stopPropagation()">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:700;color:#fff">➕ Sugerir una ruta</div><button onclick="document.getElementById(\'sugruta-modal\').style.display=\'none\'" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer">✕</button></div>'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:6px">La revisaremos antes de publicarla. ¡Gracias por completar el mapa!</div>'
        + '<input id="sr-nombre" placeholder="Nombre de la ruta" style="' + inp + '"/>'
        + '<input id="sr-muni" placeholder="Municipio de inicio" style="' + inp + '"/>'
        + '<input id="sr-km" type="number" step="0.1" placeholder="Km (ej. 8.5)" style="' + inp + '"/>'
        + '<select id="sr-dif" style="' + inp + '"><option value="">Dificultad...</option><option value="Fácil">Fácil</option><option value="Media">Media</option><option value="Difícil">Difícil</option></select>'
        + '<input id="sr-url" placeholder="Enlace Wikiloc (opcional)" style="' + inp + '"/>'
        + '<textarea id="sr-desc" placeholder="Descripción / consejos (opcional)" style="' + inp + ';min-height:64px;resize:none"></textarea>'
        + '<button onclick="enviarSugerenciaRuta(this)" style="width:100%;margin-top:12px;padding:13px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif">Enviar sugerencia</button>'
        + '</div>';
    ov.style.display = "flex";
}
async function enviarSugerenciaRuta(btn) {
    const nombre = document.getElementById("sr-nombre")?.value.trim();
    const muni = document.getElementById("sr-muni")?.value.trim();
    const km = parseFloat(document.getElementById("sr-km")?.value) || null;
    const dif = document.getElementById("sr-dif")?.value || null;
    const url = document.getElementById("sr-url")?.value.trim() || null;
    const desc = document.getElementById("sr-desc")?.value.trim() || null;
    if (!nombre || !muni) { toast("Pon al menos nombre y municipio", "info"); return; }
    btn.disabled = !0; btn.textContent = "Enviando...";
    try {
        const { error } = await db.from("ruta_suggestions").insert({ user_id: state.user.id, nombre, muni, km, dificultad: dif, url, descripcion: desc, estado: "pendiente" });
        if (error) throw error;
        document.getElementById("sugruta-modal").style.display = "none";
        toast("¡Sugerencia enviada! La revisaremos 🙌", "success");
    } catch (e) { toast("No se pudo enviar: " + (e.message || e), "error"); }
    finally { btn.disabled = !1; btn.textContent = "Enviar sugerencia"; }
}
async function approveRutaSuggestion(sid, btn) {
    if (!isAdmin()) return;
    btn.disabled = !0; btn.textContent = "Publicando...";
    try {
        const { data: s, error: e1 } = await db.from("ruta_suggestions").select("*").eq("id", sid).single();
        if (e1) throw e1;
        const { error: e2 } = await db.from("rutas").insert({ nombre: s.nombre, muni: s.muni, km: s.km, dificultad: s.dificultad, url: s.url, descripcion: s.descripcion });
        if (e2) throw e2;
        await db.from("ruta_suggestions").update({ estado: "aprobada" }).eq("id", sid);
        toast("Ruta publicada 🥾", "success");
        btn.closest("div[style*='border-radius:14px']")?.remove();
        state.rutas = null; loadRutasState();
    } catch (e) { toast("No se pudo: " + (e.message || e), "error"); btn.disabled = !1; btn.textContent = "✓ Aprobar y publicar"; }
}
async function rejectRutaSuggestion(sid, btn) {
    if (!isAdmin()) return;
    try { await db.from("ruta_suggestions").update({ estado: "rechazada" }).eq("id", sid); btn.closest("div[style*='border-radius:14px']")?.remove(); toast("Sugerencia rechazada", "info"); }
    catch (e) { toast("Error", "error"); }
}

function selectRuta(idx) {
    const r = getRutas()[+idx];
    if (!r) return;
    mapFilter = "ruta:" + idx;
    // Resaltar el municipio de la ruta en el mapa
    applyMapFilter();
    // Marcar visualmente el botón elegido
    document.querySelectorAll(".ruta-dd-btn").forEach(b => {
        const act = b.dataset.ridx === String(idx);
        b.style.background = act ? "rgba(34,176,80,0.2)" : "rgba(255,255,255,0.05)";
        b.style.borderColor = act ? "rgba(34,176,80,0.55)" : "rgba(255,255,255,0.12)";
    });
    // Llevar el mapa al municipio y mostrar tarjeta de la ruta
    if (typeof highlightMuniOnMap === "function" && r.muni) {
        // sin abrir ficha completa, solo centrar
        try { zoomToMuni(r.muni); } catch(e) {}
    }
    mostrarTarjetaRuta(r, +idx);
}

function mostrarTarjetaRuta(r, idx) {
    let card = document.getElementById("ruta-card");
    if (!card) {
        card = document.createElement("div");
        card.id = "ruta-card";
        const dd = document.getElementById("map-areas-dd");
        // Justo encima de la lista de rutas (debajo de los filtros)
        dd.parentNode.insertBefore(card, dd);
    }
    const link = r.url
        ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:12px;color:#7ab3e8;text-decoration:none">🔗 Ver ruta en Wikiloc ↗</a>'
        : '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.35)">Sin enlace disponible</div>';
    card.style.cssText = "margin:0 12px 10px;padding:13px 15px;background:rgba(93,202,165,0.08);border:1px solid rgba(93,202,165,0.3);border-radius:14px";
    const rt = state.rutaRatings?.[r.nombre];
    const ratingLine = rt
        ? '<div style="font-size:12px;color:#e8c93a;margin-top:4px">' + '★'.repeat(Math.round(rt.media)) + '<span style="color:rgba(255,255,255,0.18)">' + '★'.repeat(Math.max(0, 5 - Math.round(rt.media))) + '</span> <span style="color:rgba(255,255,255,0.55)">' + rt.media.toFixed(1) + ' · ' + rt.n + ' valoración' + (rt.n === 1 ? '' : 'es') + '</span></div>'
        : '<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:4px">Aún sin valoraciones</div>';
    card.innerHTML = '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">🥾 ' + esc(r.nombre) + '</div>'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.6)">📏 ' + r.km + ' km · 📍 ' + esc(r.muni) + '</div>'
        + ratingLine
        + '<div id="ruta-card-friends" style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:4px"></div>'
        + '<button onclick="openRutaModal(' + (idx != null ? idx : -1) + ')" style="display:block;width:100%;margin-top:10px;padding:10px;background:rgba(34,114,232,0.14);color:#9cc4f0;border:1px solid rgba(34,114,232,0.35);border-radius:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📋 Ver ficha completa</button>'
        + '<button data-rn="' + esc(r.nombre) + '" onclick="openRutaUpload(this.dataset.rn)" style="display:block;width:100%;margin-top:8px;padding:11px;background:#22b050;color:#fff;border:none;border-radius:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">✅ La he hecho — valorar y subir fotos</button>';
    loadRutaFriends(r.nombre);
}

// Qué amigos han hecho esta ruta (han publicado en "🥾 nombre")
async function loadRutaFriends(nombre) {
    const el = document.getElementById("ruta-card-friends");
    if (!el || !state.user) return;
    try {
        const friends = await getFriendsCache();
        const ids = friends.map(f => f.id);
        const nameById = {}; friends.forEach(f => nameById[f.id] = f.username);
        const all = [...ids, state.user.id];
        const { data } = await db.from("photos")
            .select("user_id").eq("municipio", "🥾 " + nombre).in("user_id", all);
        const users = [...new Set((data || []).map(d => d.user_id))];
        const otros = users.filter(u => u !== state.user.id).map(u => nameById[u]).filter(Boolean);
        const yo = users.includes(state.user.id);
        if (!users.length) { el.textContent = ""; return; }
        let txt = "👥 La han hecho: ";
        const partes = [];
        if (yo) partes.push("tú");
        partes.push(...otros);
        el.textContent = txt + partes.join(", ");
    } catch (_) { el.textContent = ""; }
}


//  sin tabla nueva: solicitudes de amistad + comentarios + likes
//  sobre tus fotos. El "visto" se guarda en localStorage.)
// ═══════════════════════════════════════════════════════════
function _notifSeenKey() { return "ylp_notif_seen_" + (state.user?.id || "x"); }
function _notifLastSeen() { try { return +(localStorage.getItem(_notifSeenKey()) || 0); } catch (_) { return 0; } }
function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "ahora";
    const m = Math.floor(s / 60); if (m < 60) return "hace " + m + " min";
    const h = Math.floor(m / 60); if (h < 24) return "hace " + h + " h";
    const d = Math.floor(h / 24); if (d < 7) return "hace " + d + " d";
    return new Date(ts).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

async function fetchNotifications() {
    if (!state.user) return [];
    const items = [];
    const yo = state.user.id;
    const miNick = (state.profile?.username || "").trim();
    const add = (o) => items.push(o);

    // 1) Solicitudes de amistad pendientes
    try {
        const { data: reqs } = await db.from("friendships")
            .select("follower_id, profiles:profiles!friendships_follower_id_fkey(username,avatar_url)")
            .eq("following_id", yo).eq("estado", "pendiente");
        (reqs || []).filter(r => !state.blockedIds?.has(r.follower_id)).forEach(r => add({
            key: "req:" + r.follower_id, ts: Date.now(), always: true, icon: "👋",
            text: "<strong>@" + esc(r.profiles?.username || "alguien") + "</strong> quiere ser tu amigo",
            action: "goToSolicitudes()"
        }));
    } catch (e) { console.warn("notif reqs:", e); }

    // 2) Menciones @tu_usuario (van antes para tener prioridad sobre el comentario suelto)
    if (miNick) {
        try {
            const { data: ms } = await db.from("photo_comments")
                .select("user_id,texto,created_at,photo_id, profiles(username,avatar_url)")
                .ilike("texto", "%@" + miNick + "%").neq("user_id", yo)
                .order("created_at", { ascending: false }).limit(20);
            (ms || []).filter(c => !state.blockedIds?.has(c.user_id)).forEach(c => add({
                key: "cm:" + c.photo_id + ":" + c.created_at + ":" + c.user_id,
                ts: +new Date(c.created_at), icon: "📣",
                text: "<strong>@" + esc(c.profiles?.username || "alguien") + "</strong> te mencionó: " + esc((c.texto || "").slice(0, 45)),
                action: "goToFeedPhoto(" + JSON.stringify(String(c.photo_id)) + ")"
            }));
        } catch (e) { console.warn("notif menciones:", e); }
    }

    const myIds = state.photos.map(p => p.id).filter(Boolean).slice(0, 200);
    if (myIds.length) {
        // 3) Comentarios en tus fotos
        try {
            const { data: cs } = await db.from("photo_comments")
                .select("user_id,texto,created_at,photo_id, profiles(username,avatar_url)")
                .in("photo_id", myIds).neq("user_id", yo)
                .order("created_at", { ascending: false }).limit(30);
            (cs || []).filter(c => !state.blockedIds?.has(c.user_id)).forEach(c => add({
                key: "cm:" + c.photo_id + ":" + c.created_at + ":" + c.user_id,
                ts: +new Date(c.created_at), icon: "💬",
                text: "<strong>@" + esc(c.profiles?.username || "alguien") + "</strong> comentó: " + esc((c.texto || "").slice(0, 50)),
                action: "goToFeedPhoto(" + JSON.stringify(String(c.photo_id)) + ")"
            }));
        } catch (e) { console.warn("notif comments:", e); }

        // 4) Likes / reacciones en tus fotos
        try {
            const likeIds = myIds.flatMap(id => [id, id + "_fire", id + "_love"]);
            let r = await db.from("photo_likes").select("user_id,photo_id,created_at")
                .in("photo_id", likeIds).neq("user_id", yo)
                .order("created_at", { ascending: false }).limit(40);
            if (r.error) r = await db.from("photo_likes").select("user_id,photo_id").in("photo_id", likeIds).neq("user_id", yo).limit(40);
            const ls = (r.data || []).filter(l => !state.blockedIds?.has(l.user_id));
            const likers = [...new Set(ls.map(l => l.user_id))];
            const names = {};
            if (likers.length) { const { data: ps } = await db.from("profiles").select("id,username").in("id", likers); (ps || []).forEach(p => names[p.id] = p.username); }
            ls.forEach(l => add({
                key: "lk:" + l.photo_id + ":" + l.user_id,
                ts: +new Date(l.created_at || Date.now()),
                icon: String(l.photo_id).endsWith("_fire") ? "🔥" : String(l.photo_id).endsWith("_love") ? "😍" : "❤️",
                text: "<strong>@" + esc(names[l.user_id] || "alguien") + "</strong> reaccionó a tu foto",
                action: "goToFeedPhoto(" + JSON.stringify(String(l.photo_id).replace(/_(fire|love)$/, "")) + ")"
            }));
        } catch (e) { console.warn("notif likes:", e); }
    }

    // 5) Respuestas en publicaciones donde tú también has comentado
    try {
        const { data: mios } = await db.from("photo_comments").select("photo_id")
            .eq("user_id", yo).order("created_at", { ascending: false }).limit(50);
        const hilos = [...new Set((mios || []).map(c => String(c.photo_id)))].filter(id => !myIds.includes(id));
        if (hilos.length) {
            const { data: cs2 } = await db.from("photo_comments")
                .select("user_id,texto,created_at,photo_id, profiles(username,avatar_url)")
                .in("photo_id", hilos).neq("user_id", yo)
                .order("created_at", { ascending: false }).limit(30);
            (cs2 || []).filter(c => !state.blockedIds?.has(c.user_id)).forEach(c => add({
                key: "cm:" + c.photo_id + ":" + c.created_at + ":" + c.user_id,
                ts: +new Date(c.created_at), icon: "💭",
                text: "<strong>@" + esc(c.profiles?.username || "alguien") + "</strong> también comentó: " + esc((c.texto || "").slice(0, 45)),
                action: "goToFeedPhoto(" + JSON.stringify(String(c.photo_id)) + ")"
            }));
        }
    } catch (e) { console.warn("notif hilos:", e); }

    // 6) Te han etiquetado en una foto
    try {
        const { data: tg } = await db.from("photo_tags")
            .select("photo_id,tagger_id,created_at, profiles:profiles!photo_tags_tagger_id_fkey(username)")
            .eq("tagged_id", yo).order("created_at", { ascending: false }).limit(20);
        (tg || []).filter(t => !state.blockedIds?.has(t.tagger_id)).forEach(t => add({
            key: "tg:" + t.photo_id + ":" + t.tagger_id,
            ts: +new Date(t.created_at), icon: "🏷️",
            text: "<strong>@" + esc(t.profiles?.username || "alguien") + "</strong> te ha etiquetado en una foto",
            action: "goToFeedPhoto(" + JSON.stringify(String(t.photo_id)) + ")"
        }));
    } catch (e) { console.warn("notif tags:", e); }

  
    // Sin duplicados (una mención en tu propia foto saldría dos veces)
    const vistos = new Set();
    const unicos = items.filter(i => { if (vistos.has(i.key)) return false; vistos.add(i.key); return true; });
    unicos.sort((a, b) => b.ts - a.ts);
    return unicos.slice(0, 40);
}

async function loadNotifBadge() {
    try {
        const items = await fetchNotifications();
        state._notifs = items;
        const lastSeen = _notifLastSeen();
        const unread = items.filter(i => i.ts > lastSeen).length;
        document.querySelectorAll(".notif-badge").forEach(b => {
            if (unread > 0) { b.textContent = unread > 9 ? "9+" : unread; b.style.display = "flex"; }
            else b.style.display = "none";
        });
    } catch (e) { console.warn("loadNotifBadge:", e); }
}

function renderNotifList() {
    const list = document.getElementById("notif-list");
    if (!list) return;
    const items = state._notifs || [];
    const lastSeen = _notifLastSeen();
    if (!items.length) {
        list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.3);font-size:13px"><i class="ti ti-bell-off" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>No tienes notificaciones todavía</div>';
        return;
    }
    list.innerHTML = items.map(i => {
        const unread = i.ts > lastSeen;
        return '<div ' + (i.action ? 'onclick="closeNotifs();' + i.action + '" style="cursor:pointer;' : 'style="')
            + 'display:flex;gap:11px;align-items:flex-start;padding:11px 18px;' + (unread ? 'background:rgba(34,114,232,0.06);' : '') + 'border-bottom:1px solid rgba(255,255,255,0.04)">'
            + '<span style="font-size:18px;flex-shrink:0;line-height:1.3">' + i.icon + '</span>'
            + '<div style="flex:1;font-size:13px;color:rgba(255,255,255,0.85);line-height:1.45">' + i.text
            + '<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">' + timeAgo(i.ts) + '</div></div>'
            + (unread ? '<span style="width:7px;height:7px;border-radius:50%;background:#2272e8;flex-shrink:0;margin-top:5px"></span>' : '')
            + '</div>';
    }).join("");
}

async function openNotifs() {
    const ov = document.getElementById("notif-ov");
    const list = document.getElementById("notif-list");
    if (!ov || !list) return;
    ov.style.display = "flex";
    list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 10px"></div>Cargando...</div>';
    state._notifs = await fetchNotifications();
    renderNotifList();   // se pintan con el estado real de leído/no leído
}

function closeNotifs() {
    const ov = document.getElementById("notif-ov");
    if (ov) ov.style.display = "none";
    markNotifsRead();   // al cerrar, se dan por vistas
}

function markNotifsRead(repintar) {
    try { localStorage.setItem(_notifSeenKey(), String(Date.now())); } catch (_) {}
    loadNotifBadge();
    if (repintar) renderNotifList();
}


// ═══════════════════════════════════════════════════════════
//  TOASTS  +  MODAL DE CONFIRMACIÓN PROPIO
//  toast(msg, tipo)  ·  tipo: 'success' | 'error' | 'info'
//  confirmar(texto, {titulo, ok, cancel}) -> Promise<boolean>
// ═══════════════════════════════════════════════════════════
function toast(msg, tipo = "info", ms = 3200) {
    const wrap = document.getElementById("toast-wrap");
    if (!wrap) { console.log("toast:", msg); return; }
    const colores = {
        success: { bg: "#1a7a3e", ic: "✓" },
        error:   { bg: "#a82828", ic: "⚠" },
        info:    { bg: "#1e3a5f", ic: "ℹ" }
    };
    const c = colores[tipo] || colores.info;
    const el = document.createElement("div");
    el.style.cssText = "pointer-events:auto;max-width:420px;width:fit-content;display:flex;align-items:center;gap:9px;"
        + "background:" + c.bg + ";color:#fff;padding:11px 16px;border-radius:12px;font-size:13px;font-weight:500;"
        + "box-shadow:0 8px 28px rgba(0,0,0,0.4);font-family:Inter,sans-serif;line-height:1.35;"
        + "opacity:0;transform:translateY(12px);transition:opacity .22s ease,transform .22s ease";
    el.innerHTML = '<span style="font-size:15px;flex-shrink:0">' + c.ic + '</span><span>' + esc(String(msg)) + '</span>';
    wrap.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
    setTimeout(() => {
        el.style.opacity = "0"; el.style.transform = "translateY(12px)";
        setTimeout(() => el.remove(), 260);
    }, ms);
}

function confirmar(texto, opts = {}) {
    return new Promise(resolve => {
        const ov = document.getElementById("confirm-ov");
        if (!ov) return resolve(window.confirm(texto)); // fallback
        document.getElementById("confirm-title").textContent = opts.titulo || "¿Confirmar?";
        document.getElementById("confirm-msg").textContent = texto;
        const okB = document.getElementById("confirm-ok");
        const caB = document.getElementById("confirm-cancel");
        okB.textContent = opts.ok || "Confirmar";
        caB.textContent = opts.cancel || "Cancelar";
        okB.style.background = opts.peligro ? "#c43030" : "#22b050";
        ov.style.display = "flex";
        const cerrar = (val) => {
            ov.style.display = "none";
            okB.onclick = null; caB.onclick = null; ov.onclick = null;
            resolve(val);
        };
        okB.onclick = () => cerrar(true);
        caB.onclick = () => cerrar(false);
        ov.onclick = (e) => { if (e.target === ov) cerrar(false); };
    });
}

// ═══════════════════════════════════════════════════════════
//  NIVELES  +  INSIGNIAS
// ═══════════════════════════════════════════════════════════
const NIVELES = [
    { min: 0,   nombre: "Forastero",              emoji: "🌱" },
    { min: 5,   nombre: "Explorador novato",      emoji: "🧭" },
    { min: 15,  nombre: "Caminante",              emoji: "🥾" },
    { min: 30,  nombre: "Montañero",              emoji: "⛰️" },
    { min: 50,  nombre: "Trotamundos cántabro",   emoji: "🗺️" },
    { min: 75,  nombre: "Veterano de Cantabria",  emoji: "🌟" },
    { min: 96,  nombre: "Maestro cántabro",       emoji: "👑" },
    { min: 103, nombre: "El Cántabru de pura cepa", emoji: "🏔️" }
];
function nivelPara(n) {
    let idx = 0;
    for (let i = 0; i < NIVELES.length; i++) if (n >= NIVELES[i].min) idx = i;
    const actual = NIVELES[idx], siguiente = NIVELES[idx + 1] || null;
    return { idx, actual, siguiente, n };
}

// Catálogo de insignias. `check(ctx)` devuelve true si está conseguida.
const INSIGNIAS = [
    { id: "primeros_pasos", emoji: "🌱", nombre: "Primeros pasos",  desc: "Conquista tu primer municipio",           check: c => c.muni >= 1 },
    { id: "explorador",     emoji: "🧭", nombre: "Explorador",       desc: "10 municipios conquistados",               check: c => c.muni >= 10 },
    { id: "mitad",          emoji: "🗺️", nombre: "A mitad de camino", desc: "52 municipios",                          check: c => c.muni >= 52 },
    { id: "costa",          emoji: "🌅", nombre: "Toda la costa",    desc: "Todos los municipios costeros",            check: c => c.costaTotal },
    { id: "comarca",        emoji: "🏔️", nombre: "Comarca completa", desc: "Todos los municipios de una comarca",      check: c => c.comarcaCompleta },
    { id: "senderista",     emoji: "🥾", nombre: "Senderista",       desc: "Visita 5 municipios que tienen ruta",      check: c => c.muniConRuta >= 5 },
    { id: "reportero",      emoji: "📸", nombre: "Reportero",        desc: "Sube 25 fotos",                            check: c => c.fotos >= 25 },
    { id: "sprint",         emoji: "⚡", nombre: "Sprint conquistador", desc: "10 municipios en un mismo mes",         check: c => c.maxMes >= 10 },
    { id: "social",         emoji: "💬", nombre: "Alma del grupo",   desc: "Recibe 50 reacciones",                     check: c => c.likes >= 50 },
    { id: "cantabru",       emoji: "🏆", nombre: "El Cántabru",      desc: "Los 103 municipios",                       check: c => c.muni >= (state.totalMuni || 103) }
];

function _badgeContext() {
    const visitedNames = Object.keys(state.visited || {});
    const muni = visitedNames.length;
    // Toda la costa
    const costa = (state.coast && state.coast.length) ? state.coast : null;
    const costaTotal = !!(costa && costa.length && costa.every(m => state.visited[m]));
    // Comarca completa (si tenemos municipiosData con comarca)
    let comarcaCompleta = false;
    const md = state.municipiosData;
    if (md) {
        const porComarca = {};
        Object.values(md).forEach(m => {
            if (!m.comarca) return;
            (porComarca[m.comarca] = porComarca[m.comarca] || []).push(m.nombre);
        });
        comarcaCompleta = Object.values(porComarca).some(arr => arr.length >= 2 && arr.every(n => state.visited[n]));
    }
    // Municipios con ruta visitados
    let muniConRuta = 0;
    if (md) visitedNames.forEach(n => { if (md[n] && String(md[n].ruta || "").trim()) muniConRuta++; });
    // Máximo de conquistas en un mismo mes (si guardamos fechas)
    let maxMes = 0;
    if (state.visitDates) {
        const cnt = {};
        Object.values(state.visitDates).forEach(f => { if (!f) return; const k = String(f).slice(0, 7); cnt[k] = (cnt[k] || 0) + 1; });
        maxMes = Object.values(cnt).reduce((a, b) => Math.max(a, b), 0);
    }
    return { muni, fotos: state.photos.length, costaTotal, comarcaCompleta, muniConRuta, maxMes, likes: state._likesRecibidos || 0 };
}

async function loadHikingStats() {
    const anchor = document.getElementById("profile-progress");
    if (!anchor || !state.user) return;
    let box = document.getElementById("hiking-stats");
    if (!box) { box = document.createElement("div"); box.id = "hiking-stats"; anchor.parentNode.insertBefore(box, anchor.nextSibling); }
    try {
        const { data } = await db.from("photos").select("municipio").eq("user_id", state.user.id).like("municipio", "🥾%");
        const rutasHechas = [...new Set((data || []).map(d => (d.municipio || "").replace(/^🥾\s*/, "").trim()).filter(Boolean))];
        if (!rutasHechas.length) { box.innerHTML = ""; return; }
        const rutas = getRutas();
        let km = 0; rutasHechas.forEach(n => { const r = rutas.find(x => x.nombre === n); if (r && r.km) km += Number(r.km) || 0; });
        const n = rutasHechas.length;
        const tier = n >= 25 ? { e: "🏔️", t: "Montañero experto" } : n >= 10 ? { e: "🥾", t: "Senderista" } : n >= 5 ? { e: "🌲", t: "Senderista junior" } : { e: "🍃", t: "Caminante novato" };
        box.innerHTML = '<div style="margin:14px 0;padding:14px;background:linear-gradient(135deg,rgba(34,176,80,0.12),rgba(34,114,232,0.08));border:1px solid rgba(34,176,80,0.25);border-radius:16px">'
            + '<div style="display:flex;align-items:center;justify-content:space-between"><div style="font-size:13px;font-weight:700;color:#fff">' + tier.e + ' ' + tier.t + '</div><div style="font-size:11px;color:rgba(255,255,255,0.5)">' + n + ' ruta' + (n === 1 ? "" : "s") + '</div></div>'
            + '<div style="display:flex;gap:18px;margin-top:10px">'
            + '<div><div style="font-size:22px;font-weight:800;color:#5DCAA5">' + km.toFixed(1) + '</div><div style="font-size:10px;color:rgba(255,255,255,0.5)">km caminados</div></div>'
            + '<div><div style="font-size:22px;font-weight:800;color:#9cc4f0">' + n + '</div><div style="font-size:10px;color:rgba(255,255,255,0.5)">rutas hechas</div></div>'
            + '</div></div>';
    } catch (_) { box.innerHTML = ""; }
}

async function refreshBadgesAndLevel(celebrate = false) {
    loadHikingStats();
    const box = document.getElementById("profile-progress");
    const ctx = _badgeContext();
    const lvl = nivelPara(ctx.muni);

    // Insignias conseguidas ahora mismo
    const earned = INSIGNIAS.filter(b => { try { return b.check(ctx); } catch (_) { return false; } });
    const earnedIds = new Set(earned.map(b => b.id));

    // Persistencia + detección de nuevas (degrada con elegancia si no hay tabla)
    let prev = state._badgesPrev;
    if (!prev) {
        prev = new Set();
        let tablaOk = false;
        try {
            const { data, error } = await db.from("user_badges").select("badge_id").eq("user_id", state.user.id);
            if (error) throw error;
            (data || []).forEach(r => prev.add(r.badge_id));
            tablaOk = true;
        } catch (_) {
            // Sin tabla user_badges: sembramos con lo ya conseguido para no
            // disparar celebraciones falsas. (Ejecuta supabase_setup_3.sql)
            earnedIds.forEach(id => prev.add(id));
        }
        state._badgesPrev = prev;
        state._badgesTablaOk = tablaOk;
    }
    const nuevas = earned.filter(b => !prev.has(b.id));
    if (nuevas.length) {
        if (state._badgesTablaOk) {
            try {
                await db.from("user_badges").upsert(
                    nuevas.map(b => ({ user_id: state.user.id, badge_id: b.id })),
                    { onConflict: "user_id,badge_id" }
                );
            } catch (_) {}
        }
        nuevas.forEach(b => prev.add(b.id));
        if (celebrate) nuevas.forEach((b, i) => setTimeout(() => celebrarInsignia(b), i * 600));
    }

    if (!box) return;
    // Render: barra de nivel + rejilla de insignias
    const restante = lvl.siguiente ? (lvl.siguiente.min - ctx.muni) : 0;
    const span = lvl.siguiente ? (lvl.siguiente.min - lvl.actual.min) : 1;
    const dentro = ctx.muni - lvl.actual.min;
    const pct = lvl.siguiente ? Math.min(100, Math.round(dentro / span * 100)) : 100;
    box.innerHTML =
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;margin:14px 0">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
        + '<div style="font-size:26px;line-height:1">' + lvl.actual.emoji + '</div>'
        + '<div style="flex:1"><div style="font-family:\'Playfair Display\',serif;font-size:15px;font-weight:700;color:#fff">' + lvl.actual.nombre + '</div>'
        + '<div style="font-size:11px;color:rgba(255,255,255,0.45)">Nivel ' + (lvl.idx + 1) + ' · ' + ctx.muni + ' municipios</div></div></div>'
        + '<div style="height:8px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#22b050,#5DCAA5);border-radius:999px;transition:width .5s ease"></div></div>'
        + '<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:6px">' + (lvl.siguiente ? ('Te faltan ' + restante + ' para ' + lvl.siguiente.emoji + ' ' + lvl.siguiente.nombre) : '¡Nivel máximo alcanzado! 🎉') + '</div>'
        + '</div>'
        + '<div style="margin-bottom:6px"><h2 style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.4);letter-spacing:.06em;text-transform:uppercase">Insignias <span style="color:rgba(255,255,255,0.3)">' + earned.length + '/' + INSIGNIAS.length + '</span></h2></div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:10px;margin-bottom:14px">'
        + INSIGNIAS.map(b => {
            const on = earnedIds.has(b.id);
            return '<div data-bn="' + esc(b.nombre) + '" data-bd="' + esc(b.desc) + '" onclick="toast(this.dataset.bn + \' — \' + this.dataset.bd, \'info\')" '
                + 'style="text-align:center;cursor:pointer;opacity:' + (on ? '1' : '0.32') + '">'
                + '<div style="font-size:28px;filter:' + (on ? 'none' : 'grayscale(1)') + ';line-height:1.2">' + b.emoji + '</div>'
                + '<div style="font-size:9px;color:rgba(255,255,255,' + (on ? '0.6' : '0.3') + ');margin-top:3px;line-height:1.1">' + esc(b.nombre) + '</div>'
                + '</div>';
        }).join("")
        + '</div>';
}

function celebrarInsignia(b) {
    if (document.getElementById("insignia-modal")) { setTimeout(() => celebrarInsignia(b), 700); return; }
    const e = document.createElement("div");
    e.id = "insignia-modal";
    e.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center";
    e.innerHTML = '<div style="font-size:72px;margin-bottom:16px">' + b.emoji + '</div>'
        + '<div style="font-family:Playfair Display,serif;font-size:26px;font-weight:700;color:#fff;margin-bottom:8px">¡Insignia desbloqueada!</div>'
        + '<div style="background:linear-gradient(135deg,#e8b820,#e86820);border-radius:16px;padding:14px 22px;margin-bottom:22px"><div style="font-size:18px;font-weight:700;color:#fff">' + b.emoji + ' ' + esc(b.nombre) + '</div><div style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px">' + esc(b.desc) + '</div></div>'
        + '<button onclick="document.getElementById(\'insignia-modal\').remove()" style="padding:12px 28px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">¡Genial!</button>';
    document.getElementById("app").appendChild(e);
    launchConfetti(); launchConfetti();
}

// Cuenta de reacciones recibidas (para la insignia "Alma del grupo")
async function loadLikesRecibidos() {
    try {
        const ids = state.photos.map(p => p.id).filter(Boolean).slice(0, 200);
        if (!ids.length) { state._likesRecibidos = 0; return; }
        const likeIds = ids.flatMap(id => [id, id + "_fire", id + "_love"]);
        const { count } = await db.from("photo_likes").select("*", { count: "exact", head: true }).in("photo_id", likeIds);
        state._likesRecibidos = count || 0;
    } catch (_) { state._likesRecibidos = state._likesRecibidos || 0; }
}

// Deep-link de los accesos directos de Android (?go=dado|map|feed|perfil)
try {
    const _go = new URLSearchParams(location.search).get("go");
    if (_go) {
        const _map = { dado: "dado", map: "map", mapa: "map", feed: "feed", perfil: "profile", profile: "profile", eventos: "eventos" };
        const _target = _map[_go];
        if (_target) {
            let _tries = 0;
            const _t = setInterval(() => {
                _tries++;
                if (typeof switchScreen === "function" && state.user && document.getElementById("screen-" + _target)) {
                    switchScreen(_target); clearInterval(_t);
                } else if (_tries > 40) clearInterval(_t);
            }, 150);
        }
    }
} catch (_) {}
