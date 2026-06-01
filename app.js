// ══════════════════════════════════════════════════════════════
//  CANTABRIA EXPLORER — app.js
//  Conectado a Supabase
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://sdsdbfjmpjbrcgrbyvkm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkc2RiZmptcGpicmNncmJ5dmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzQxMzksImV4cCI6MjA5MzkxMDEzOX0.EgNnrghpj9XbFUt0N-NlTIhH4GxcHOaen33RXAYMNcA';

// ── CLIENTE SUPABASE ──────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── ESTADO GLOBAL ─────────────────────────────────────────────
const state = {
  user:          null,
  profile:       null,
  visited:       {},       // { municipio: true }
  photos:        [],       // fotos propias
  totalMuni:     102,
  coast:         [],
  mountain:      [],
  rolling:       false,
  selectedMuni:  null,
  eventos:       [],
  inscripciones: {},       // { event_id: true }
  feedPosts:     [],
};

// ── COLORES NAV ───────────────────────────────────────────────
const NAV_ITEMS = [
  { id:'map',     icon:'ti-map-2',       label:'Mapa',    bg:'#1a7a3e', fg:'#b8f5d0', abg:'#22b050', afg:'#ffffff' },
  { id:'eventos', icon:'ti-confetti',    label:'Eventos', bg:'#aa1060', fg:'#ffc0e0', abg:'#e8288a', afg:'#ffffff' },
  { id:'dado',    icon:'ti-dice',        label:'Destino', bg:'#a07810', fg:'#fff0b0', abg:'#e8b820', afg:'#ffffff' },
  { id:'feed',    icon:'ti-users',       label:'Amigos',  bg:'#1848a8', fg:'#b0d4ff', abg:'#2272e8', afg:'#ffffff' },
  { id:'profile', icon:'ti-user-circle', label:'Perfil',  bg:'#a04010', fg:'#ffd0a0', abg:'#e86820', afg:'#ffffff' },
];

function buildNavs() {
  ['map','eventos','dado','feed','profile'].forEach(screen => {
    const container = document.getElementById('nav-' + screen);
    if (!container) return;
    container.innerHTML = NAV_ITEMS.map(item => {
      const isActive = item.id === screen;
      const bg = isActive ? item.abg : item.bg;
      const fg = isActive ? item.afg : item.fg;
      return `<button
        onclick="switchScreen('${item.id}')"
        id="nb-${screen}-${item.id}"
        aria-label="${item.label}"
        style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 8px;border:none;border-radius:14px;font-size:9px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;background-color:${bg};color:${fg};">
        <i class="ti ${item.icon}" style="font-size:20px;color:inherit" aria-hidden="true"></i>
        <span>${item.label}</span>
      </button>`;
    }).join('');
  });
}

function updateNavColors(activeScreen) {
  ['map','eventos','dado','feed','profile'].forEach(screen => {
    NAV_ITEMS.forEach(item => {
      const btn = document.getElementById(`nb-${screen}-${item.id}`);
      if (!btn) return;
      const isActive = item.id === activeScreen;
      btn.style.backgroundColor = isActive ? item.abg : item.bg;
      btn.style.color            = isActive ? item.afg : item.fg;
    });
  });
}

