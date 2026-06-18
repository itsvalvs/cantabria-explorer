// ═══════════════════════════════════════════════════════════
//  SEGURIDAD + FIXES INTEGRADOS (antes en app.patch.js)
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
  if (filter === 'global' && !isGlobalCache) return void loadGlobalFeed();
  if (filter !== 'global' && isGlobalCache) return void loadFeed(!0);
  if ((filter === 'descubriendo' || filter === 'eventos') && state._feedMode === 'rutas') { return void loadFeed(); }
  applyFeedFilter();
}

// Pestaña "🥾 Rutas" del feed: fotos subidas en municipios que tienen ruta
// (como el feed de Descubriendo), y debajo, la lista de rutas disponibles.
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
  const visible = e => e.user_id === state.user.id || ['amigos', 'publico'].includes(e.visibilidad);
  const ph = (rp.data || []).filter(visible).filter(p => !state.blockedIds?.has(p.user_id));

  // Agrupar por lote de subida
  const groups = {}, order = [];
  const keyOf = p => p.batch_id
    ? 'b:' + p.batch_id
    : 't:' + p.user_id + ':' + normalizeMuni(p.municipio) + ':' + String(p.created_at || '').slice(0, 16);
  ph.forEach(p => { const k = keyOf(p); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
  const posts = order.map(k => {
    const g = groups[k].slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const rep = g[0];
    return { id: 'pb_' + k, _batchKey: k, _batchId: rep.batch_id || null, user_id: rep.user_id, municipio: rep.municipio, visibilidad: rep.visibilidad, created_at: g[g.length - 1].created_at, profiles: profById[rep.user_id] || null, _fotos: g, _foto: rep };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (feedFilter !== 'rutas') return;

  if (!posts.length) {
    fp.innerHTML = '<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6">🥾 Aún no hay fotos de rutas.<br>Sube una foto al conquistar un municipio con ruta y aparecerá aquí.</div>';
    return;
  }
  // Solo fotos, con el mismo formato del feed (carrusel, likes, comentarios)
  await renderFeedPosts(posts, {}, {}, profiles, !1);
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

// Compresión de imágenes antes de subir (3-8MB → 150-400KB)
async function compressImage(file, maxDim = 1600, quality = 0.82) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('No se pudo leer la foto'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload  = () => res(im);
    im.onerror = () => rej(new Error('decode'));
    im.src = dataUrl;
  }).catch(() => null);
  if (!img || !img.width) return { base64: dataUrl, mime: file.type || 'image/jpeg', compressed: false };
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', quality);
  if (out.length >= dataUrl.length) return { base64: dataUrl, mime: file.type || 'image/jpeg', compressed: false };
  return { base64: out, mime: 'image/jpeg', compressed: true };
}

// Genera una miniatura (~480px) a partir de un dataURL ya existente.
// Se usa para subir un "thumb" ligero que alimenta el feed y la galería.
async function dataUrlToThumb(dataUrl, maxDim = 480, quality = 0.7) {
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
  const scale = Math.min(8, Math.max(2, 0.5 / Math.max(b.width / W, b.height / H)));
  const tx = W / 2 - scale * (b.x + b.width / 2);
  const ty = H / 2 - scale * (b.y + b.height / 2);
  d3.select('#map-svg').transition().duration(750)
    .call(state.mapZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}
function resetMapZoom() {
  if (!state.mapZoom) return;
  d3.select('#map-svg').transition().duration(500)
    .call(state.mapZoom.transform, d3.zoomIdentity);
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

async function doLogout() {
    await db.auth.signOut(), state.user = null, state.profile = null, state.visited = {}, state.photos = [], showAuth()
}
async function loadUserData(e) {
    state.user = e;
    try {
    const [t, i, n, o] = await Promise.all([db.from("profiles").select("*").eq("id", e.id).single(), db.from("visits").select("*").eq("user_id", e.id), db.from("photos").select("*").eq("user_id", e.id).order("created_at", {
        ascending: !1
    }), db.from("event_signups").select("event_id").eq("user_id", e.id)]), a = t.data;
    if (state.profile = a, a && (document.getElementById("u-name").textContent = a.username, document.getElementById("av-init").textContent = a.username.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2), a.avatar_url)) {
        const e = document.getElementById("av-ring"),
            t = a.avatar_url;
        e.innerHTML = '<img src="' + t + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>'
    }
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
    } catch (err) {
        console.error("loadUserData no bloqueante:", err);
        state.wishlist = state.wishlist || new Set();
        state.blockedIds = state.blockedIds || new Set();
    }
}

function switchScreen(e) {
    document.querySelectorAll(".screen").forEach(e => e.classList.remove("active")), document.getElementById("screen-" + e).classList.add("active"), updateNavColors(e), "profile" === e && renderProfile(), "feed" === e && (clearFeedBadge(), loadFeed()), "eventos" === e && loadEventos(), "dado" === e && renderMuniList()
}

function searchMuniOnMap(e) {
    const t = document.getElementById("map-search-results");
    if (!e || e.length < 2) return t.style.display = "none", void d3.selectAll(".muni-path").classed("selected", !1);
    const i = [];
    d3.selectAll(".muni-path").each(function() {
        i.push(d3.select(this).attr("data-name"))
    });
    const n = i.filter(t => t && t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(e.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))).slice(0, 8);
    n.length ? (t.style.display = "block", t.innerHTML = n.map(e => {
        const t = state.visited[e];
        return '<div data-muni="' + esc(e) + '" onclick="selectMuniFromSearch(this.dataset.muni)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#fff"><span>' + esc(e) + "</span>" + (t ? '<span style="font-size:10px;color:#22b050;background:rgba(34,176,80,0.15);padding:2px 8px;border-radius:999px">✓ Conquistado</span>' : '<span style="font-size:10px;color:rgba(255,255,255,0.3)">Sin visitar</span>') + "</div>"
    }).join("")) : t.style.display = "none"
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
    document.getElementById("pfill").style.width = Math.round(e / t * 100) + "%", document.getElementById("plabel").textContent = e + " municipio" + (1 !== e ? "s" : "") + " conquistado" + (1 !== e ? "s" : ""), document.getElementById("ppct").textContent = e + " / " + t, checkInsignia(e, t)
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

function renderRutasDD() {
    const dd = document.getElementById("map-areas-dd"); if (!dd) return;
    const rr = state.rutaRatings || {};
    const rutas = getRutas().slice().sort((a, b) => {
        const ma = rr[a.nombre]?.media || 0, mb = rr[b.nombre]?.media || 0;
        return mb - ma || a.nombre.localeCompare(b.nombre, "es");
    });
    dd.innerHTML = rutas.length
        ? '<div style="flex:1 1 100%;font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px">⭐ Mejor valoradas primero</div>'
          + rutas.map((r) => {
            const idx = getRutas().indexOf(r);
            const rt = rr[r.nombre];
            const stars = rt ? ' · ' + rt.media.toFixed(1) + '★ (' + rt.n + ')' : '';
            return '<button class="ruta-dd-btn" data-ridx="' + idx + '" onclick="selectRuta(' + idx + ')" style="padding:5px 11px;border:1px solid rgba(255,255,255,0.12);border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)">🥾 ' + esc(r.nombre) + ' · ' + r.km + 'km' + stars + '</button>';
          }).join("")
        : '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Aún no hay rutas en la base de datos</span>';
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
    db.from("rutas").select("nombre,km,muni,url").order("km", { ascending: !1 })
        .then(({ data, error }) => { if (!error && data && data.length) { state.rutas = data; if (mapFilter === "rutas") renderRutasDD(); } })
        .catch(() => {});
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
        if (a) return console.error("Error guardando visita:", JSON.stringify(a)), alert("Error al guardar la visita: " + a.message), t.textContent = "Marcar como conquistado", void(t.disabled = !1);

        // 2) Guardar las FOTOS (pueden ser varias). La descripción va con la primera.
        const _photos = state.pendingPhotos.length
            ? state.pendingPhotos
            : (state.pendingBase64 ? [{ base64: state.pendingBase64, mime: state.pendingMime }] : []);
        if (_photos.length) {
            const sess = (await db.auth.getSession()).data?.session?.user;
            if (!sess) throw new Error("Sesión expirada — sal y vuelve a entrar");
            const uid = sess.id;
            const batchId = (self.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(16).slice(2)));
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
                    if (upErr) { console.error("Upload error:", upErr); alert("No se pudo subir una foto: " + (upErr.message || JSON.stringify(upErr))); continue; }
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
                    state.photos.unshift(stateP);
                    // Miniatura (aditivo: no rompe si falta la columna thumb_path)
                    try {
                        const td = await dataUrlToThumb(ph.base64, 480, 0.7);
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
        state.visited[e] = !0, document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), showMuniBar(e), closeUploadSheet(), document.getElementById("file-in").value = "", document.getElementById("prev-w").style.display = "none", document.getElementById("uzone").style.display = "block", state.pendingFile = null, state.pendingBase64 = null, state.pendingMime = null, state.pendingPhotos = [], state.feedCache = null;
        const s = document.getElementById("evidencia-desc");
        s && (s.value = ""), document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), updateProgress(), launchConfetti(), console.log("Visita guardada OK:", e, selectedVisibilidad);
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
            }), showMuniBar(e), closeUploadSheet(), updateProgress(), alert("⚠️ Visita guardada pero sin foto. Error: " + t.message)
        } catch (e) {
            alert("Error al guardar: " + t.message)
        } else alert("Error al guardar: " + t.message)
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
    e && (state.eventos = e), renderEventos()
}

