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
    alert('El nombre debe tener al menos 3 caracteres y solo letras, números, espacios, guiones y puntos');
    return;
  }
  const { error } = await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  if (error) {
    alert(error.code === '23505' ? 'Ese nombre ya está en uso' : 'No se pudo guardar el nombre');
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
  document.querySelectorAll('.feed-filter-btn').forEach(b => {
    const active = b.dataset.filter === filter;
    b.style.backgroundColor = active ? '#2272e8' : 'rgba(255,255,255,0.08)';
    b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
  });
  applyFeedFilter();
}
function applyFeedFilter() {
  const posts = document.querySelectorAll('.feed-post');
  let visibles = 0;
  posts.forEach(post => {
    const locEl  = post.querySelector('.post-location');
    const muniEl = post.querySelector('.post-muni');
    const muni   = (locEl?.textContent || muniEl?.textContent || '').trim();
    const isEvento = muni.includes('🎉');
    let show = true;
    if (feedFilter === 'descubriendo') show = !isEvento;
    else if (feedFilter === 'eventos')  show = isEvento;
    else if (feedFilter === 'rutas')    show = false;
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
    emptyMsg.textContent = feedFilter === 'rutas' ? '🥾 Las rutas están en camino...'
      : feedFilter === 'eventos' ? '🎉 Aún no hay fotos de eventos' : '';
    emptyMsg.style.display = 'block';
  } else if (emptyMsg) emptyMsg.style.display = 'none';
}

// Tocar una @mención: abrir perfil o enviar solicitud
async function openMentionProfile(username) {
  if (!state?.user || !username) return;
  const { data: profile } = await db.from('profiles')
    .select('id, username, avatar_url').ilike('username', username).single();
  if (!profile) { alert('@' + username + ' no encontrado'); return; }
  if (profile.id === state.user.id) return;
  const { data: fs } = await db.from('friendships').select('estado')
    .or('and(follower_id.eq.' + state.user.id + ',following_id.eq.' + profile.id + '),' +
        'and(follower_id.eq.' + profile.id + ',following_id.eq.' + state.user.id + ')')
    .limit(1);
  const rel = fs?.[0];
  if (rel?.estado === 'aceptado') openFriendProfile(profile.id, profile.username);
  else if (rel?.estado === 'pendiente') alert('Ya tienes una solicitud pendiente con @' + profile.username);
  else if (confirm('¿Enviar solicitud de amistad a @' + profile.username + '?')) {
    await db.from('friendships').insert({ follower_id: state.user.id, following_id: profile.id, estado: 'pendiente' });
    alert('Solicitud enviada a @' + profile.username);
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
        totalMuni: 102,
        coast: [],
        mountain: [],
        rolling: !1,
        selectedMuni: null,
        eventos: [],
        inscripciones: {},
        feedPosts: []
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
    document.getElementById("btn-login").disabled = e, document.getElementById("btn-register").disabled = e
}

function toggleAuthForm() {
    const e = document.getElementById("register-row"),
        t = "flex" === e.style.display;
    e.style.display = t ? "none" : "flex", document.getElementById("auth-toggle-txt").textContent = t ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión", document.getElementById("auth-msg").style.display = "none"
}
async function doLogout() {
    await db.auth.signOut(), state.user = null, state.profile = null, state.visited = {}, state.photos = [], showAuth()
}
async function loadUserData(e) {
    state.user = e;
    const [t, i, n, o] = await Promise.all([db.from("profiles").select("*").eq("id", e.id).single(), db.from("visits").select("municipio").eq("user_id", e.id), db.from("photos").select("*").eq("user_id", e.id).order("created_at", {
        ascending: !1
    }), db.from("event_signups").select("event_id").eq("user_id", e.id)]), a = t.data;
    if (state.profile = a, a && (document.getElementById("u-name").textContent = a.username, document.getElementById("av-init").textContent = a.username.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2), a.avatar_url)) {
        const e = document.getElementById("av-ring"),
            t = a.avatar_url + "?t=" + Date.now();
        e.innerHTML = '<img src="' + t + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>'
    }
    i.data && (i.data.forEach(e => {
        state.visited[e.municipio] = !0
    }), refreshMapVisited());
    if (n.data) {
        state.photos = n.data.map(e => ({
            id: e.id, src: null, muni: e.municipio, date: e.fecha,
            time: e.hora || "", coords: e.coords || "", desc: e.descripcion || "",
            vis: e.visibilidad, path: e.storage_path
        }));
        const paths = [...new Set(n.data.filter(e => e.storage_path && "text_only" !== e.storage_path).map(e => e.storage_path))];
        if (paths.length) {
            const { data: signed } = await db.storage.from("evidencias").createSignedUrls(paths, 3600);
            const byPath = {};
            (signed || []).forEach(s => { if (s.signedUrl) byPath[s.path] = s.signedUrl; });
            state.photos.forEach(p => { if (p.path && byPath[p.path]) p.src = byPath[p.path]; });
        }
    }
    o.data && o.data.forEach(e => {
        state.inscripciones[e.event_id] = !0
    }), updateProgress(), subscribeToFriendActivity()
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
let mapFilter = "todos";

function setMapFilter(e) {
    const dd = document.getElementById("map-areas-dd");
    if (e === "areas") {
        // Toggle del desplegable de comarcas
        if (dd) {
            if (dd.style.display === "none" || !dd.style.display) {
                const comarcas = [...new Set(Object.values(state.municipiosData || {})
                    .map(m => m.comarca).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
                dd.innerHTML = comarcas.length
                    ? comarcas.map(co => '<button class="area-dd-btn" data-area="' + esc(co) + '" onclick="selectArea(this.dataset.area)" style="padding:5px 11px;border:1px solid rgba(255,255,255,0.12);border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)">' + esc(co) + '</button>').join("")
                    : '<span style="font-size:11px;color:rgba(255,255,255,0.35)">Sin comarcas en la BD todavía</span>';
                dd.style.display = "flex";
            } else {
                dd.style.display = "none";
            }
        }
        mapFilter = "areas";
    } else {
        if (dd) dd.style.display = "none";
        mapFilter = e;
    }
    document.querySelectorAll(".map-filter-btn").forEach(t => {
        const isActive = t.dataset.filter === (mapFilter.startsWith("area:") ? "areas" : mapFilter);
        t.style.backgroundColor = isActive ? "#22b050" : "rgba(255,255,255,0.08)";
        t.style.color = isActive ? "#fff" : "rgba(255,255,255,0.5)";
    });
    applyMapFilter();
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
    d3.selectAll(".muni-path").each(function() {
        const e = d3.select(this).attr("data-name"),
            t = state.municipiosData?.[e] || {},
            i = "costa" === t.tipo || isCoast(e),
            n = !!state.visited[e],
            o = t.sellos || [];
        let a = !0;
        if ("costa" === mapFilter) a = i;
        else if ("montaña" === mapFilter) a = !i;
        else if ("pendientes" === mapFilter) a = !n;
        else if ("populares" === mapFilter) a = (state.popularidad?.[e] || 0) > 0;
        else if ("rutas" === mapFilter) a = !!(t.ruta && String(t.ruta).trim());
        else if (mapFilter.startsWith("area:")) a = t.comarca === mapFilter.slice(5);
        else if ("areas" === mapFilter) a = !0;
        else if (SELLOS[mapFilter]) a = o.includes(mapFilter);
        d3.select(this).style("opacity", a ? 1 : .15)
    })
}

function showMuniBar(e) {
    document.getElementById("muni-bar").style.display = "flex", document.getElementById("bar-name").textContent = e;
    const t = state.visited[e];
    const rt = state.municipiosData?.[e]?.ruta;
    document.getElementById("bar-st").textContent = (t ? "✓ Conquistado" : "Sin visitar") + (rt ? " · 🥾 Tiene ruta" : "");
    const i = document.getElementById("btn-ev");
    i.style.backgroundColor = t ? "#1a7a3e" : "#22b050", i.style.color = "#ffffff", i.innerHTML = t ? '<i class="ti ti-camera" aria-hidden="true"></i> Añadir foto' : '<i class="ti ti-camera" aria-hidden="true"></i> Evidencia'
}

function openSheet() {
    if (!state.selectedMuni) return;
    const e = state.selectedMuni,
        t = state.visited[e];
    document.getElementById("sht-title").textContent = e, document.getElementById("sht-sub").textContent = t ? "Ya conquistado — añade foto o descripción" : "Foto, descripción o ambas (todo opcional)";
    const i = document.getElementById("btn-desmarcar");
    i && (i.style.display = t ? "block" : "none");
    const n = document.getElementById("btn-conf");
    n && (n.textContent = t ? "Guardar" : "Marcar como conquistado"), document.querySelectorAll(".vis-btn").forEach(e => e.classList.remove("vis-active")), document.getElementById("vis-amigos").classList.add("vis-active"), clearPhoto();
    const o = document.getElementById("evidencia-desc");
    o && (o.value = ""), document.getElementById("upload-sheet").classList.add("open")
}

function clearPhoto() {
    document.getElementById("prev-w").style.display = "none";
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
    if (pendingEventId) return void await confirmEventPhoto();
    const e = state.selectedMuni;
    if (!e || !state.user) return;
    const t = document.getElementById("btn-conf"),
        i = (document.getElementById("evidencia-desc")?.value || "").trim();
    state.pendingBase64, t.textContent = "Guardando...", t.disabled = !0;
    try {
        let n = null;
        if (state.pendingBase64) {
            const {
                data: e
            } = await db.auth.getSession(), t = e?.session?.user;
            if (!t) throw new Error("Sesión expirada — sal y vuelve a entrar");
            const i = t.id,
                o = state.pendingBase64.split(",")[1],
                a = state.pendingMime || "image/jpeg",
                s = atob(o),
                r = [];
            for (let e = 0; e < s.length; e += 512) {
                const t = s.slice(e, e + 512),
                    i = new Uint8Array(t.length);
                for (let e = 0; e < t.length; e++) i[e] = t.charCodeAt(e);
                r.push(i)
            }
            const d = new Blob(r, {
                    type: a
                }),
                l = a.includes("png") ? "png" : "jpg",
                c = `${i}/${Date.now()}.${l}`;
            console.log("Subiendo evidencia desde base64:", c, a, d.size + "b");
            const {
                data: u,
                error: p
            } = await db.storage.from("evidencias").upload(c, d, {
                contentType: a,
                cacheControl: "3600",
                upsert: !1
            });
            if (p) throw console.error("Upload error:", JSON.stringify(p)), new Error("Error foto: " + (p.message || JSON.stringify(p)));
            console.log("Subida OK:", c), n = c
        }
        const {
            data: o,
            error: a
        } = await db.from("visits").upsert({
            user_id: state.user.id,
            municipio: e,
            visibilidad: selectedVisibilidad,
            coords: state.lastCoords || null,
            fecha: (new Date).toISOString().split("T")[0]
        }).select();
        if (a) return console.error("Error guardando visita:", JSON.stringify(a)), alert("Error al guardar la visita: " + a.message), t.textContent = "Marcar como conquistado", void(t.disabled = !1);
        if (console.log("Visita guardada en Supabase:", o), n) {
            new Date;
            const t = new Date,
                {
                    data: o
                } = await db.from("photos").insert({
                    user_id: state.user.id,
                    municipio: e,
                    storage_path: n,
                    descripcion: i || null,
                    visibilidad: selectedVisibilidad,
                    coords: state.lastCoords || null,
                    fecha: t.toISOString().split("T")[0],
                    hora: t.toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit"
                    })
                }).select().single(),
                a = (await db.storage.from("evidencias").createSignedUrl(n, 3600)).data?.signedUrl || "";
            state.photos.unshift({
                id: o?.id,
                src: a,
                muni: e,
                date: t.toLocaleDateString("es-ES"),
                time: t.toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit"
                }),
                coords: state.lastCoords || "",
                desc: i || "",
                vis: selectedVisibilidad,
                path: n
            })
        } else if (i) {
            const t = new Date;
            await db.from("photos").insert({
                user_id: state.user.id,
                municipio: e,
                storage_path: "text_only",
                descripcion: i,
                visibilidad: selectedVisibilidad,
                coords: state.lastCoords || null,
                fecha: t.toISOString().split("T")[0],
                hora: t.toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit"
                })
            }), state.photos.unshift({
                src: null,
                muni: e,
                date: t.toLocaleDateString("es-ES"),
                time: t.toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit"
                }),
                coords: "",
                desc: i,
                vis: selectedVisibilidad
            })
        }
        state.visited[e] = !0, document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), showMuniBar(e), document.getElementById("upload-sheet").classList.remove("open"), document.getElementById("file-in").value = "", document.getElementById("prev-w").style.display = "none", document.getElementById("uzone").style.display = "block", state.pendingFile = null, state.pendingBase64 = null, state.pendingMime = null, state.feedCache = null;
        const s = document.getElementById("evidencia-desc");
        s && (s.value = ""), document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && t.classList.add("visited")
        }), updateProgress(), launchConfetti(), console.log("Visita guardada OK:", e, selectedVisibilidad), setTimeout(() => {
            confirm("¿Quieres recomendar algún sitio o restaurante en " + e + "?") && openRecModal(e)
        }, 1500)
    } catch (t) {
        if (console.error("confirmVisit error:", t), t.message && t.message.includes("foto")) try {
            await db.from("visits").upsert({
                user_id: state.user.id,
                municipio: e,
                visibilidad: selectedVisibilidad,
                coords: state.lastCoords || null,
                fecha: (new Date).toISOString().split("T")[0]
            }), state.visited[e] = !0, document.querySelectorAll(".muni-path").forEach(t => {
                t.getAttribute("data-name") === e && t.classList.add("visited")
            }), showMuniBar(e), document.getElementById("upload-sheet").classList.remove("open"), updateProgress(), alert("⚠️ Visita guardada pero sin foto. Error: " + t.message)
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
    if (!confirm("¿Seguro que quieres desmarcar " + e + " como conquistado?")) return;
    const t = document.getElementById("btn-desmarcar");
    t.textContent = "Desmarcando...", t.disabled = !0;
    try {
        await db.from("visits").delete().eq("user_id", state.user.id).eq("municipio", e), delete state.visited[e], document.querySelectorAll(".muni-path").forEach(t => {
            t.getAttribute("data-name") === e && (t.classList.remove("visited"), t.classList.remove("selected"))
        }), document.getElementById("muni-bar").style.display = "none", document.getElementById("upload-sheet").classList.remove("open"), updateProgress()
    } catch (e) {
        alert("Error al desmarcar: " + e.message)
    } finally {
        t.textContent = "Desmarcar como conquistado", t.disabled = !1
    }
}

function getCoords() {
    navigator.geolocation && navigator.geolocation.getCurrentPosition(e => {
        state.lastCoords = e.coords.latitude.toFixed(4) + "°N, " + Math.abs(e.coords.longitude).toFixed(4) + "°W"
    })
}

async function handleFileSelected(file) {
    if (!file) return;
    try {
        const { base64, mime, compressed } = await compressImage(file);
        state.pendingBase64 = base64;
        state.pendingMime   = mime;
        state.pendingFile   = null;
        console.log('Foto lista' + (compressed ? ' (comprimida)' : ' (original)') + ', ' + (base64.length / 1024).toFixed(0) + 'KB');
        document.getElementById('prev-img').src = base64;
        const now = new Date();
        document.getElementById('prev-meta').textContent =
            now.toLocaleDateString('es-ES') + ' · ' +
            now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('prev-w').style.display = 'block';
        const uz = document.getElementById('uzone')?.parentElement;
        if (uz) uz.style.display = 'none';
    } catch (err) {
        alert('Error al leer la foto. Inténtalo de nuevo.');
    }
    getCoords();
}
const fileInput = document.getElementById("file-in");
fileInput.addEventListener("input", function(e) {
    const t = e.target.files && e.target.files[0];
    t && handleFileSelected(t)
}), fileInput.addEventListener("change", function(e) {
    const t = e.target.files && e.target.files[0];
    t && handleFileSelected(t)
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
            d = r >= 0 && r < 2 ? `<button onclick="openEventFotoSheet('${e.id}','${e.nombre.replace(/'/g,"\\'")}','${e.source||"local"}')"\n          style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(232,184,32,0.2);color:#e8b820;border:1px solid rgba(232,184,32,0.4);border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0">\n          <i class="ti ti-camera" aria-hidden="true"></i>📸 Fotos\n        </button>` : "";
        return `\n    <div class="ev-card">\n      <div class="ev-img" style="background-color:${e.color_bg||"#1a3a5a"}">\n        <i class="ti ${e.icon||"ti-confetti"}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>\n        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i>${e.dia_semana||""} ${a}</div>\n        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${e.tipo_badge||e.tipo}</div>\n      </div>\n      <div class="ev-body">\n        <div class="ev-name">${esc(e.nombre)}</div>\n        <div class="ev-loc"><i class="ti ti-map-pin" aria-hidden="true"></i>${esc(e.lugar)}</div>\n        <div class="ev-desc">${esc(e.descripcion||"")}</div>\n        \x3c!-- Fotos del evento si ya hay --\x3e\n        <div id="ev-fotos-${e.id}" style="margin:8px 0"></div>\n        <div class="ev-footer">\n          <div class="ev-count" id="ev-count-${e.id}"><strong>...</strong> van</div>\n          <div style="display:flex;gap:6px;align-items:center">\n            ${d}\n            <button onclick="toggleInscripcion('${e.id}')"\n              style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background-color:${i};color:#ffffff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0;">\n              <i class="ti ${o}" aria-hidden="true"></i>${n}\n            </button>\n          </div>\n        </div>\n      </div>\n    </div>`
    }).join(""), n.forEach(e => { loadEventCount(e.id); loadEventPhotos(e.id); })
}
async function loadEventPhotos(eventId) {
    const cont = document.getElementById("ev-fotos-" + eventId);
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

function openEventFotoSheet(e, t) {
    pendingEventId = e, pendingEventName = t, state.selectedMuni = null, document.getElementById("sht-title").textContent = t, document.getElementById("sht-sub").textContent = "Sube una foto de la fiesta 📸", document.getElementById("btn-desmarcar").style.display = "none", document.getElementById("btn-conf").textContent = "Publicar foto", clearPhoto(), document.getElementById("evidencia-desc").value = "", document.getElementById("upload-sheet").classList.add("open")
}
async function confirmEventPhoto() {
    if (!pendingEventId || !state.user) return;
    const e = document.getElementById("btn-conf");
    e.textContent = "Subiendo...", e.disabled = !0;
    try {
        let t = null;
        if (state.pendingBase64 && state.pendingMime) {
            const e = await fetch("data:" + state.pendingMime + ";base64," + state.pendingBase64).then(e => e.blob()),
                i = state.user.id + "/eventos/" + pendingEventId + "_" + Date.now() + ".jpg",
                {
                    error: n
                } = await db.storage.from("evidencias").upload(i, e, {
                    contentType: state.pendingMime
                });
            n || (t = i)
        }
        if (!t) return alert("Añade una foto antes de publicar"), e.textContent = "Publicar foto", void(e.disabled = !1);
        await db.from("event_photos").insert({
            user_id: state.user.id,
            event_id: pendingEventId,
            storage_path: t,
            descripcion: document.getElementById("evidencia-desc").value.trim() || null
        }), await db.from("photos").insert({
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
        }), state.feedCache = null, document.getElementById("upload-sheet").classList.remove("open"), pendingEventId = null, pendingEventName = null, state.pendingFile = state.pendingBase64 = state.pendingMime = null, clearPhoto(), renderEventos()
    } catch (e) {
        alert("Error: " + e.message)
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
    // 1º la BD (editable en Supabase > municipios > tipo); 2º la lista
    const md = state.municipiosData?.[e];
    if (md?.tipo) return md.tipo === 'costa';
    const nl = e.toLowerCase();
    if (nl.includes('corrales de buelna') || nl.includes('los corrales')) return false;
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
        state.selectedMuni = o, switchScreen("map"), setTimeout(() => {
            document.querySelectorAll(".muni-path").forEach(e => e.classList.remove("selected")), document.querySelectorAll(".muni-path").forEach(e => {
                e.getAttribute("data-name") === o && (e.classList.add("selected"), showMuniBar(o))
            })
        }, 250)
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
async function loadFeed(e = !1) {
    if (!state.user) return;
    if (!e && state.feedCache && Date.now() - state.feedCacheTime < 18e4) return void renderFeedFromCache();
    document.getElementById("stories-row").innerHTML = [1, 2, 3].map(() => '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:5px"><div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite"></div><div style="width:36px;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite"></div></div>').join(""), document.getElementById("feed-posts").innerHTML = '<div style="padding:12px">' + [1, 2].map(() => '<div style="background:rgba(255,255,255,0.04);border-radius:18px;height:320px;margin-bottom:14px;animation:pulse 1.5s ease infinite"></div>').join("") + "</div>";
    const {
        data: t
    } = await db.from("friendships").select("follower_id,following_id,follower:profiles!friendships_follower_id_fkey(id,username,avatar_url),following:profiles!friendships_following_id_fkey(id,username,avatar_url)").or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`).eq("estado", "aceptado"), i = new Set, n = (t || []).map(e => e.follower_id === state.user.id ? e.following : e.follower).filter(e => !(!e || i.has(e.id)) && (i.add(e.id), !0)), o = n.map(e => e.id);
    if (document.getElementById("stories-row").innerHTML = "", !o.length) return void(document.getElementById("feed-posts").innerHTML = '<div style="text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7"><i class="ti ti-users" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>Aún no tienes amigos añadidos.<br>¡Busca a alguien por su nombre de usuario!</div>');
    const a = [...new Set([...o, state.user.id])],
        [{
            data: s
        }, {
            data: r
        }, {
            data: d
        }] = await Promise.all([db.from("photos").select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at").in("user_id", o).in("visibilidad", ["amigos", "publico"]).order("created_at", {
            ascending: !1
        }).limit(30), db.from("photos").select("id,user_id,municipio,storage_path,descripcion,visibilidad,created_at").eq("user_id", state.user.id).order("created_at", {
            ascending: !1
        }).limit(30), db.from("visits").select("id,user_id,municipio,visibilidad,created_at,profiles(id,username,avatar_url)").in("user_id", a).order("created_at", {
            ascending: !1
        }).limit(25)]),
        l = [...s || [], ...r || []],
        c = {},
        u = {};
    l.forEach(e => {
        c[e.user_id] || (c[e.user_id] = []), c[e.user_id].push(e);
        const t = e.user_id + "|" + normalizeMuni(e.municipio);
        u[t] || (u[t] = []), u[t].push(e)
    });
    let p = (d || []).filter(e => e.user_id === state.user.id || ["amigos", "publico"].includes(e.visibilidad));

    // Fotos de eventos (🎉) → posts sintéticos del feed
    const profById = {};
    n.forEach(pr => { profById[pr.id] = pr; });
    if (state.profile) profById[state.user.id] = { id: state.user.id, username: state.profile.username, avatar_url: state.profile.avatar_url };
    const eventPosts = l.filter(f => (f.municipio || "").startsWith("🎉")).map(f => ({
        id: "ep_" + f.id,
        user_id: f.user_id,
        municipio: f.municipio,
        visibilidad: f.visibilidad,
        created_at: f.created_at,
        profiles: profById[f.user_id] || null
    }));
    p = [...p, ...eventPosts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    state.feedCache = {
        visibleVisits: p,
        fotasByMuniUser: u,
        fotasByUser: c,
        friendProfiles: n
    }, state.feedCacheTime = Date.now(), renderFeedPosts(p, u, c, n)
}

function renderFeedFromCache() {
    const {
        visibleVisits: e,
        fotasByMuniUser: t,
        fotasByUser: i,
        friendProfiles: n
    } = state.feedCache;
    document.getElementById("stories-row").innerHTML = "", renderFeedPosts(e, t, i, n)
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
async function renderFeedPosts(visits, fotasByMuniUser, fotasByUser, friendProfiles) {
    if (!visits.length) {
        document.getElementById("feed-posts").innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7"><i class="ti ti-map-2" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>Tus amigos aún no han conquistado municipios.</div>';
        return;
    }

    const pickFoto = v => {
        const fotos = fotasByMuniUser[v.user_id + "|" + normalizeMuni(v.municipio)]
                   || fotasByMuniUser[v.user_id + "_" + normalizeMuni(v.municipio)] || [];
        return fotos.find(f => normalizeMuni(f.municipio) === normalizeMuni(v.municipio)) || fotos[0] || null;
    };

    document.getElementById("feed-posts").innerHTML = visits.map((v, i) => {
        const coast    = isCoast(v.municipio);
        const muniSafe = esc(v.municipio);
        const username = v.profiles?.username || "Usuario";
        const userSafe = esc(username);
        const userId   = v.profiles?.id || v.user_id;
        const color    = STORY_COLORS[i % STORY_COLORS.length];
        const fp       = userId === state.user?.id ? state.profile : (friendProfiles || []).find(f => f.id === userId);
        const avatarUrl  = fp?.avatar_url || v.profiles?.avatar_url;
        const avatarHtml = avatarUrl
            ? `<img src="${esc(avatarUrl)}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${userSafe}"/>`
            : getInitials(username);
        const foto  = pickFoto(v);
        const hasImg = foto && foto.storage_path && foto.storage_path !== "text_only";
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
        <div class="post-badge ${coast ? "pb-coast" : "pb-mount"}">
          <i class="ti ${coast ? "ti-waves" : "ti-mountain"}" aria-hidden="true" style="font-size:10px"></i>
          ${coast ? "Costa" : "Montaña"}
        </div>
      </div>
      <div class="post-img" style="background:${coast ? "#0d2535" : "#0d2a1e"}">
        ${hasImg
          ? `<img src="" data-foto-id="${esc(foto.id)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:none" alt="${muniSafe}" onerror="this.style.display='none'"/>
             <div class="post-img-placeholder" style="display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)">
               <div class="spin" style="width:20px;height:20px;border-width:2px"></div>
             </div>`
          : `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)">
               <i class="ti ${coast ? "ti-waves" : "ti-mountain"}" aria-hidden="true" style="font-size:38px"></i>
               <span style="font-size:11px">Sin foto de evidencia</span>
             </div>`}
        <div class="post-location"><i class="ti ti-map-pin" aria-hidden="true"></i>${muniSafe}</div>
      </div>
      <div class="post-body">
        <div class="post-muni">${muniSafe}</div>
        ${foto?.descripcion ? `<div class="post-desc">${renderMentions(esc(foto.descripcion))}</div>` : ""}
        <div class="post-actions">
          ${foto ? `
          <div style="display:flex;gap:6px;align-items:center">
            <button class="post-action" data-fid="${esc(foto.id)}" onclick="toggleLike(this, this.dataset.fid)" data-liked="false">
              <i class="ti ti-heart" aria-hidden="true"></i><span id="likes-${esc(foto.id)}">0</span>
            </button>
            <button class="post-action" data-fid="${esc(foto.id)}" onclick="toggleReaction(this, this.dataset.fid, '🔥')" data-reacted="false" id="react-fire-${esc(foto.id)}" style="font-size:14px">🔥<span id="react-fire-count-${esc(foto.id)}" style="font-size:11px;margin-left:2px">0</span></button>
            <button class="post-action" data-fid="${esc(foto.id)}" onclick="toggleReaction(this, this.dataset.fid, '😍')" data-reacted="false" id="react-love-${esc(foto.id)}" style="font-size:14px">😍<span id="react-love-count-${esc(foto.id)}" style="font-size:11px;margin-left:2px">0</span></button>
          </div>` : "<div></div>"}
          <button class="post-action" style="margin-left:auto" onclick="openMuniModal(this.dataset.muni)" data-muni="${muniSafe}">
            <i class="ti ti-info-circle" aria-hidden="true"></i><span style="font-size:11px">Ver ficha</span>
          </button>
          <button class="post-action" onclick="goToMuniOnMap(this.dataset.muni)" data-muni="${muniSafe}">
            <i class="ti ti-map-pin" aria-hidden="true"></i><span style="font-size:11px">Mapa</span>
          </button>
          ${v.user_id === state.user?.id ? `
          <button class="post-action" data-vid="${esc(v.id)}" data-fid="${esc(foto ? foto.id : "")}" data-path="${esc(foto && (foto.path || foto.storage_path) || "")}" onclick="deleteFeedPost(this.dataset.vid, this.dataset.fid, this.dataset.path)" style="color:rgba(232,40,40,0.5)">
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
          <button class="comment-send" data-cid="${cid}" data-uid="${esc(v.user_id)}" data-muni="${muniSafe}"
            onclick="postComment(this.dataset.cid, this.dataset.uid, this.dataset.muni)">
            <i class="ti ti-send" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>`;
    }).join("");

    applyFeedFilter();

    // ── Carga EN LOTE: 3 llamadas totales (antes 3 por post) ──
    const fotosConStorage = [];
    const commentIds = [];
    visits.forEach(v => {
        const foto = pickFoto(v);
        if (foto && foto.storage_path && foto.storage_path !== "text_only") fotosConStorage.push(foto);
        commentIds.push(foto?.id || v.id);
    });
    const fotoIds = [...new Set(fotosConStorage.map(f => f.id))];
    const paths   = [...new Set(fotosConStorage.map(f => f.storage_path))];
    const likeIds = fotoIds.flatMap(id => [id, id + "_fire", id + "_love"]);

    const [signedRes, likesRes, commentsRes] = await Promise.all([
        paths.length ? db.storage.from("evidencias").createSignedUrls(paths, 3600) : Promise.resolve({ data: [] }),
        likeIds.length ? db.from("photo_likes").select("photo_id,user_id").in("photo_id", likeIds) : Promise.resolve({ data: [] }),
        commentIds.length ? db.from("photo_comments")
            .select("id,photo_id,user_id,texto,created_at, profiles(username,avatar_url)")
            .in("photo_id", commentIds).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
    ]);

    // 1) Imágenes
    const urlByPath = {};
    (signedRes.data || []).forEach(s => { if (s.signedUrl) urlByPath[s.path] = s.signedUrl; });
    fotosConStorage.forEach(f => {
        const url = urlByPath[f.storage_path];
        if (!url) return;
        const img = document.querySelector('img[data-foto-id="' + f.id + '"]');
        if (img) {
            img.src = url;
            img.style.display = "block";
            img.closest(".post-img")?.querySelector(".post-img-placeholder")?.remove();
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
    commentIds.forEach(cid => {
        const cont = document.getElementById("comments-" + cid);
        if (cont) renderComments(cont, byPhoto[cid] || [], cid);
    });
}

async function loadVisitComments(e, t) {
    const id = e || t;
    const cont = document.getElementById("comments-" + id);
    if (!cont) return;
    const { data } = await db.from("photo_comments")
        .select("id,photo_id,user_id,texto,created_at, profiles(username, avatar_url)")
        .eq("photo_id", id).order("created_at", { ascending: true });
    renderComments(cont, data || [], id);
}

function renderComments(container, comments, id) {
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
        return '<div class="comment"><div class="c-av">' + av + '</div><div class="c-text"><strong>' + esc(u) + '</strong> ' + renderMentions(esc(c.texto)) + '</div>' + del + '</div>';
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
    state.user && confirm("¿Borrar este comentario?") && (await db.from("photo_comments").delete().eq("id", e).eq("user_id", state.user.id), await loadVisitComments(t, null))
}
async function postComment(e, t, i) {
    const n = document.getElementById("comment-input-" + e);
    if (!n || !state.user) return;
    const o = n.value.trim();
    if (o) {
        n.value = "", n.disabled = !0;
        try {
            await db.from("photo_comments").insert({
                user_id: state.user.id,
                photo_id: e,
                texto: o
            }), await loadVisitComments(e);
            const t = o.match(/@(\w+)/g);
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
            alert("Error al comentar: " + e.message)
        } finally {
            n.disabled = !1
        }
    }
}
async function deleteFeedPost(e, t, i) {
    if (!state.user || !confirm("¿Borrar esta publicación?")) return;
    // Post de evento (sintético): borrar foto del feed + event_photos
    if (String(e).startsWith("ep_")) {
        try {
            if (i && "text_only" !== i && "" !== i) {
                await db.storage.from("evidencias").remove([i]);
                await db.from("event_photos").delete().eq("storage_path", i).eq("user_id", state.user.id);
            }
            if (t) await db.from("photos").delete().eq("id", t).eq("user_id", state.user.id);
            state.feedCache = null;
            loadFeed(!0);
        } catch (err) { alert("Error al borrar: " + err.message); }
        return;
    }
    try {
        i && "text_only" !== i && "" !== i && await db.storage.from("evidencias").remove([i]), t && await db.from("photos").delete().eq("id", t).eq("user_id", state.user.id), await db.from("visits").delete().eq("id", e).eq("user_id", state.user.id), delete state.visited[state.feedCache?.visibleVisits?.find(t => t.id === e)?.municipio], state.feedCache = null, state.photos = state.photos.filter(e => e.id !== t), updateProgress(), loadFeed(!0)
    } catch (e) {
        alert("Error al borrar: " + e.message)
    }
}

function goToMuniOnMap(e) {
    state.selectedMuni = e, switchScreen("map"), setTimeout(() => highlightMuniOnMap(e), 300)
}
async function openFriendProfile(e, t) {
    const i = document.getElementById("friend-profile-modal");
    if (!i) return;
    document.getElementById("fp-username").textContent = t, document.getElementById("fp-avatar").textContent = t.split(" ").map(e => e[0]).join("").toUpperCase().substring(0, 2), document.getElementById("fp-visits-count").textContent = "...", document.getElementById("fp-photos-count").textContent = "...", document.getElementById("fp-gallery").innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Cargando...</div>', document.getElementById("fp-map").innerHTML = "", document.getElementById("fp-minimap").innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:11px;text-align:center;padding:20px 0">Cargando mapa...</div>', i.style.display = "flex";
    const [n, o, a] = await Promise.all([db.from("profiles").select("username, avatar_url").eq("id", e).single(), db.from("visits").select("municipio, fecha, created_at").eq("user_id", e).in("visibilidad", ["amigos", "publico"]).order("created_at", {
        ascending: !1
    }), db.from("photos").select("*").eq("user_id", e).in("visibilidad", ["amigos", "publico"]).order("created_at", {
        ascending: !1
    }).limit(9)]), s = n.data, r = o.data || [], d = a.data || [], l = new Set(r.map(e => e.municipio));
    s?.avatar_url && (document.getElementById("fp-avatar").innerHTML = '<img src="' + esc(s.avatar_url) + "?t=" + Date.now() + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + esc(t) + '"/>'), document.getElementById("fp-visits-count").textContent = r.length, document.getElementById("fp-photos-count").textContent = d.length, renderFriendMiniMap(l);
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
        const l = Math.round(e.size / 102 * 100);
        t.insertAdjacentHTML("afterbegin", '<div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px">' + e.size + " / 102 municipios · " + l + "%</div>")
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
    const i = "true" === e.getAttribute("data-liked");
    e.setAttribute("data-liked", String(!i)), e.classList.toggle("liked", !i);
    const n = e.querySelector("span");
    i ? (await db.from("photo_likes").delete().eq("user_id", state.user.id).eq("photo_id", t), n.textContent = parseInt(n.textContent) - 1) : (await db.from("photo_likes").insert({
        user_id: state.user.id,
        photo_id: t
    }), n.textContent = parseInt(n.textContent) + 1)
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
    document.getElementById("sv").textContent = e, document.getElementById("sp").textContent = Math.round(e / state.totalMuni * 100) + "%", document.getElementById("sph").textContent = state.photos.length, renderGallery(), await Promise.all([loadSolicitudes(), loadFriendCount()])
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
    confirm("Rechazar la solicitud de " + t + "?") && (await db.from("friendships").delete().eq("follower_id", e).eq("following_id", state.user.id), await loadSolicitudes())
}
async function cancelarSolicitud(e, t) {
    confirm("Cancelar la solicitud enviada a " + t + "?") && (await db.from("friendships").delete().eq("follower_id", state.user.id).eq("following_id", e), await loadSolicitudes())
}

function renderGallery() {
    const e = document.getElementById("gallery"),
        t = document.getElementById("g-empty");
    if (!state.photos.length) return e.innerHTML = "", void(t.style.display = "block");
    t.style.display = "none";
    const i = state.photos.filter(e => e.src && "" !== e.src);
    if (document.getElementById("sph").textContent = i.length, !i.length) return e.innerHTML = "", void(document.getElementById("g-empty").style.display = "block");
    document.getElementById("g-empty").style.display = "none", e.innerHTML = i.map((e, t) => `\n    <div class="gi" onclick="openPMbyId('${e.id||t}')">\n      <img src="${e.src}" alt="${esc(e.muni)}" loading="lazy"\n        onerror="this.parentElement.style.display='none'"/>\n      <div class="gi-hov">\n        <div class="gm">\n          <div style="font-weight:500">${esc(e.muni.length>14?e.muni.substring(0,12)+"…":e.muni)}</div>\n          <div>${e.date}</div>\n        </div>\n      </div>\n    </div>`).join("")
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
    const t = document.getElementById("pm-img");
    e.src ? (t.src = e.src + "?nocache=" + Date.now(), t.style.display = "block") : (t.src = "", t.style.display = "none"), document.getElementById("pm-meta").innerHTML = `\n    <div class="mrow"><i class="ti ti-map-pin" aria-hidden="true"></i><span>Municipio</span><strong>${e.muni}</strong></div>\n    <div class="mrow"><i class="ti ti-calendar" aria-hidden="true"></i><span>Fecha</span><strong>${e.date}</strong></div>\n    <div class="mrow"><i class="ti ti-clock" aria-hidden="true"></i><span>Hora</span><strong>${e.time||"—"}</strong></div>\n    <div class="mrow"><i class="ti ti-location" aria-hidden="true"></i><span>Coordenadas</span><strong>${e.coords||"—"}</strong></div>\n    ${e.desc?`<div class="mrow"><i class="ti ti-message-circle" aria-hidden="true"></i><span>Descripción</span><strong style="white-space:pre-wrap">${e.desc}</strong></div>`:""}\n    <div class="mrow" style="padding-bottom:4px;display:flex;gap:8px">\n      <button onclick="editPhoto('${e.id}')" style="flex:1;padding:10px;background:rgba(34,114,232,0.15);color:#85B7EB;border:1px solid rgba(34,114,232,0.3);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px">\n        <i class="ti ti-pencil" aria-hidden="true"></i> Editar\n      </button>\n      <button onclick="deletePhoto(${i})" style="flex:1;padding:10px;background:rgba(232,40,40,0.15);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px">\n        <i class="ti ti-trash" aria-hidden="true"></i> Borrar\n      </button>\n    </div>\n    <div class="mrow"><i class="ti ti-eye" aria-hidden="true"></i><span>Visibilidad</span>\n      <strong style="display:flex;gap:6px;margin-top:4px">\n        ${["privado","amigos","publico"].map(t=>`\n          <button onclick="changePhotoVis('${e.id}','${t}',this)"\n            style="padding:4px 10px;border:none;border-radius:999px;font-size:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;\n              background-color:${e.vis===t?"#2272e8":"rgba(255,255,255,0.1)"};\n              color:${e.vis===t?"#fff":"rgba(255,255,255,0.6)"};">\n            ${t}\n          </button>`).join("")}\n      </strong>\n    </div>`
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
    if (t && state.user && confirm("¿Borrar esta foto de " + t.muni + "? Esta acción no se puede deshacer.")) try {
        t.path && "text_only" !== t.path && await db.storage.from("evidencias").remove([t.path]), t.id && await db.from("photos").delete().eq("id", t.id).eq("user_id", state.user.id), state.photos.splice(e, 1), state.feedCache = null, closePM(), renderGallery();
        Object.keys(state.visited).length;
        document.getElementById("sph").textContent = state.photos.length
    } catch (e) {
        alert("Error al borrar: " + e.message)
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

        // Comunidades vecinas como tierra (Asturias, León, Palencia,
        // Burgos, Bizkaia), debajo de Cantabria y sin interacción
        const provOf = id => String(id).padStart(5, "0").slice(0, 2);
        const NEIGHBORS = ["33", "24", "34", "09", "48"];
        const vecinos = i.objects.municipalities.geometries.filter(gm => NEIGHBORS.includes(provOf(gm.id)));
        if (vecinos.length) {
            // Tierra unificada
            g.append("path")
                .datum(topojson.merge(i, vecinos))
                .attr("d", l).attr("fill", "#41504a")
                .attr("stroke", "none").attr("pointer-events", "none");
            // Límites entre provincias vecinas (sutil)
            g.append("path")
                .datum(topojson.mesh(i, { type: "GeometryCollection", geometries: vecinos }, (a, b) => a !== b && provOf(a.id) !== provOf(b.id)))
                .attr("d", l).attr("fill", "none")
                .attr("stroke", "rgba(15,25,35,0.55)").attr("stroke-width", "0.7px")
                .attr("pointer-events", "none").attr("class", "map-mesh-prov");
            // Costa/borde exterior de la tierra vecina
            g.append("path")
                .datum(topojson.mesh(i, { type: "GeometryCollection", geometries: vecinos }, (a, b) => a === b))
                .attr("d", l).attr("fill", "none")
                .attr("stroke", "rgba(15,25,35,0.4)").attr("stroke-width", "0.5px")
                .attr("pointer-events", "none");
        }

        g.selectAll("path.muni-path").data(n.features).join("path").attr("class", e => {
            const t = e.properties.name || e.properties.NAME || e.properties.NAMEUNIT || "Mun-" + e.id;
            let cls = "muni-path";
            if (state.visited[t]) cls += " visited";
            else if (isCoast(t) || (state.municipiosData?.[t]?.tipo === "costa")) cls += " is-coast";
            return cls;
        }).attr("d", l).attr("data-name", e => {
            const t = e.properties.name || e.properties.NAME || e.properties.NAMEUNIT || "Mun-" + e.id;
            return "Comunidad de Campoo y Cabuérniga" === t ? "Mancomunidad de Campoo-Cabuérniga" : t;
        }).style("stroke", "none").on("click", function() {
            const name = d3.select(this).attr("data-name");
            d3.selectAll(".muni-path").classed("selected", !1);
            d3.select(this).classed("selected", !0).raise();
            state.selectedMuni = name;
            showMuniBar(name);
        });

        const u = e => String(e).startsWith("39") || 53072 === e || "53072" === e;
        g.append("path").datum(topojson.mesh(i, i.objects.municipalities, (e, t) => e !== t && u(e.id) && u(t.id)))
            .attr("d", l).attr("fill", "none").attr("stroke", "#0c1622")
            .attr("stroke-width", "0.4px").attr("pointer-events", "none").attr("class", "map-mesh-inner");
        g.append("path").datum(topojson.mesh(i, i.objects.municipalities, (e, t) => e === t && u(e.id)))
            .attr("d", l).attr("fill", "none").attr("stroke", "#0c1622")
            .attr("stroke-width", "1px").attr("pointer-events", "none").attr("class", "map-mesh-outer");

        // Zoom y paneo (pellizcar / arrastrar)
        state.mapZoom = d3.zoom()
            .scaleExtent([1, 8])
            .translateExtent([[0, 0], [o, a]])
            .on("zoom", ev => {
                g.attr("transform", ev.transform);
                const k = ev.transform.k;
                g.select(".map-mesh-inner").style("stroke-width", (0.4 / k) + "px");
                g.select(".map-mesh-outer").style("stroke-width", (1 / k) + "px");
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
                await Promise.all(e.map(e => caches.delete(e)))
            }
            localStorage.setItem("ce_version", e)
        } else localStorage.setItem("ce_version", e)
    } catch (e) {
        console.log("checkForUpdates error:", e)
    }
}

function registerSW() {}
async function init() {
    buildNavs(), renderDice(6), updateClock(), setInterval(updateClock, 3e4);
    const e = setTimeout(() => {
            document.getElementById("splash")?.remove(), showAuth()
        }, 5e3),
        {
            data: {
                session: t
            }
        } = await db.auth.getSession();
    clearTimeout(e), t?.user ? (await loadUserData(t.user), showApp(), loadMap(), loadEventos()) : showAuth(), db.auth.onAuthStateChange(async (e, t) => {
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
        const d = r + "?t=" + Date.now(),
            {
                error: l
            } = await db.from("profiles").update({
                avatar_url: r
            }).eq("id", state.user.id);
        if (l) throw l;
        state.profile && (state.profile.avatar_url = r), i.innerHTML = `<img src="${d}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`
    } catch (e) {
        console.error("Avatar error:", e), i.innerHTML = `<span id="av-init">${n}</span><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`, alert("No se pudo subir el avatar: " + e.message)
    }
}), init();
const VAPID_PUBLIC_KEY = "";
async function registerPushNotifications() {
    if ("serviceWorker" in navigator && "PushManager" in window) {
        if (state.user) try {
            return "granted" !== await Notification.requestPermission() ? void console.log("Permiso de notificaciones denegado") : void console.log("VAPID key no configurada todavía")
        } catch (e) {
            console.error("Error registrando push:", e)
        }
    } else console.log("Push no soportado en este dispositivo")
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
                if ("granted" !== await Notification.requestPermission()) return alert("Necesitas dar permiso de notificaciones. Ve a Ajustes → Safari → Notificaciones y actívalas para esta web."), e.disabled = !1, void(e.innerHTML = "🔕 Activar notificaciones");
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
    e === t && showInsignia()
}