// ── AUTH — PANTALLA DE LOGIN ──────────────────────────────────
function showAuth(msg = '') {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  if (msg) {
    const el = document.getElementById('auth-msg');
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

async function doLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  const msg   = document.getElementById('auth-msg');
  if (!email || !pass) { msg.textContent = 'Rellena email y contraseña'; msg.style.display='block'; return; }
  setAuthLoading(true);
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  setAuthLoading(false);
  if (error) { msg.textContent = 'Email o contraseña incorrectos'; msg.style.display='block'; }
}

async function doRegister() {
  const email    = document.getElementById('auth-email').value.trim();
  const pass     = document.getElementById('auth-pass').value;
  const username = document.getElementById('auth-username').value.trim();
  const msg      = document.getElementById('auth-msg');
  msg.style.color = '#e8288a';

  // Validaciones básicas
  if (!email || !pass || !username) {
    msg.textContent = 'Rellena todos los campos';
    msg.style.display = 'block'; return;
  }
  if (pass.length < 6) {
    msg.textContent = 'La contraseña debe tener al menos 6 caracteres';
    msg.style.display = 'block'; return;
  }
  if (username.length < 3) {
    msg.textContent = 'El nombre de usuario debe tener al menos 3 caracteres';
    msg.style.display = 'block'; return;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    msg.textContent = 'El nombre solo puede tener letras, números, guiones y puntos';
    msg.style.display = 'block'; return;
  }

  setAuthLoading(true);

  // Comprobar si el username ya existe ANTES de crear la cuenta
  const { data: existing } = await db
    .from('profiles')
    .select('username')
    .ilike('username', username)
    .limit(1);

  if (existing && existing.length > 0) {
    msg.textContent = 'Ese nombre de usuario ya está en uso, elige otro';
    msg.style.display = 'block';
    setAuthLoading(false); return;
  }

  // Crear cuenta
  const { error } = await db.auth.signUp({
    email, password: pass,
    options: { data: { username } }
  });

  setAuthLoading(false);

  if (error) {
    if (error.message.includes('already registered')) {
      msg.textContent = 'Ese email ya tiene una cuenta. Inicia sesión.';
    } else {
      msg.textContent = error.message;
    }
    msg.style.display = 'block';
  } else {
    msg.style.color = '#22b050';
    msg.textContent = '¡Cuenta creada! Revisa tu email para confirmar.';
    msg.style.display = 'block';
  }
}

function setAuthLoading(on) {
  document.getElementById('btn-login').disabled    = on;
  document.getElementById('btn-register').disabled = on;
}

function toggleAuthForm() {
  const regRow = document.getElementById('register-row');
  const isReg  = regRow.style.display === 'flex';
  regRow.style.display = isReg ? 'none' : 'flex';
  document.getElementById('auth-toggle-txt').textContent = isReg
    ? '¿No tienes cuenta? Regístrate'
    : '¿Ya tienes cuenta? Inicia sesión';
  document.getElementById('auth-msg').style.display = 'none';
}

async function doLogout() {
  await db.auth.signOut();
  state.user = null; state.profile = null;
  state.visited = {}; state.photos = [];
  showAuth();
}

// ── CARGAR PERFIL Y DATOS DEL USUARIO ────────────────────────
async function loadUserData(user) {
  state.user = user;

  // Perfil
  const { data: profile } = await db
    .from('profiles').select('*').eq('id', user.id).single();
  state.profile = profile;

  if (profile) {
    document.getElementById('u-name').textContent  = profile.username;
    document.getElementById('av-init').textContent = profile.username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    if (profile.avatar_url) {
      const ring = document.getElementById('av-ring');
      const urlFresh = profile.avatar_url + '?t=' + Date.now();
      ring.innerHTML = `<img src="${urlFresh}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;
    }
  }

  // Visitas
  const { data: visits } = await db
    .from('visits').select('municipio').eq('user_id', user.id);
  if (visits) visits.forEach(v => { state.visited[v.municipio] = true; });

  // Fotos
  const { data: photos } = await db
    .from('photos').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (photos) state.photos = photos.map(p => ({
    id:       p.id,
    src:      db.storage.from('evidencias').getPublicUrl(p.storage_path).data?.publicUrl || '',
    muni:     p.municipio,
    date:     p.fecha,
    time:     p.hora || '',
    coords:   p.coords || '',
    desc:     p.descripcion || '',
    vis:      p.visibilidad,
    path:     p.storage_path,
  }));

  // Inscripciones
  const { data: signups } = await db
    .from('event_signups').select('event_id').eq('user_id', user.id);
  if (signups) signups.forEach(s => { state.inscripciones[s.event_id] = true; });

  updateProgress();
}

// ── NAVEGACIÓN ────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  updateNavColors(name);
  if (name === 'profile')  renderProfile();
  if (name === 'feed')     loadFeed();
  if (name === 'eventos')  loadEventos();
}

// ── MAPA ──────────────────────────────────────────────────────
function updateProgress() {
  const c = Object.keys(state.visited).length;
  const t = state.totalMuni;
  document.getElementById('pfill').style.width = Math.round(c / t * 100) + '%';
  document.getElementById('plabel').textContent = c + ' municipio' + (c !== 1 ? 's' : '') + ' conquistado' + (c !== 1 ? 's' : '');
  document.getElementById('ppct').textContent = c + ' / ' + t;
}

function showMuniBar(name) {
  document.getElementById('muni-bar').style.display = 'flex';
  document.getElementById('bar-name').textContent = name;
  const vis = state.visited[name];
  document.getElementById('bar-st').textContent = vis ? '✓ Conquistado' : 'Sin visitar';
  const btn = document.getElementById('btn-ev');
  btn.style.backgroundColor = vis ? '#1a7a3e' : '#22b050';
  btn.style.color = '#ffffff';
  btn.innerHTML = vis
    ? '<i class="ti ti-check" aria-hidden="true"></i> Conquistado'
    : '<i class="ti ti-camera" aria-hidden="true"></i> Evidencia';
}

function openSheet() {
  if (!state.selectedMuni) return;
  const muni    = state.selectedMuni;
  const visita  = state.visited[muni];

  document.getElementById('sht-title').textContent = muni;
  document.getElementById('sht-sub').textContent   = visita
    ? 'Ya conquistado — puedes añadir otra foto o desmarcar'
    : 'Añade una foto de tu visita a ' + muni;

  // Botón desmarcar: solo visible si ya está conquistado
  const btnDesmarcar = document.getElementById('btn-desmarcar');
  if (btnDesmarcar) btnDesmarcar.style.display = visita ? 'block' : 'none';

  // Botón marcar: cambiar texto si ya está
  const btnConf = document.getElementById('btn-conf');
  if (btnConf) btnConf.textContent = visita ? 'Guardar nueva foto' : 'Marcar como conquistado';

  // Reset visibilidad
  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('vis-active'));
  document.getElementById('vis-amigos').classList.add('vis-active');

  // Reset foto
  document.getElementById('prev-w').style.display = 'none';
  document.getElementById('uzone').style.display  = 'block';
  document.getElementById('file-in').value        = '';

  document.getElementById('upload-sheet').classList.add('open');
}

let selectedVisibilidad = 'amigos';
function setVis(v) {
  selectedVisibilidad = v;
  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('vis-active'));
  document.getElementById('vis-' + v).classList.add('vis-active');
}

async function confirmVisit() {
  const muni = state.selectedMuni;
  if (!muni || !state.user) return;

  const fileInput = document.getElementById('file-in');
  const file      = fileInput.files[0];
  const btn       = document.getElementById('btn-conf');
  btn.textContent = 'Guardando...';
  btn.disabled    = true;

  try {
    let storagePath = null;

    // 1. Subir foto si hay
    if (file) {
      const ext  = file.name.split('.').pop().replace(/[^a-z0-9]/gi,'').toLowerCase() || 'jpg';
      const path = `${state.user.id}/${Date.now()}.${ext}`;

      console.log('Subiendo evidencia:', path, file.type, file.size + 'b');

      // Subir directo sin conversión
      const { data: upData, error: upErr } = await db.storage
        .from('evidencias')
        .upload(path, file, {
          contentType:  file.type || 'image/jpeg',
          cacheControl: '3600',
          upsert:       false,
        });

      if (upErr) {
        console.error('Upload error:', JSON.stringify(upErr));
        throw new Error('Error foto: ' + (upErr.message || JSON.stringify(upErr)));
      }

      console.log('Subida OK:', upData?.path);
      storagePath = path;
    }

    // 2. Registrar visita
    await db.from('visits').upsert({
      user_id:     state.user.id,
      municipio:   muni,
      visibilidad: selectedVisibilidad,
      coords:      state.lastCoords || null,
      fecha:       new Date().toISOString().split('T')[0],
    });

    // 3. Registrar foto si hay
    if (storagePath) {
      const now = new Date();
      await db.from('photos').insert({
        user_id:      state.user.id,
        municipio:    muni,
        storage_path: storagePath,
        visibilidad:  selectedVisibilidad,
        coords:       state.lastCoords || null,
        fecha:        now.toISOString().split('T')[0],
        hora:         now.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
      });

      // Añadir a estado local
      const publicUrl = db.storage.from('evidencias').getPublicUrl(storagePath).data?.publicUrl || '';
      state.photos.unshift({
        src:   publicUrl,
        muni,
        date:  now.toLocaleDateString('es-ES'),
        time:  now.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
        coords: state.lastCoords || '',
        desc:  '',
        vis:   selectedVisibilidad,
        path:  storagePath,
      });
    }

    // 4. Actualizar estado local
    state.visited[muni] = true;
    document.querySelectorAll('.muni-path').forEach(p => {
      if (p.getAttribute('data-name') === muni) p.classList.add('visited');
    });
    showMuniBar(muni);
    document.getElementById('upload-sheet').classList.remove('open');
    document.getElementById('file-in').value = '';
    document.getElementById('prev-w').style.display = 'none';
    document.getElementById('uzone').style.display  = 'block';
    updateProgress();

    if (storagePath) {
      alert('✅ Foto guardada correctamente en: ' + storagePath);
    } else if (file) {
      alert('⚠️ La visita se guardó pero hubo un problema con la foto.');
    }

  } catch(err) {
    console.error('confirmVisit error:', err);
    // Si el error es solo de la foto, guardar la visita igualmente
    if (err.message && err.message.includes('foto')) {
      try {
        await db.from('visits').upsert({
          user_id:     state.user.id,
          municipio:   muni,
          visibilidad: selectedVisibilidad,
          coords:      state.lastCoords || null,
          fecha:       new Date().toISOString().split('T')[0],
        });
        state.visited[muni] = true;
        document.querySelectorAll('.muni-path').forEach(p => {
          if (p.getAttribute('data-name') === muni) p.classList.add('visited');
        });
        showMuniBar(muni);
        document.getElementById('upload-sheet').classList.remove('open');
        updateProgress();
        alert('⚠️ Visita guardada pero sin foto. Error: ' + err.message);
      } catch(e2) {
        alert('Error al guardar: ' + err.message);
      }
    } else {
      alert('Error al guardar: ' + err.message);
    }
  } finally {
    btn.textContent = state.visited[state.selectedMuni] ? 'Guardar nueva foto' : 'Marcar como conquistado';
    btn.disabled    = false;
  }
}

async function desmarcarVisit() {
  const muni = state.selectedMuni;
  if (!muni || !state.user) return;
  if (!confirm('¿Seguro que quieres desmarcar ' + muni + ' como conquistado?')) return;

  const btn = document.getElementById('btn-desmarcar');
  btn.textContent = 'Desmarcando...';
  btn.disabled    = true;

  try {
    // Borrar visita de Supabase
    await db.from('visits')
      .delete()
      .eq('user_id', state.user.id)
      .eq('municipio', muni);

    // Actualizar estado local
    delete state.visited[muni];

    // Actualizar mapa
    document.querySelectorAll('.muni-path').forEach(p => {
      if (p.getAttribute('data-name') === muni) {
        p.classList.remove('visited');
        p.classList.remove('selected');
      }
    });

    // Actualizar barra info
    document.getElementById('muni-bar').style.display = 'none';
    document.getElementById('upload-sheet').classList.remove('open');
    updateProgress();

  } catch(err) {
    alert('Error al desmarcar: ' + err.message);
  } finally {
    btn.textContent = 'Desmarcar como conquistado';
    btn.disabled    = false;
  }
}

// Geolocalización automática
function getCoords() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    state.lastCoords = pos.coords.latitude.toFixed(4) + '°N, ' + Math.abs(pos.coords.longitude).toFixed(4) + '°W';
  });
}

document.getElementById('uzone').addEventListener('click', () => document.getElementById('file-in').click());
document.getElementById('file-in').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    document.getElementById('prev-img').src = ev.target.result;
    const now = new Date();
    document.getElementById('prev-meta').textContent =
      now.toLocaleDateString('es-ES') + ' · ' +
      now.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
    document.getElementById('prev-w').style.display = 'block';
    document.getElementById('uzone').style.display  = 'none';
  };
  r.readAsDataURL(file);
  getCoords();
});

// ── EVENTOS ───────────────────────────────────────────────────
let currentFilter = 'todos';

async function loadEventos() {
  const { data } = await db.from('eventos').select('*').eq('activo', true).order('fecha');
  if (data) state.eventos = data;
  renderEventos();
}

function filterEvs(btn, tipo) {
  currentFilter = tipo;
  document.querySelectorAll('.ev-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderEventos();
}

function renderEventos() {
  const filtered = currentFilter === 'todos'
    ? state.eventos
    : state.eventos.filter(e => e.tipo === currentFilter);

  document.getElementById('eventos-list').innerHTML = filtered.map(ev => {
    const insc   = state.inscripciones[ev.id];
    const btnBg  = insc ? '#1a7a3e' : '#aa1060';
    const btnTxt = insc ? 'Apuntado' : 'Apuntarme';
    const btnIco = insc ? 'ti-check'  : 'ti-plus';
    const fecha  = new Date(ev.fecha).toLocaleDateString('es-ES', {day:'numeric', month:'short'});
    return `
    <div class="ev-card">
      <div class="ev-img" style="background-color:${ev.color_bg || '#1a3a5a'}">
        <i class="ti ${ev.icon || 'ti-confetti'}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>
        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i>${ev.dia_semana || ''} ${fecha}</div>
        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${ev.tipo_badge || ev.tipo}</div>
      </div>
      <div class="ev-body">
        <div class="ev-name">${ev.nombre}</div>
        <div class="ev-loc"><i class="ti ti-map-pin" aria-hidden="true"></i>${ev.lugar}</div>
        <div class="ev-desc">${ev.descripcion || ''}</div>
        <div class="ev-footer">
          <div class="ev-count" id="ev-count-${ev.id}"><strong>...</strong> van</div>
          <button onclick="toggleInscripcion(${ev.id})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background-color:${btnBg};color:#ffffff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0;">
            <i class="ti ${btnIco}" aria-hidden="true"></i>${btnTxt}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Cargar contadores de inscritos
  filtered.forEach(ev => loadEventCount(ev.id));
}

async function loadEventCount(eventId) {
  const { count } = await db
    .from('event_signups')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId);
  const el = document.getElementById('ev-count-' + eventId);
  if (el) el.innerHTML = `<strong>${count || 0}</strong> van`;
}

async function toggleInscripcion(eventId) {
  if (!state.user) return;
  const insc = state.inscripciones[eventId];
  if (insc) {
    await db.from('event_signups').delete()
      .eq('user_id', state.user.id).eq('event_id', eventId);
    delete state.inscripciones[eventId];
  } else {
    await db.from('event_signups').insert({ user_id: state.user.id, event_id: eventId });
    state.inscripciones[eventId] = true;
  }
  renderEventos();
}

// ── DADO ──────────────────────────────────────────────────────
const COMARCAS   = ["Costa Occidental","Saja-Nansa","Liébana","Besaya","Campoo","Valles Pasiegos","Trasmiera","Bahía de Santander","Asón-Agüera","Costa Oriental"];
const COAST_MUNIS = ["Santander","Castro-Urdiales","Santoña","Laredo","Comillas","San Vicente de la Barquera","Suances","Miengo","Piélagos","Camargo","El Astillero","Noja","Bareyo","Arnuero","Colindres","Limpias","Marina de Cudeyo","Ribamontán al Mar","Escalante","Argoños","Meruelo","Voto"];
const LOREM      = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.";

const DOT_POS = {
  1:[[60,60]],
  2:[[35,35],[85,85]],
  3:[[35,35],[60,60],[85,85]],
  4:[[35,35],[85,35],[35,85],[85,85]],
  5:[[35,35],[85,35],[60,60],[35,85],[85,85]],
  6:[[35,32],[85,32],[35,60],[85,60],[35,88],[85,88]],
};

function renderDice(num, col) {
  const g = document.getElementById('dice-dots');
  g.innerHTML = '';
  document.getElementById('dice-body').setAttribute('fill', col || '#f5f0e8');
  (DOT_POS[num] || []).forEach(([cx,cy]) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy);
    c.setAttribute('r','7'); c.setAttribute('fill','#1a1a2e');
    g.appendChild(c);
  });
}