function filterEvs(e, t) {
    currentFilter = t, document.querySelectorAll(".ev-tab").forEach(e => e.classList.remove("active")), e.classList.add("active"), renderEventos()
}

function renderEventos() {
    const e = new Date;
    e.setHours(0, 0, 0, 0);
    const t = state.eventos.filter(t => {
            const i = new Date(t.fecha);
            return i.setHours(0, 0, 0, 0), i >= e
        }),
        i = state.eventos.filter(t => {
            const i = new Date(t.fecha);
            return i.setHours(0, 0, 0, 0), i < e && state.inscripciones[t.id]
        }),
        n = "todos" === currentFilter ? t : "inscritos" === currentFilter ? t.filter(e => state.inscripciones[e.id]) : "pasados" === currentFilter ? i : t.filter(e => e.tipo === currentFilter),
        o = document.getElementById("tab-inscritos");
    if (o) {
        const e = t.filter(e => state.inscripciones[e.id]).length;
        o.textContent = e > 0 ? "Mis eventos (" + e + ")" : "Mis eventos"
    }
    document.getElementById("eventos-list").innerHTML = n.map(e => {
        const t = state.inscripciones[e.id],
            i = t ? "#1a7a3e" : "#aa1060",
            n = t ? "Apuntado" : "Apuntarme",
            o = t ? "ti-check" : "ti-plus",
            a = new Date(e.fecha).toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short"
            }),
            s = new Date(e.fecha),
            r = (new Date - s) / 864e5,
            d = (t || r >= 0) ? `<button onclick="event.stopPropagation();openEventFotoSheet(this.dataset.eid, this.dataset.ename)" data-eid="${esc(e.id)}" data-ename="${esc(e.nombre)}"\n          style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(232,184,32,0.2);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0">\n          <i class="ti ti-camera" aria-hidden="true"></i>📸 Fotos\n        </button>` : "";
        return `\n    <div class="ev-card" data-eid="${esc(e.id)}" onclick="openEventModal(this.dataset.eid)" style="cursor:pointer">\n      <div class="ev-img" style="background-color:${e.color_bg||"#1a3a5a"}">\n        <i class="ti ${e.icon||"ti-confetti"}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>\n        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i>${e.dia_semana||""} ${a}</div>\n        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${e.tipo_badge||e.tipo}</div>\n      </div>\n      <div class="ev-body">\n        <div class="ev-name">${esc(e.nombre)}</div>\n        <div class="ev-loc"><i class="ti ti-map-pin" aria-hidden="true"></i>${esc(e.lugar)}</div>\n        <div class="ev-desc">${esc(e.descripcion||"")}</div>\n        \x3c!-- Fotos del evento si ya hay --\x3e\n        <div id="ev-fotos-${e.id}" style="margin:8px 0"></div>\n        <div class="ev-footer">\n          <div class="ev-count" id="ev-count-${e.id}"><strong>...</strong> van</div>\n          <div style="display:flex;gap:6px;align-items:center">\n            ${d}\n            <button onclick="event.stopPropagation();toggleInscripcion('${e.id}')"\n              style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background-color:${i};color:#ffffff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0;">\n              <i class="ti ${o}" aria-hidden="true"></i>${n}\n            </button>\n          </div>\n        </div>\n      </div>\n    </div>`
    }).join(""), n.forEach(e => { loadEventCount(e.id); loadEventPhotos(e.id); })
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
            user_id: state.user.id, municipio: muni, visibilidad: "amigos",
            fecha: now.toISOString().split("T")[0],
            hora: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
        });
        // Inserta una fila de photos por cada foto; si no hay fotos, una fila text_only
        const insertRow = async (extra) => {
            let r = await db.from("photos").insert({ ...baseExtra(), ...extra });
            if (r.error && /rating|batch_id|column|schema cache/i.test(r.error.message || "")) {
                const { rating: _r, batch_id: _b, ...noExtra } = extra;
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
                    await insertRow({ storage_path: path, descripcion: idx === 0 ? desc : null, rating: idx === 0 ? rating : null, batch_id: batchId });
                    // Miniatura
                    try {
                        const td = await dataUrlToThumb(ph.base64, 480, 0.7);
                        if (td) { const tb = await (await fetch(td)).blob(); const tp = path.replace(/\.(jpg|jpeg|png)$/i, "") + "_thumb.jpg"; await db.storage.from("evidencias").upload(tp, tb, { contentType: "image/jpeg", cacheControl: "3600", upsert: !0 }); }
                    } catch (_) {}
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
        return `\n    <div onclick="openMuniModal('${e.nombre.replace(/'/g,"'")}')"\n      style="display:flex;align-items:center;gap:12px;padding:11px 12px;background:#141e2c;border-radius:14px;margin-bottom:6px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);">\n      <div style="width:38px;height:38px;border-radius:10px;background:${i?"#0d2a4a":"#0d2a1e"};display:flex;align-items:center;justify-content:center;flex-shrink:0">\n        <i class="ti ${i?"ti-waves":"ti-mountain"}" aria-hidden="true" style="font-size:18px;color:${i?"#85B7EB":"#5DCAA5"}"></i>\n      </div>\n      <div style="flex:1;min-width:0">\n        <div style="font-size:14px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.nombre} ${o}</div>\n        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px">${e.comarca||""}</div>\n      </div>\n      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">\n        ${a}\n        ${t?'<span style="width:8px;height:8px;border-radius:50%;background:#22b050;display:block"></span>':""}\n        <i class="ti ti-chevron-right" aria-hidden="true" style="font-size:16px;color:rgba(255,255,255,0.2)"></i>\n      </div>\n    </div>`
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
        closeMuniModal(), state.selectedMuni = e, switchScreen("map"), setTimeout(() => {
            document.querySelectorAll(".muni-path").forEach(e => e.classList.remove("selected")), document.querySelectorAll(".muni-path").forEach(t => {
                t.getAttribute("data-name") === e && (t.classList.add("selected"), showMuniBar(e))
            })
        }, 250)
    }, loadMuniFriendEvidence(e), loadRecomendaciones(e);
    document.getElementById("muni-modal").style.display = "flex"
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
            // ── Feed global: fotos públicas de cualquier usuario ──
            const gcols = "id,user_id,municipio,storage_path,thumb_path,descripcion,visibilidad,created_at";
            let qg = db.from("photos").select(gcols)
                .eq("visibilidad", "publico")
                .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE);
            if (fc.cursor) qg = qg.lt("created_at", fc.cursor);
            let rg = await qg;
            if (rg.error && /thumb_path|column|schema cache/i.test(rg.error.message || "")) {
                let qg2 = db.from("photos")
                    .select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at")
                    .eq("visibilidad", "publico")
                    .order("created_at", { ascending: !1 }).limit(FEED_PAGE_SIZE);
                if (fc.cursor) qg2 = qg2.lt("created_at", fc.cursor);
                rg = await qg2;
            }
            const gp = rg.data;
            if (!gp || !gp.length) {
                fc.done = !0;
                if (sent) sent.textContent = fc.visibleVisits.length ? "🏔️ Has llegado al final" : "";
                if (!fc.visibleVisits.length) document.getElementById("feed-posts").innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px">🌍 Aún no hay fotos públicas</div>';
                return;
            }
            fc.cursor = gp[gp.length - 1].created_at;
            if (gp.length < FEED_PAGE_SIZE) fc.done = !0;
            const list = gp.filter(f => !state.blockedIds?.has(f.user_id));
            const uids = [...new Set(list.map(f => f.user_id))];
            let profs = [];
            if (uids.length) {
                const { data: pp } = await db.from("profiles").select("id,username,avatar_url").in("id", uids);
                profs = pp || [];
            }
            const pById = {};
            profs.forEach(p => { pById[p.id] = p; });
            profs.forEach(p => { fc.friendProfiles.find(x => x.id === p.id) || fc.friendProfiles.push(p); });
            const page = list.map(f => ({
                id: "gp_" + f.id, user_id: f.user_id, municipio: f.municipio,
                visibilidad: f.visibilidad, created_at: f.created_at,
                profiles: pById[f.user_id] || null, _foto: f, _fotos: [f]
            }));
            fc.visibleVisits = [...fc.visibleVisits, ...page];
            await renderFeedPosts(page, fc.fotasByMuniUser, fc.fotasByUser, fc.friendProfiles, !0);
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
          <div class="post-time">${fecha}</div>
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
          ${carruselFotos.map(f => `<div class="cslide" style="min-width:100%;flex-shrink:0;scroll-snap-align:center;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
            <img src="" data-foto-id="${esc(f.id)}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block" alt="${muniSafe}" onerror="this.style.display='none'"/>
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
            onkeydown="if(event.key==='Enter')postComment(this.dataset.cid, this.dataset.uid, this.dataset.muni)"/>
          <button class="comment-send" id="comment-cam-${cid}" data-cid="${cid}" onclick="pickCommentFoto(this.dataset.cid)" title="Adjuntar foto" style="background:rgba(255,255,255,0.07)">
            <i class="ti ti-camera" aria-hidden="true"></i>
          </button>
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
    t ? openFriendProfile(t.id, t.username) : alert("Usuario @" + e + " no encontrado")
}
async function deleteComment(e, t) {
    if (state.user && await confirmar("¿Borrar este comentario?", { titulo: "Borrar comentario", ok: "Borrar", peligro: !0 })) { await db.from("photo_comments").delete().eq("id", e).eq("user_id", state.user.id); await loadVisitComments(t, null); }
}
async function postComment(e, t, i) {
    const n = document.getElementById("comment-input-" + e);
    if (!n || !state.user) return;
    const o = n.value.trim();
    const cf = pendingCommentFotos[e];
    if (o || cf) {
        n.value = "", n.disabled = !0;
        try {
            let fotoPath = null;
            if (cf) {
                const blob = await (await fetch(cf.base64)).blob();
                const pth = state.user.id + "/comment_" + Date.now() + ".jpg";
                const { error: upe } = await db.storage.from("evidencias").upload(pth, blob, { contentType: cf.mime });
                if (upe) {
                    console.error("Error subiendo foto de comentario:", upe);
                    alert("No se pudo subir la foto del comentario: " + (upe.message || JSON.stringify(upe)));
                } else {
                    fotoPath = pth;
                }
                delete pendingCommentFotos[e];
                const cam = document.getElementById("comment-cam-" + e);
                if (cam) { cam.style.color = ""; cam.style.background = "rgba(255,255,255,0.07)"; }
            }
            let insErr = (await db.from("photo_comments").insert({
                user_id: state.user.id, photo_id: e, texto: o || null, foto_path: fotoPath
            })).error;
            if (insErr && /foto_path|column|schema cache/i.test(insErr.message || "")) {
                // La columna foto_path aún no existe: guardar al menos el texto
                if (o) await db.from("photo_comments").insert({ user_id: state.user.id, photo_id: e, texto: o });
                alert("La foto en comentarios necesita un ajuste en la base de datos (ejecuta el SQL). De momento se guardó solo el texto.");
            }
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
        } catch (e) {
            toast("Error al comentar: " + e.message, "error")
        } finally {
            n.disabled = !1
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
    n && "23505" !== n.code && (alert("Error al enviar solicitud. Inténtalo de nuevo."), searchUser())
}
async function renderProfile() {
    const e = Object.keys(state.visited).length;
    document.getElementById("sv").textContent = e, document.getElementById("sp").textContent = Math.round(e / state.totalMuni * 100) + "%", document.getElementById("sph").textContent = state.photos.length, renderGallery();
    refreshBadgesAndLevel(false);
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
        alert("No se pudo exportar la foto");
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
    document.getElementById("photo-modal").classList.remove("open")
}
async function editPhoto(e) {
    const t = state.photos.find(t => t.id === e);
    if (!t) return;
    const i = prompt("Editar descripción:", t.desc || "");
    if (null === i) return;
    const {
        error: n
    } = await db.from("photos").update({
        descripcion: i
    }).eq("id", e).eq("user_id", state.user.id);
    n ? alert("Error: " + n.message) : (t.desc = i, state.feedCache = null)
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

        c.append("rect").attr("width", o).attr("height", a).attr("fill", "url(#grad-sea)");

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
            d3.selectAll(".muni-path").classed("selected", !1);
            d3.select(this).classed("selected", !0);
            state.selectedMuni = name;
            showMuniBar(name);
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
            rb.onclick = resetMapZoom;
            mc.appendChild(rb);
        }

        document.getElementById("map-load").style.display = "none", refreshMapVisited(), updateProgress()
    } catch (e) {
        document.getElementById("map-load").innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:12px;padding:20px;text-align:center">Error al cargar el mapa.</p>'
    }
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
        console.error("Avatar error:", e), i.innerHTML = `<span id="av-init">${n}</span><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`, alert("No se pudo subir el avatar: " + e.message)
    }
}), init();
const VAPID_PUBLIC_KEY = "BHd_AlIhjmYZEPc6QKPMas09kOzwvd50A4Vsb2O58Ilh40HLvSLVb9zbB9H6AMgPs9wLsRn0ovnyZP3DuUKOjQ4";
// La clave pública VAPID real se asigna a la constante existente abajo
async function registerPushNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return void alert("Este dispositivo no soporta notificaciones push.\n\nEn iPhone: añade la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.");
    }
    if (!state.user) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
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
async function toggleNotifications() {
    const e = document.getElementById("btn-notif");
    if (e)
        if (state.pushRegistered) e.innerHTML = "🔔 Notificaciones activas";
        else {
            e.textContent = "Activando...", e.disabled = !0;
            try {
                // En la app nativa (Capacitor) el permiso lo gestiona el plugin
                if (!window.nativePushRegister) {
                    if (typeof Notification === "undefined") {
                        // iOS Safari sin instalar: no existe la API
                        return alert("Para recibir notificaciones en iPhone, añade primero la app a la pantalla de inicio:\n\nCompartir → Añadir a pantalla de inicio, y ábrela desde ahí."), e.disabled = !1, void(e.innerHTML = "🔕 Activar notificaciones");
                    }
                    if ("granted" !== await Notification.requestPermission()) return alert("Necesitas dar permiso de notificaciones para activarlas."), e.disabled = !1, void(e.innerHTML = "🔕 Activar notificaciones");
                }
                await registerPushNotifications(), e.innerHTML = state.pushRegistered ? "🔔 Notificaciones activas" : "🔕 Activar notificaciones"
            } catch (t) {
                alert("Error activando notificaciones: " + t.message), e.innerHTML = "🔕 Activar notificaciones"
            }
            e.disabled = !1
        }
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
        alert("No se pudo generar la imagen");
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
        const { error } = await db.from("recomendaciones").insert({
            user_id: state.user.id,
            municipio: recMuni,
            nombre: nombre,
            tipo: recTipo,
            comentario: coment || null,
            link: link || null,
            foto_path: fotoPath
        });
        if (error) throw error;
        closeRecModal();
        loadRecomendaciones(recMuni);
    } catch (err) {
        alert("Error: " + err.message);
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
            ? '<button data-rid="' + esc(rec.id) + '" data-muni="' + esc(muni) + '" onclick="deleteRecomendacion(this.dataset.rid, this.dataset.muni)" style="background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:11px;padding:0;flex-shrink:0"><i class="ti ti-trash" aria-hidden="true"></i></button>'
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
        alert("Error: " + err.message);
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


// ═══ FOTOS EN COMENTARIOS ═══════════════════════════════════
const pendingCommentFotos = {};
function pickCommentFoto(cid) {
    // Input nuevo en cada uso: evita listeners pegados y el bug de iOS
    // al reutilizar el mismo <input> para varios comentarios
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async function() {
        const f = inp.files && inp.files[0];
        if (f) {
            try {
                const { base64, mime } = await compressImage(f, 1280, 0.8);
                pendingCommentFotos[cid] = { base64, mime };
                const cam = document.getElementById("comment-cam-" + cid);
                if (cam) { cam.style.color = "#22b050"; cam.style.background = "rgba(34,176,80,0.2)"; cam.style.borderColor = "rgba(34,176,80,0.4)"; }
            } catch (e) { alert("No se pudo procesar la foto"); }
        }
        inp.remove();
    });
    inp.click();
}

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


// ═══ FICHA DE EVENTO ════════════════════════════════════════
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
    const cartel = ev.imagen_url
        ? '<div style="width:100%;height:210px;overflow:hidden;position:relative"><img src="' + esc(ev.imagen_url) + '" style="width:100%;height:100%;object-fit:cover;display:block" alt="' + esc(ev.nombre) + '"/><div style="position:absolute;inset:0;background:linear-gradient(to top,#141e2c 5%,transparent 60%)"></div></div>'
        : '<div style="width:100%;height:110px;background:linear-gradient(135deg,#2a1f3d,#3d1f33);display:flex;align-items:center;justify-content:center;font-size:42px">🎉</div>';

    ov.innerHTML = '<div style="background:#141e2c;border-radius:22px 22px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;position:relative" onclick="event.stopPropagation()">'
        + '<button onclick="closeEventModal()" style="position:absolute;top:12px;right:12px;z-index:2;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:none;font-size:15px;cursor:pointer">✕</button>'
        + cartel
        + '<div style="padding:16px 18px 26px">'
        + '<div style="font-family:\'Playfair Display\',Georgia,serif;font-size:22px;font-weight:700;color:#fff;line-height:1.25">' + esc(ev.nombre) + '</div>'
        + '<div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.55)">📅 ' + esc(fecha) + (ev.lugar ? ' · 📍 ' + esc(ev.lugar) : '') + '</div>'
        + (ev.descripcion ? '<div style="margin-top:10px;font-size:13px;color:rgba(255,255,255,0.65);line-height:1.55">' + esc(ev.descripcion) + '</div>' : '')
        + contactoHtml + recoHtml
        + '<div id="evm-fotos" style="margin-top:14px"></div>'
        + '<div style="display:flex;gap:8px;margin-top:16px">'
        + '<button data-eid="' + esc(ev.id) + '" data-ename="' + esc(ev.nombre) + '" onclick="closeEventModal();setTimeout(()=>openEventFotoSheet(this.dataset.eid, this.dataset.ename),60)" style="flex:1;padding:13px;background:rgba(232,184,32,0.18);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📸 Subir foto del evento</button>'
        + '<button data-eid="' + esc(ev.id) + '" onclick="toggleInscripcion(this.dataset.eid);closeEventModal()" style="flex:1;padding:13px;background:' + (state.inscripciones[ev.id] ? 'rgba(34,176,80,0.18);color:#5DCAA5;border:1px solid rgba(34,176,80,0.4)' : '#22b050;color:#fff;border:none') + ';border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">' + (state.inscripciones[ev.id] ? '✓ Apuntado' : 'Apuntarme') + '</button>'
        + '</div></div>';
    ov.style.display = "flex";
    loadEventPhotos(ev.id, "evm-fotos");
}
function closeEventModal() {
    const ov = document.getElementById("event-modal");
    if (ov) ov.style.display = "none";
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
        alert("No se pudo actualizar la wishlist. ¿Ejecutaste el SQL de wishlist?");
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
    mostrarTarjetaRuta(r);
}

function mostrarTarjetaRuta(r) {
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
        + link
        + '<button data-rn="' + esc(r.nombre) + '" onclick="openRutaUpload(this.dataset.rn)" style="display:block;width:100%;margin-top:11px;padding:11px;background:#22b050;color:#fff;border:none;border-radius:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">✅ La he hecho — valorar y subir fotos</button>';
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
    // 1) Solicitudes de amistad pendientes (siempre "no leídas" hasta aceptarlas)
    try {
        const { data: reqs } = await db.from("friendships")
            .select("follower_id, profiles:profiles!friendships_follower_id_fkey(username,avatar_url)")
            .eq("following_id", state.user.id).eq("estado", "pendiente");
        (reqs || []).filter(r => !state.blockedIds?.has(r.follower_id)).forEach(r => items.push({
            ts: Date.now(), always: true, icon: "👋",
            text: "<strong>@" + esc(r.profiles?.username || "alguien") + "</strong> quiere ser tu amigo",
            action: "switchScreen('profile')"
        }));
    } catch (e) { console.warn("notif reqs:", e); }

    const myIds = state.photos.map(p => p.id).filter(Boolean).slice(0, 200);
    if (myIds.length) {
        // 2) Comentarios en tus fotos
        try {
            const { data: cs } = await db.from("photo_comments")
                .select("user_id,texto,created_at,photo_id, profiles(username,avatar_url)")
                .in("photo_id", myIds).neq("user_id", state.user.id)
                .order("created_at", { ascending: false }).limit(30);
            (cs || []).filter(c => !state.blockedIds?.has(c.user_id)).forEach(c => items.push({
                ts: +new Date(c.created_at), icon: "💬",
                text: "<strong>@" + esc(c.profiles?.username || "alguien") + "</strong> comentó: " + esc((c.texto || "").slice(0, 50))
            }));
        } catch (e) { console.warn("notif comments:", e); }
        // 3) Likes / reacciones en tus fotos
        try {
            const likeIds = myIds.flatMap(id => [id, id + "_fire", id + "_love"]);
            let r = await db.from("photo_likes").select("user_id,photo_id,created_at")
                .in("photo_id", likeIds).neq("user_id", state.user.id)
                .order("created_at", { ascending: false }).limit(40);
            if (r.error) r = await db.from("photo_likes").select("user_id,photo_id").in("photo_id", likeIds).neq("user_id", state.user.id).limit(40);
            const ls = (r.data || []).filter(l => !state.blockedIds?.has(l.user_id));
            const likers = [...new Set(ls.map(l => l.user_id))];
            const names = {};
            if (likers.length) { const { data: ps } = await db.from("profiles").select("id,username").in("id", likers); (ps || []).forEach(p => names[p.id] = p.username); }
            ls.forEach(l => items.push({
                ts: +new Date(l.created_at || Date.now()),
                icon: String(l.photo_id).endsWith("_fire") ? "🔥" : String(l.photo_id).endsWith("_love") ? "😍" : "❤️",
                text: "<strong>@" + esc(names[l.user_id] || "alguien") + "</strong> reaccionó a tu foto"
            }));
        } catch (e) { console.warn("notif likes:", e); }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 40);
}

async function loadNotifBadge() {
    try {
        const items = await fetchNotifications();
        state._notifs = items;
        const lastSeen = _notifLastSeen();
        const unread = items.filter(i => i.always || i.ts > lastSeen).length;
        document.querySelectorAll(".notif-badge").forEach(b => {
            if (unread > 0) { b.textContent = unread > 9 ? "9+" : unread; b.style.display = "flex"; }
            else b.style.display = "none";
        });
    } catch (e) { console.warn("loadNotifBadge:", e); }
}

async function openNotifs() {
    const ov = document.getElementById("notif-ov");
    const list = document.getElementById("notif-list");
    if (!ov || !list) return;
    ov.style.display = "flex";
    list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);font-size:12px"><div class="spin" style="margin:0 auto 10px"></div>Cargando...</div>';
    const items = state._notifs || await fetchNotifications();
    state._notifs = items;
    const lastSeen = _notifLastSeen();
    if (!items.length) {
        list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.3);font-size:13px"><i class="ti ti-bell-off" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>No tienes notificaciones todavía</div>';
    } else {
        list.innerHTML = items.map(i => {
            const unread = i.always || i.ts > lastSeen;
            return '<div ' + (i.action ? 'onclick="closeNotifs();' + i.action + '" style="cursor:pointer;' : 'style="')
                + 'display:flex;gap:11px;align-items:flex-start;padding:11px 18px;' + (unread ? 'background:rgba(34,114,232,0.06);' : '') + 'border-bottom:1px solid rgba(255,255,255,0.04)">'
                + '<span style="font-size:18px;flex-shrink:0;line-height:1.3">' + i.icon + '</span>'
                + '<div style="flex:1;font-size:13px;color:rgba(255,255,255,0.85);line-height:1.45">' + i.text
                + '<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">' + timeAgo(i.ts) + '</div></div>'
                + (unread ? '<span style="width:7px;height:7px;border-radius:50%;background:#2272e8;flex-shrink:0;margin-top:5px"></span>' : '')
                + '</div>';
        }).join("");
    }
    markNotifsRead();
}
function closeNotifs() { const ov = document.getElementById("notif-ov"); if (ov) ov.style.display = "none"; }
function markNotifsRead() {
    try { localStorage.setItem(_notifSeenKey(), String(Date.now())); } catch (_) {}
    loadNotifBadge(); // tras esto el badge solo refleja solicitudes pendientes
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

async function refreshBadgesAndLevel(celebrate = false) {
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