function showInsignia() {
    if (document.getElementById("insignia-modal")) return;
    const e = document.createElement("div");
    e.id = "insignia-modal", e.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center", e.innerHTML = '<div style="font-size:72px;margin-bottom:16px">🏔️</div><div style="font-family:Playfair Display,serif;font-size:28px;font-weight:700;color:#fff;margin-bottom:8px">¡El Cántabru!</div><div style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;margin-bottom:24px">Has pisado los 102 municipios de Cantabria.<br>Eres oficialmente un Cántabru de pura cepa.</div><div style="background:linear-gradient(135deg,#e8b820,#e86820);border-radius:16px;padding:16px 24px;margin-bottom:24px"><div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Insignia desbloqueada</div><div style="font-size:18px;font-weight:700;color:#fff">🏆 El Cántabru</div></div><button onclick="document.getElementById(\'insignia-modal\').remove()" style="padding:12px 28px;background:#22b050;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">¡A por más aventuras!</button>', document.getElementById("app").appendChild(e), launchConfetti(), launchConfetti(), launchConfetti()
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
    const e = document.getElementById("btn-export-map");
    e && (e.textContent = "Generando...", e.disabled = !0);
    try {
        const e = document.getElementById("map-svg").getAttribute("viewBox").split(" "),
            t = parseInt(e[2]),
            i = parseInt(e[3]),
            n = 2,
            o = 40,
            a = 80,
            s = 40,
            r = document.createElement("canvas");
        r.width = (t + 2 * o) * n, r.height = (i + a + s) * n;
        const d = r.getContext("2d");
        d.scale(n, n), d.fillStyle = "#0f1923", d.fillRect(0, 0, r.width, r.height);
        const l = await d3.json("https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json"),
            c = {
                type: "FeatureCollection",
                features: topojson.feature(l, l.objects.municipalities).features.filter(e => String(e.id || "").startsWith("39") || 53072 === e.id || "53072" === e.id)
            },
            u = d3.geoMercator().fitExtent([
                [o + 12, a + 12],
                [t + o - 12, i + a - 12]
            ], c),
            p = d3.geoPath(u, d);
        c.features.forEach(e => {
            const t = e.properties.name || e.properties.NAME || e.properties.NAMEUNIT || "";
            d.beginPath(), p(e), d.fillStyle = state.visited[t] ? "#22b050" : "#3d5268", d.fill()
        }), d.beginPath(), p(topojson.mesh(l, l.objects.municipalities, (e, t) => e !== t && String(e.id).startsWith("39") && String(t.id).startsWith("39"))), d.strokeStyle = "#0f1923", d.lineWidth = .4, d.stroke(), d.fillStyle = "#ffffff", d.font = "bold 22px serif", d.textAlign = "center", d.fillText("Ya lo pisé", (t + 2 * o) / 2, 30);
        const m = Object.keys(state.visited).length;
        d.font = "13px sans-serif", d.fillStyle = "rgba(255,255,255,0.5)", d.fillText(m + " / 102 municipios conquistados · " + Math.round(m / 102 * 100) + "%", (t + 2 * o) / 2, 52), d.font = "11px sans-serif", d.fillStyle = "rgba(255,255,255,0.25)", d.fillText("Ya lo pisé · Cantabria", (t + 2 * o) / 2, i + a + s - 10), r.toBlob(async e => {
            const t = new File([e], "yalopisé-" + (new Date).toISOString().slice(0, 10) + ".png", {
                type: "image/png"
            });
            if (navigator.share && navigator.canShare({
                    files: [t]
                })) await navigator.share({
                files: [t],
                title: "Ya lo pisé"
            });
            else {
                const i = URL.createObjectURL(e),
                    n = document.createElement("a");
                n.download = t.name, n.href = i, n.click(), URL.revokeObjectURL(i)
            }
        }, "image/png")
    } catch (e) {
        alert("Error: " + e.message)
    } finally {
        e && (e.textContent = "📸 Exportar mapa", e.disabled = !1)
    }
}
let recTipo = "sitio",
    recMuni = "";

let recFotoBase64 = null, recFotoMime = null;
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
    if (!nombre) return void alert("Ponle un nombre al sitio");
    if (!state.user) return;
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    if (link && link.length > 300) return void alert("El enlace es demasiado largo");
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
    if (!texto && !foto) return void alert("Añade un comentario o una foto");
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
    if (!confirm("¿Borrar tu respuesta?")) return;
    await db.from("recomendacion_replies").delete().eq("id", rpid).eq("user_id", state.user.id);
    loadRecomendaciones(muni);
}

async function deleteRecomendacion(e, t) {
    confirm("¿Borrar esta recomendación?") && (await db.from("recomendaciones").delete().eq("id", e).eq("user_id", state.user.id), loadRecomendaciones(t))
}

// ═══ AUTOCOMPLETADO DE @MENCIONES ═══════════════════════════
// Al escribir @ en un campo de comentario, sugiere tus amigos.
let _friendsCache = null;
async function getFriendsCache() {
    if (_friendsCache) return _friendsCache;
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
window.addEventListener("scroll", hideMentionDD, true);