function isCoast(n) { return COAST_MUNIS.some(c => n && n.toLowerCase().includes(c.toLowerCase())); }

function rollDice() {
  if (state.rolling) return;
  state.rolling = true;
  document.getElementById('dice-hint').textContent = 'Lanzando...';
  document.getElementById('result-wrap').classList.remove('show');
  document.getElementById('no-more').style.display = 'none';
  const svg = document.getElementById('dice-svg');
  svg.classList.remove('rolling'); void svg.offsetWidth; svg.classList.add('rolling');
  let t = 0;
  const iv = setInterval(() => {
    renderDice(Math.floor(Math.random()*6)+1); t++;
    if (t >= 12) {
      clearInterval(iv); svg.classList.remove('rolling');
      const fin = Math.floor(Math.random()*6)+1;
      renderDice(fin); state.rolling = false; showDiceResult(fin);
    }
  }, 55);
}

function showDiceResult(num) {
  const even  = num % 2 === 0;
  document.getElementById('badge-coast').classList.toggle('inactive-badge', !even);
  document.getElementById('badge-mount').classList.toggle('inactive-badge',  even);
  const pool = (even ? state.coast : state.mountain).filter(m => !state.visited[m]);
  const all  =  even ? state.coast : state.mountain;
  if (!all.length) { document.getElementById('no-more').style.display='block'; return; }
  const muni = (pool.length ? pool : all)[Math.floor(Math.random()*(pool.length||all.length))];

  // Buscar descripción en BD
  const muniData = state.municipiosData?.[muni] || {};

  renderDice(num, even ? '#dce8f5' : '#d5ede3');
  document.getElementById('rtop').className = 'rcard-top ' + (even ? 'coast' : 'mount');
  const rtag = document.getElementById('rtag');
  rtag.className = 'r-type-tag ' + (even ? 'tag-coast' : 'tag-mount');
  rtag.querySelector('i').className = 'ti ' + (even ? 'ti-waves' : 'ti-mountain');
  document.getElementById('rtag-txt').textContent  = even ? 'Costa' : 'Montaña';
  document.getElementById('r-num').textContent      = num;
  document.getElementById('r-muni').textContent     = muni;
  document.getElementById('r-comarca').textContent  = 'Comarca de ' + (muniData.comarca || COMARCAS[Math.floor(Math.random()*COMARCAS.length)]);
  document.getElementById('r-area').textContent     = muniData.area_km2 ? muniData.area_km2 + ' km²' : Math.round(Math.random()*200+5) + ' km²';
  document.getElementById('r-pop').textContent      = muniData.poblacion ? muniData.poblacion.toLocaleString('es-ES') + ' hab.' : Math.round(Math.random()*30000+100).toLocaleString('es-ES') + ' hab.';
  document.getElementById('r-desc').textContent     = muniData.descripcion || LOREM;
  document.getElementById('dice-hint').textContent  = pool.length ? '¡Tu próxima aventura te espera!' : 'Ya lo visitaste — aquí de nuevo';
  setTimeout(() => document.getElementById('result-wrap').classList.add('show'), 60);

  document.getElementById('btn-go').onclick = () => {
    state.selectedMuni = muni;
    switchScreen('map');
    setTimeout(() => {
      document.querySelectorAll('.muni-path').forEach(p => p.classList.remove('selected'));
      document.querySelectorAll('.muni-path').forEach(p => {
        if (p.getAttribute('data-name') === muni) { p.classList.add('selected'); showMuniBar(muni); }
      });
    }, 250);
  };
}

// ── FEED DE AMIGOS ────────────────────────────────────────────
async function loadFeed() {
  if (!state.user) return;

  document.getElementById('stories-row').innerHTML = '';
  document.getElementById('feed-posts').innerHTML = `
    <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:12px">
      Cargando...
    </div>`;

  // Obtener amigos aceptados CON sus perfiles
  const { data: friends } = await db
    .from('friendships')
    .select(`
      follower_id,
      following_id,
      follower:profiles!friendships_follower_id_fkey(id, username, avatar_url),
      following:profiles!friendships_following_id_fkey(id, username, avatar_url)
    `)
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
    .eq('estado', 'aceptado');

  // Extraer los perfiles de los amigos (el que NO soy yo) — deduplicar por id
  const seen = new Set();
  const friendProfiles = (friends || []).map(f => {
    if (f.follower_id === state.user.id) return f.following;
    return f.follower;
  }).filter(p => {
    if (!p || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const friendIds = [...new Set(friendProfiles.map(p => p.id))];

  // Renderizar stories con nombres y avatares reales
  renderStories(friendProfiles);

  if (!friendIds.length) {
    document.getElementById('feed-posts').innerHTML = `
      <div style="text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7">
        <i class="ti ti-users" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>
        Aún no tienes amigos añadidos.<br>¡Busca a alguien por su nombre de usuario!
      </div>`;
    return;
  }

  // Fotos de amigos
  const { data: posts } = await db
    .from('photos')
    .select('*, profiles(username, avatar_url)')
    .in('user_id', friendIds)
    .in('visibilidad', ['amigos','publico'])
    .order('created_at', { ascending: false })
    .limit(20);

  renderFeedPosts(posts || [], friendProfiles);
}

const STORY_COLORS = ['#c97ae8','#7ae8c9','#e87a9a','#e8b97a','#7ab3e8','#a8e87a'];

function renderStories(friendProfiles) {
  if (!friendProfiles.length) {
    document.getElementById('stories-row').innerHTML = '';
    return;
  }
  document.getElementById('stories-row').innerHTML = friendProfiles.slice(0,8).map((p, i) => {
    const initials = (p.username || '?').split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const color    = STORY_COLORS[i % STORY_COLORS.length];
    const avatar   = p.avatar_url
      ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${p.username}"/>`
      : `<span style="color:${color};font-family:'Playfair Display',serif;font-size:14px;font-weight:500">${initials}</span>`;
    return `
      <div class="story-item">
        <div class="story-ring">
          <div class="story-av">${avatar}</div>
        </div>
        <div class="story-name">${p.username || '?'}</div>
      </div>`;
  }).join('');
}

function renderFeedPosts(posts, friendProfiles) {
  if (!posts.length) {
    document.getElementById('feed-posts').innerHTML = `
      <div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px">
        Tus amigos aún no han subido fotos.
      </div>`;
    return;
  }
  document.getElementById('feed-posts').innerHTML = posts.map((p,i) => {
    const coast    = isCoast(p.municipio);
    const username = p.profiles?.username || 'Usuario';
    const initials = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const color    = STORY_COLORS[i % STORY_COLORS.length];
    const friendProfile = (friendProfiles || []).find(f => f.username === username);
    const avatarUrl = friendProfile?.avatar_url || p.profiles?.avatar_url;
    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${username}"/>`
      : initials;
    // Las evidencias son privadas — construir URL firmada no es posible en cliente
    // Usamos getPublicUrl que funciona si el bucket tiene política pública o signed
    const imgUrl   = db.storage.from('evidencias').getPublicUrl(p.storage_path).data?.publicUrl || '';
    const fecha    = new Date(p.created_at).toLocaleDateString('es-ES');
    return `
    <div class="feed-post">
      <div class="post-header">
        <div class="post-av" style="color:${color};overflow:hidden">${avatarHtml}</div>
        <div><div class="post-user">${username}</div><div class="post-time">${fecha}</div></div>
        <div class="post-badge ${coast?'pb-coast':'pb-mount'}">
          <i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true" style="font-size:10px"></i>
          ${coast?'Costa':'Montaña'}
        </div>
      </div>
      <div class="post-img" style="background:#1a2535">
        ${imgUrl
          ? `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="${p.municipio}"/>`
          : `<i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true"></i>`}
        <div class="post-location">
          <i class="ti ti-map-pin" aria-hidden="true"></i>${p.municipio}
        </div>
      </div>
      <div class="post-body">
        <div class="post-muni">${p.municipio}</div>
        ${p.descripcion ? `<div class="post-desc">${p.descripcion}</div>` : ''}
        <div class="post-actions">
          <button class="post-action" onclick="toggleLike(this,'${p.id}')" data-liked="false">
            <i class="ti ti-heart" aria-hidden="true"></i><span id="likes-${p.id}">0</span>
          </button>
          <button class="post-action" style="cursor:default">
            <i class="ti ti-message-circle" aria-hidden="true"></i><span>0</span>
          </button>
          <button class="post-action" style="margin-left:auto" onclick="switchScreen('map')">
            <i class="ti ti-map-pin" aria-hidden="true"></i><span style="font-size:11px">Ver mapa</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Cargar likes
  posts.forEach(p => loadPhotoLikes(p.id));
}

async function loadPhotoLikes(photoId) {
  const { count } = await db
    .from('photo_likes')
    .select('*', { count:'exact', head:true })
    .eq('photo_id', photoId);
  const el = document.getElementById('likes-' + photoId);
  if (el) el.textContent = count || 0;
}

async function toggleLike(btn, photoId) {
  if (!state.user) return;
  const liked = btn.getAttribute('data-liked') === 'true';
  btn.setAttribute('data-liked', String(!liked));
  btn.classList.toggle('liked', !liked);
  const span = btn.querySelector('span');
  if (!liked) {
    await db.from('photo_likes').insert({ user_id: state.user.id, photo_id: photoId });
    span.textContent = parseInt(span.textContent) + 1;
  } else {
    await db.from('photo_likes').delete().eq('user_id', state.user.id).eq('photo_id', photoId);
    span.textContent = parseInt(span.textContent) - 1;
  }
}

// ── BUSCAR AMIGOS ─────────────────────────────────────────────
async function searchUser() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const res = document.getElementById('search-results');
  res.innerHTML = '<div style="color:rgba(255,255,255,0.35);font-size:12px;padding:8px 0">Buscando...</div>';

  const { data } = await db
    .from('profiles')
    .select('id, username')
    .ilike('username', `%${q}%`)
    .neq('id', state.user.id)
    .limit(10);

  if (!data || !data.length) {
    res.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px 0">No se encontró ningún usuario</div>';
    return;
  }

  // Obtener estado de amistad con cada resultado
  const { data: friendships } = await db
    .from('friendships')
    .select('follower_id, following_id, estado')
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`);

  res.innerHTML = data.map(u => {
    const rel = (friendships || []).find(f =>
      (f.follower_id === state.user.id && f.following_id === u.id) ||
      (f.following_id === state.user.id && f.follower_id === u.id)
    );
    const initials = u.username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    let btnHtml = '';
    if (!rel) {
      btnHtml = `<button onclick="sendFriendRequest('${u.id}','${u.username}',this)"
        style="padding:6px 13px;background-color:#2272e8;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">
        + Añadir
      </button>`;
    } else if (rel.estado === 'pendiente') {
      btnHtml = `<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
        <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente
      </span>`;
    } else if (rel.estado === 'aceptado') {
      btnHtml = `<span style="font-size:11px;color:#22b050;background:rgba(34,176,80,0.12);padding:5px 10px;border-radius:999px">
        <i class="ti ti-check" aria-hidden="true" style="font-size:10px"></i> Amigos
      </span>`;
    }
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
      <div style="width:34px;height:34px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#7ab3e8;flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
      <span style="color:#fff;font-size:13px;flex:1">${u.username}</span>
      ${btnHtml}
    </div>`;
  }).join('');
}

async function sendFriendRequest(toId, toUsername, btn) {
  if (!state.user) return;
  // Cambiar botón a pendiente inmediatamente
  if (btn) {
    btn.outerHTML = `<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
      <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente
    </span>`;
  }
  const { error } = await db.from('friendships').insert({
    follower_id:  state.user.id,
    following_id: toId,
    estado:       'pendiente',
  });
  if (error && error.code !== '23505') {
    alert('Error al enviar solicitud. Inténtalo de nuevo.');
    searchUser(); // refrescar
  }
}

// ── PERFIL ────────────────────────────────────────────────────
async function renderProfile() {
  const c = Object.keys(state.visited).length;
  document.getElementById('sv').textContent  = c;
  document.getElementById('sp').textContent  = Math.round(c / state.totalMuni * 100) + '%';
  document.getElementById('sph').textContent = state.photos.length;
  renderGallery();
  await loadSolicitudes();
}

async function loadSolicitudes() {
  if (!state.user) return;

  const { data: recibidas } = await db
    .from('friendships')
    .select('follower_id, created_at, profiles!friendships_follower_id_fkey(username)')
    .eq('following_id', state.user.id)
    .eq('estado', 'pendiente');

  const { data: enviadas } = await db
    .from('friendships')
    .select('following_id, created_at, profiles!friendships_following_id_fkey(username)')
    .eq('follower_id', state.user.id)
    .eq('estado', 'pendiente');

  const container = document.getElementById('solicitudes-section');
  if (!container) return;

  const totalPendientes = (recibidas?.length || 0) + (enviadas?.length || 0);

  if (totalPendientes === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <div style="padding:14px 14px 0">
      <h2 style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.4);margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">
        Solicitudes de amistad
        <span style="background:#e8288a;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px;margin-left:6px">${totalPendientes}</span>
      </h2>`;

  if (recibidas?.length > 0) {
    html += `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px">Recibidas</div>`;
    html += recibidas.map(s => {
      const username = s.profiles?.username || 'Usuario';
      const initials = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
      const fecha    = new Date(s.created_at).toLocaleDateString('es-ES');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid #e8288a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#e8288a;flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:#fff">${username}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${fecha}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="aceptarSolicitud('${s.follower_id}','${username}')"
            style="padding:7px 12px;background-color:#22b050;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-check" aria-hidden="true"></i> Aceptar
          </button>
          <button onclick="rechazarSolicitud('${s.follower_id}','${username}')"
            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-x" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  if (enviadas?.length > 0) {
    html += `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:12px;margin-bottom:8px">Enviadas</div>`;
    html += enviadas.map(s => {
      const username = s.profiles?.username || 'Usuario';
      const initials = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
      const fecha    = new Date(s.created_at).toLocaleDateString('es-ES');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:rgba(255,255,255,0.5);flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:#fff">${username}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${fecha}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
            <i class="ti ti-clock" aria-hidden="true" style="font-size:11px"></i> Pendiente
          </span>
          <button onclick="cancelarSolicitud('${s.following_id}','${username}')"
            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-x" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  html += `</div>`;
  container.innerHTML = html;
}

async function aceptarSolicitud(fromUserId, username) {
  await db.from('friendships')
    .update({ estado: 'aceptado' })
    .eq('follower_id', fromUserId)
    .eq('following_id', state.user.id);
  await db.from('friendships').upsert({
    follower_id:  state.user.id,
    following_id: fromUserId,
    estado:       'aceptado',
  });
  await loadSolicitudes();
}

async function rechazarSolicitud(fromUserId, username) {
  if (!confirm('Rechazar la solicitud de ' + username + '?')) return;
  await db.from('friendships')
    .delete()
    .eq('follower_id', fromUserId)
    .eq('following_id', state.user.id);
  await loadSolicitudes();
}

async function cancelarSolicitud(toUserId, username) {
  if (!confirm('Cancelar la solicitud enviada a ' + username + '?')) return;
  await db.from('friendships')
    .delete()
    .eq('follower_id', state.user.id)
    .eq('following_id', toUserId);
  await loadSolicitudes();
}

function renderGallery() {
  const g = document.getElementById('gallery');
  const e = document.getElementById('g-empty');
  if (!state.photos.length) { g.innerHTML = ''; e.style.display = 'block'; return; }
  e.style.display = 'none';
  g.innerHTML = state.photos.map((p,i) => `
    <div class="gi" onclick="openPM(${i})">
      ${p.src
        ? `<img src="${p.src}" alt="${p.muni}" loading="lazy"/>`
        : `<div class="gi-ph"><i class="ti ti-camera" aria-hidden="true"></i></div>`}
      <div class="gi-hov">
        <div class="gm">
          <div style="font-weight:500">${p.muni.length>14?p.muni.substring(0,12)+'…':p.muni}</div>
          <div>${p.date}</div>
        </div>
      </div>
    </div>`).join('');
}

function openPM(i) {
  const p = state.photos[i];
  document.getElementById('pm-img').src = p.src || '';
  document.getElementById('pm-meta').innerHTML = `
    <div class="mrow"><i class="ti ti-map-pin" aria-hidden="true"></i><span>Municipio</span><strong>${p.muni}</strong></div>
    <div class="mrow"><i class="ti ti-calendar" aria-hidden="true"></i><span>Fecha</span><strong>${p.date}</strong></div>
    <div class="mrow"><i class="ti ti-clock" aria-hidden="true"></i><span>Hora</span><strong>${p.time || '—'}</strong></div>
    <div class="mrow"><i class="ti ti-location" aria-hidden="true"></i><span>Coordenadas</span><strong>${p.coords || '—'}</strong></div>
    <div class="mrow"><i class="ti ti-eye" aria-hidden="true"></i><span>Visibilidad</span>
      <strong style="display:flex;gap:6px;margin-top:4px">
        ${['privado','amigos','publico'].map(v => `
          <button onclick="changePhotoVis('${p.id}','${v}',this)"
            style="padding:4px 10px;border:none;border-radius:999px;font-size:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;
              background-color:${p.vis===v?'#2272e8':'rgba(255,255,255,0.1)'};
              color:${p.vis===v?'#fff':'rgba(255,255,255,0.6)'};">
            ${v}
          </button>`).join('')}
      </strong>
    </div>`;
}

async function changePhotoVis(photoId, vis, btn) {
  if (!photoId) return;
  await db.from('photos').update({ visibilidad: vis }).eq('id', photoId);
  const photo = state.photos.find(p => p.id === photoId);
  if (photo) photo.vis = vis;
  // actualizar botones
  btn.closest('strong').querySelectorAll('button').forEach(b => {
    b.style.backgroundColor = b.textContent.trim() === vis ? '#2272e8' : 'rgba(255,255,255,0.1)';
    b.style.color = b.textContent.trim() === vis ? '#fff' : 'rgba(255,255,255,0.6)';
  });
}

function closePM() { document.getElementById('photo-modal').classList.remove('open'); }

function toggleEdit() {
  const r = document.getElementById('u-edit-row');
  r.style.display = r.style.display === 'flex' ? 'none' : 'flex';
  if (r.style.display === 'flex') {
    document.getElementById('u-inp').value = state.profile?.username || '';
    document.getElementById('u-inp').focus();
  }
}

async function saveUser() {
  const v = document.getElementById('u-inp').value.trim();
  if (!v || !state.user) return;
  await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  state.profile.username = v;
  document.getElementById('u-name').textContent  = v;
  document.getElementById('av-init').textContent = v.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
  document.getElementById('u-edit-row').style.display = 'none';
}

document.getElementById('av-in').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file || !state.user) return;

  const ring     = document.getElementById('av-ring');
  const initials = ring.querySelector('#av-init')?.textContent || 'EX';
  ring.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;width:100%;height:100%">...</div>`;

  try {
    const ext      = file.name.split('.').pop().replace(/[^a-z0-9]/gi,'').toLowerCase() || 'jpg';
    const fileName = `${state.user.id}.${ext}`;

    // Borrar anterior si existe
    await db.storage.from('avatares').remove([fileName]);

    // Subir directo
    const { data: upData, error: upErr } = await db.storage
      .from('avatares')
      .upload(fileName, file, {
        contentType:  file.type || 'image/jpeg',
        upsert:       true,
        cacheControl: '3600',
      });

    if (upErr) {
      console.error('Upload error:', upErr);
      throw new Error(upErr.message);
    }

    // URL pública directa (bucket público)
    const { data: urlData } = db.storage.from('avatares').getPublicUrl(fileName);
    const url = urlData?.publicUrl;

    if (!url) throw new Error('No se pudo obtener la URL pública');

    const urlFresh = url + '?t=' + Date.now();

    // Guardar en perfil
    const { error: dbErr } = await db.from('profiles')
      .update({ avatar_url: url })
      .eq('id', state.user.id);

    if (dbErr) throw dbErr;

    // Actualizar estado local
    if (state.profile) state.profile.avatar_url = url;

    // Mostrar imagen
    ring.innerHTML = `<img src="${urlFresh}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;

  } catch(err) {
    console.error('Avatar error:', err);
    ring.innerHTML = `<span id="av-init">${initials}</span><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;
    alert('No se pudo subir el avatar: ' + err.message);
  }
});

// ── MAPA GEOGRÁFICO REAL ──────────────────────────────────────
async function loadMap() {
  try {
    // Cargar datos de municipios desde Supabase
    const { data: muniData } = await db.from('municipios').select('*');
    if (muniData) {
      state.municipiosData = {};
      muniData.forEach(m => { state.municipiosData[m.nombre] = m; });
      state.coast    = muniData.filter(m => m.tipo === 'costa').map(m => m.nombre);
      state.mountain = muniData.filter(m => m.tipo === 'montaña').map(m => m.nombre);
    }

    const topo = await d3.json('https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json');
    const all  = topojson.feature(topo, topo.objects.municipalities);
    const cant = {
      type: 'FeatureCollection',
      features: all.features.filter(f => String(f.id || '').startsWith('39')),
    };
    state.totalMuni = cant.features.length;

    const cont = document.getElementById('map-cont');
    const W    = cont.clientWidth || 410;
    const H    = Math.round(W * .49);
    const svgEl = document.getElementById('map-svg');
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const proj = d3.geoMercator().fitSize([W, H], cant);
    const path = d3.geoPath(proj);
    const svg  = d3.select('#map-svg');
    svg.selectAll('*').remove();

    svg.selectAll('path.muni-path')
      .data(cant.features).join('path')
      .attr('class', d => {
        const name = d.properties.name || d.properties.NAME || d.properties.NAMEUNIT || ('Mun-'+d.id);
        return 'muni-path' + (state.visited[name] ? ' visited' : '');
      })
      .attr('d', path)
      .attr('data-name', d => d.properties.name || d.properties.NAME || d.properties.NAMEUNIT || ('Mun-'+d.id))
      .on('click', function(ev, d) {
        const name = d3.select(this).attr('data-name');
        svg.selectAll('.muni-path').classed('selected', false);
        d3.select(this).classed('selected', true);
        state.selectedMuni = name;
        showMuniBar(name);
      });

    document.getElementById('map-load').style.display = 'none';
    updateProgress();
  } catch(err) {
    document.getElementById('map-load').innerHTML =
      '<p style="color:rgba(255,255,255,0.4);font-size:12px;padding:20px;text-align:center">Error al cargar el mapa.</p>';
  }
}

// ── RELOJ ─────────────────────────────────────────────────────
function updateClock() {
  const t = new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
  document.querySelectorAll('.clock').forEach(el => { el.textContent = t; });
}

// ── SERVICE WORKER ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  buildNavs();
  renderDice(6);
  updateClock();
  setInterval(updateClock, 30000);

  // Escuchar cambios de sesión
  db.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      await loadUserData(session.user);
      showApp();
      loadMap();
      loadEventos();
    } else {
      showAuth();
    }
  });

  // Sesión activa
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    await loadUserData(session.user);
    showApp();
    loadMap();
    loadEventos();
  } else {
    showAuth();
  }
}

init();
