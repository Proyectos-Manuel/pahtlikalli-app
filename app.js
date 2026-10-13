/* ============================================================
   PAHTLIKALLI - App de fichas de terreno
   PWA offline con IndexedDB, GPS, fotos, contacto, enlaces
   y gestión completa de terrenos (crear/editar/eliminar)
   ============================================================ */

const DB_NAME = 'pahtlikalli';
const DB_VERSION = 1;
const STORE = 'estado';

let DB = null;
let DATA = null;
let TERRENO_ACTUAL = null;

/* ---------- IndexedDB ---------- */
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Utilidades ---------- */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function esc(s) {
  return (s ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMXN(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

function promedioCriterios(t) {
  const vals = t.criterios.map(c => c.calificacion).filter(v => typeof v === 'number' && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function contarFotos(t) {
  return (t.fotos?.length || 0) + t.criterios.reduce((a, c) => a + (c.fotos?.length || 0), 0);
}

/* ---------- Carga inicial ---------- */
async function cargarDatos() {
  const guardado = await idbGet('terrenos');
  if (guardado) return guardado;

  const res = await fetch('data/terrenos.json');
  const base = await res.json();

  base.terrenos = base.terrenos.map(t => ({
    ...t,
    contacto: t.contacto || { nombre: '', telefono: '', email: '', notas: '' },
    enlace: t.enlace || '',
    criterios: base.criterios_base.map(c => ({
      ...c,
      estado: 'Por Verificar',
      calificacion: 3,
      notas: '',
      fotos: []
    }))
  }));

  await idbSet('terrenos', base);
  return base;
}

async function guardarDatos() {
  await idbSet('terrenos', DATA);
}

/* ---------- Render: lista de terrenos ---------- */
function renderLista() {
  document.getElementById('btn-atras').style.display = 'none';
  document.getElementById('titulo').textContent = '🌱 Pahtlikalli';

  const html = DATA.terrenos.map(t => {
    const prom = promedioCriterios(t);
    const nFotos = contarFotos(t);
    const visitado = t.fecha_visita ? '✅' : '⬜';
    return `
      <div class="terreno-card" data-id="${t.id}">
        <h2>${visitado} ${esc(t.nombre)}</h2>
        <div class="meta">${esc(t.ubicacion)}</div>
        <div class="badges">
          <span class="badge">${t.superficie_ha ?? '?'} ha</span>
          <span class="badge">${fmtMXN(t.precio_total_mxn)}</span>
          <span class="badge ${prom == null ? 'vacio' : ''}">
            ${prom == null ? 'sin evaluar' : '⭐ ' + prom.toFixed(1)}
          </span>
          ${nFotos ? `<span class="badge">📷 ${nFotos}</span>` : ''}
          ${t.gps ? `<span class="badge">📍 GPS</span>` : ''}
          ${t.enlace ? `<span class="badge">🔗</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('app').innerHTML = `
    <p style="color:var(--gris);font-size:14px;margin-top:0">
      Toca un terreno para abrir su ficha. Todo se guarda automáticamente en tu tablet.
    </p>
    <button class="btn full" id="btn-nuevo" style="margin-bottom:16px">➕ Nuevo terreno</button>
    ${html}
  `;

  document.querySelectorAll('.terreno-card').forEach(el => {
    el.addEventListener('click', () => abrirTerreno(el.dataset.id));
  });

  document.getElementById('btn-nuevo').addEventListener('click', mostrarFormularioNuevo);
}

/* ---------- Render: ficha de terreno ---------- */
function abrirTerreno(id) {
  TERRENO_ACTUAL = DATA.terrenos.find(t => t.id === id);
  renderFicha();
  window.scrollTo(0, 0);
}

function renderFicha() {
  const t = TERRENO_ACTUAL;
  document.getElementById('btn-atras').style.display = 'inline-block';
  document.getElementById('titulo').textContent = t.nombre;

  const grupos = {};
  t.criterios.forEach(c => {
    if (!grupos[c.categoria]) grupos[c.categoria] = [];
    grupos[c.categoria].push(c);
  });

  const info = `
    <div class="ficha-info">
      <p><strong>Ubicación:</strong> ${esc(t.ubicacion) || '—'}</p>
      <p><strong>Superficie:</strong> ${t.superficie_ha ?? '?'} ha (${t.superficie_m2?.toLocaleString('es-MX') ?? '?'} m²)</p>
      <p><strong>Precio:</strong> ${fmtMXN(t.precio_total_mxn)} · ${t.precio_m2_mxn ?? '?'} MXN/m²</p>
      <p><strong>Agua:</strong> ${esc(t.agua_registrada) || '—'}</p>
      <p><strong>Notas:</strong> ${esc(t.notas_clave) || '—'}</p>
      ${t.enlace ? `<p><strong>Enlace:</strong> <a href="${esc(t.enlace)}" target="_blank" rel="noopener">${esc(t.enlace)}</a></p>` : ''}
    </div>

    <div class="ficha-info">
      <label><strong>Fecha de visita</strong></label>
      <input type="date" id="fecha" value="${t.fecha_visita || ''}">
      <div class="acciones">
        <button class="btn sec" id="btn-gps">📍 Capturar GPS</button>
        <button class="btn sec" id="btn-editar">✏️ Editar datos</button>
      </div>
      <div class="gps-info ${t.gps ? 'ok' : ''}" id="gps-info">
        ${t.gps
          ? `Lat ${t.gps.lat.toFixed(6)}, Lng ${t.gps.lng.toFixed(6)} (±${Math.round(t.gps.acc)} m)`
          : 'Sin ubicación GPS guardada'}
      </div>
    </div>

    <div class="ficha-info">
      <strong>📷 Fotos generales del terreno</strong>
      <div class="acciones">
        <button class="btn" id="btn-foto">Añadir foto</button>
      </div>
      <div class="fotos-mini" id="fotos-terreno">
        ${renderFotos(t.fotos, 'terreno')}
      </div>
    </div>
  `;

  const contacto = `
    <div class="ficha-info">
      <h3 style="margin-top:0">👤 Contacto del vendedor</h3>
      <label>Nombre</label>
      <input type="text" id="c-nombre" value="${esc(t.contacto?.nombre || '')}" placeholder="Nombre completo">
      <label style="display:block;margin-top:8px">Teléfono</label>
      <input type="text" id="c-tel" value="${esc(t.contacto?.telefono || '')}" placeholder="+52 ..." inputmode="tel">
      <label style="display:block;margin-top:8px">Email</label>
      <input type="text" id="c-email" value="${esc(t.contacto?.email || '')}" placeholder="correo@ejemplo.com" inputmode="email">
      <label style="display:block;margin-top:8px">Notas del contacto</label>
      <textarea id="c-notas" placeholder="Cómo llegaste a él/ella, horarios, quién más sabe del terreno...">${esc(t.contacto?.notas || '')}</textarea>
      <div class="acciones">
        <a class="btn sec" id="c-tel-link" style="display:none;text-decoration:none;text-align:center">📞 Llamar</a>
        <a class="btn sec" id="c-wa-link" style="display:none;text-decoration:none;text-align:center" target="_blank">💬 WhatsApp</a>
      </div>
    </div>
  `;

  const secciones = Object.entries(grupos).map(([cat, criterios]) => `
    <div class="seccion">
      <h3>${esc(cat)}</h3>
      ${criterios.map(c => renderCriterio(c)).join('')}
    </div>
  `).join('');

  const prom = promedioCriterios(t);

  const finales = `
    <div class="seccion">
      <h3>📝 Observaciones generales</h3>
      <textarea id="obs-gen" placeholder="Impresión del entorno, acuerdos, contactos...">${esc(t.observaciones_generales || '')}</textarea>
    </div>

    <div class="promedio">
      <span>Calificación general</span>
      <span class="num">${prom == null ? '—' : prom.toFixed(1)}</span>
    </div>

    <div style="margin:20px 0 40px">
      <button class="btn warn full" id="btn-eliminar">🗑️ Eliminar este terreno</button>
    </div>
  `;

  document.getElementById('app').innerHTML = info + contacto + secciones + finales;

  /* ---------- EVENTOS ---------- */
  document.getElementById('fecha').addEventListener('change', e => {
    t.fecha_visita = e.target.value;
    guardarDatos();
  });

  document.getElementById('btn-gps').addEventListener('click', capturarGPS);

  document.getElementById('btn-editar').addEventListener('click', () => {
    mostrarFormularioEditar(t);
  });

  document.getElementById('btn-foto').addEventListener('click', () => {
    abrirSelectorFoto((file) => agregarFoto(t.fotos, file, 'terreno'));
  });

  document.getElementById('obs-gen').addEventListener('input', e => {
    t.observaciones_generales = e.target.value;
    guardarDatos();
  });

  // Contacto
  const cNombre = document.getElementById('c-nombre');
  const cTel    = document.getElementById('c-tel');
  const cEmail  = document.getElementById('c-email');
  const cNotas  = document.getElementById('c-notas');

  function guardarContacto() {
    t.contacto = t.contacto || { nombre: '', telefono: '', email: '', notas: '' };
    t.contacto.nombre   = cNombre.value;
    t.contacto.telefono = cTel.value;
    t.contacto.email    = cEmail.value;
    t.contacto.notas    = cNotas.value;
    guardarDatos();
    actualizarLinksContacto();
  }

  function actualizarLinksContacto() {
    const tel = (t.contacto?.telefono || '').replace(/\s+/g, '');
    const telLink = document.getElementById('c-tel-link');
    const waLink  = document.getElementById('c-wa-link');
    if (tel) {
      telLink.href = 'tel:' + tel;
      telLink.style.display = 'inline-block';
      waLink.href = 'https://wa.me/' + tel.replace(/[^\d]/g, '');
      waLink.style.display = 'inline-block';
    } else {
      telLink.style.display = 'none';
      waLink.style.display = 'none';
    }
  }

  cNombre.addEventListener('input', guardarContacto);
  cTel.addEventListener('input', guardarContacto);
  cEmail.addEventListener('input', guardarContacto);
  cNotas.addEventListener('input', guardarContacto);
  actualizarLinksContacto();

  // Eliminar
  document.getElementById('btn-eliminar').addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${t.nombre}"? Esta acción no se puede deshacer.`)) return;
    DATA.terrenos = DATA.terrenos.filter(x => x.id !== t.id);
    await guardarDatos();
    TERRENO_ACTUAL = null;
    renderLista();
    toast('Terreno eliminado');
  });

  // Criterios
  document.querySelectorAll('.criterio').forEach(el => {
    const cid = el.dataset.cid;
    const crit = t.criterios.find(c => c.id === cid);

    el.querySelectorAll('.estrellas button').forEach(btn => {
      btn.addEventListener('click', () => {
        crit.calificacion = parseInt(btn.dataset.v);
        guardarDatos();
        renderFicha();
      });
    });

    const ta = el.querySelector('textarea');
    ta.addEventListener('input', () => {
      crit.notas = ta.value;
      guardarDatos();
    });

    el.querySelector('.btn-foto-c').addEventListener('click', () => {
      abrirSelectorFoto((file) => agregarFoto(crit.fotos, file, 'criterio', cid));
    });
  });

  // Fotos: eliminar / ampliar
  document.querySelectorAll('.thumb').forEach(th => {
    th.querySelector('.x').addEventListener('click', async (e) => {
      e.stopPropagation();
      const { tipo, cid, idx } = th.dataset;
      if (tipo === 'terreno') t.fotos.splice(parseInt(idx), 1);
      else {
        const crit = t.criterios.find(c => c.id === cid);
        crit.fotos.splice(parseInt(idx), 1);
      }
      await guardarDatos();
      renderFicha();
    });
    th.querySelector('img').addEventListener('click', () => {
      document.getElementById('modal-img').src = th.querySelector('img').src;
      document.getElementById('modal-foto').classList.add('show');
    });
  });
}

function renderCriterio(c) {
  const estrellas = [1, 2, 3, 4, 5].map(v =>
    `<button data-v="${v}" class="${c.calificacion === v ? 'activo' : ''}">${v}</button>`
  ).join('');

  const fotos = renderFotos(c.fotos, 'criterio', c.id);

  return `
    <div class="criterio" data-cid="${c.id}">
      <div class="nombre">${esc(c.nombre)}</div>
      <div class="punto">${esc(c.punto_revisar)}</div>
      <div class="estrellas">${estrellas}</div>
      <textarea placeholder="Notas y observaciones de campo...">${esc(c.notas || '')}</textarea>
      <div class="acciones">
        <button class="btn sec btn-foto-c">📷 Foto</button>
      </div>
      <div class="fotos-mini">${fotos}</div>
    </div>
  `;
}

function renderFotos(fotos, tipo, cid = '') {
  if (!fotos || !fotos.length) return '';
  return fotos.map((f, i) => `
    <div class="thumb" data-tipo="${tipo}" data-cid="${cid}" data-idx="${i}">
      <img src="${f.dataUrl}" alt="">
      <button class="x">×</button>
    </div>
  `).join('');
}

/* ---------- Nuevo terreno ---------- */
function mostrarFormularioNuevo() {
  document.getElementById('btn-atras').style.display = 'none';
  document.getElementById('titulo').textContent = '➕ Nuevo terreno';

  document.getElementById('app').innerHTML = `
    <div class="ficha-info">
      <label>Nombre del terreno *</label>
      <input type="text" id="n-nombre" placeholder="Ej. La Loma" autofocus>

      <label>Ubicación</label>
      <input type="text" id="n-ubicacion" placeholder="Ej. Xico, Veracruz">

      <label>Superficie (ha)</label>
      <input type="number" id="n-ha" step="0.01" inputmode="decimal" placeholder="10">

      <label>Precio total (MXN)</label>
      <input type="number" id="n-precio" step="1000" inputmode="numeric" placeholder="5000000">

      <label>Agua registrada</label>
      <input type="text" id="n-agua" placeholder="Ej. 2 arroyos, 1 manantial">

      <label>Notas clave</label>
      <textarea id="n-notas" placeholder="Detalles importantes del terreno..."></textarea>

      <label>Enlace (Facebook, portal, etc.)</label>
      <input type="text" id="n-enlace" inputmode="url" placeholder="https://...">

      <div class="acciones" style="margin-top:16px">
        <button class="btn full" id="btn-guardar-nuevo">💾 Guardar terreno</button>
        <button class="btn sec full" id="btn-cancelar-nuevo">Cancelar</button>
      </div>
    </div>
  `;

  document.getElementById('btn-cancelar-nuevo').addEventListener('click', renderLista);

  document.getElementById('btn-guardar-nuevo').addEventListener('click', async () => {
    const nombre = document.getElementById('n-nombre').value.trim();
    if (!nombre) return toast('Ponle un nombre al terreno');

    const ha = parseFloat(document.getElementById('n-ha').value) || null;
    const precio = parseFloat(document.getElementById('n-precio').value) || null;

    const nuevo = {
      id: 'terreno_' + Date.now(),
      nombre,
      ubicacion: document.getElementById('n-ubicacion').value.trim(),
      superficie_ha: ha,
      superficie_m2: ha ? Math.round(ha * 10000) : null,
      precio_total_mxn: precio,
      precio_m2_mxn: (precio && ha) ? +(precio / (ha * 10000)).toFixed(2) : null,
      agua_registrada: document.getElementById('n-agua').value.trim(),
      notas_clave: document.getElementById('n-notas').value.trim(),
      enlace: document.getElementById('n-enlace').value.trim(),
      estatus: '',
      fecha_visita: null,
      gps: null,
      fotos: [],
      observaciones_generales: '',
      contacto: { nombre: '', telefono: '', email: '', notas: '' },
      criterios: DATA.criterios_base.map(c => ({
        ...c,
        estado: 'Por Verificar',
        calificacion: 3,
        notas: '',
        fotos: []
      }))
    };

    DATA.terrenos.push(nuevo);
    await guardarDatos();
    toast('Terreno añadido');
    renderLista();
  });
}

/* ---------- Editar terreno ---------- */
function mostrarFormularioEditar(t) {
  document.getElementById('btn-atras').style.display = 'inline-block';
  document.getElementById('titulo').textContent = '✏️ Editar terreno';

  document.getElementById('app').innerHTML = `
    <div class="ficha-info">
      <label>Nombre del terreno *</label>
      <input type="text" id="e-nombre" value="${esc(t.nombre)}">

      <label>Ubicación</label>
      <input type="text" id="e-ubicacion" value="${esc(t.ubicacion || '')}">

      <label>Superficie (ha)</label>
      <input type="number" id="e-ha" step="0.01" inputmode="decimal" value="${t.superficie_ha ?? ''}">

      <label>Precio total (MXN)</label>
      <input type="number" id="e-precio" step="1000" inputmode="numeric" value="${t.precio_total_mxn ?? ''}">

      <label>Agua registrada</label>
      <input type="text" id="e-agua" value="${esc(t.agua_registrada || '')}">

      <label>Notas clave</label>
      <textarea id="e-notas">${esc(t.notas_clave || '')}</textarea>

      <label>Enlace</label>
      <input type="text" id="e-enlace" inputmode="url" value="${esc(t.enlace || '')}">

      <div class="acciones" style="margin-top:16px">
        <button class="btn full" id="btn-guardar-edicion">💾 Guardar cambios</button>
        <button class="btn sec full" id="btn-cancelar-edicion">Cancelar</button>
      </div>
    </div>
  `;

  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    TERRENO_ACTUAL = t;
    renderFicha();
  });

  document.getElementById('btn-guardar-edicion').addEventListener('click', async () => {
    const nombre = document.getElementById('e-nombre').value.trim();
    if (!nombre) return toast('El nombre no puede estar vacío');

    const ha = parseFloat(document.getElementById('e-ha').value) || null;
    const precio = parseFloat(document.getElementById('e-precio').value) || null;

    t.nombre = nombre;
    t.ubicacion = document.getElementById('e-ubicacion').value.trim();
    t.superficie_ha = ha;
    t.superficie_m2 = ha ? Math.round(ha * 10000) : null;
    t.precio_total_mxn = precio;
    t.precio_m2_mxn = (precio && ha) ? +(precio / (ha * 10000)).toFixed(2) : null;
    t.agua_registrada = document.getElementById('e-agua').value.trim();
    t.notas_clave = document.getElementById('e-notas').value.trim();
    t.enlace = document.getElementById('e-enlace').value.trim();

    await guardarDatos();
    toast('Datos actualizados');
    TERRENO_ACTUAL = t;
    renderFicha();
  });
}

/* ---------- Fotos ---------- */
let _fotoCallback = null;
function abrirSelectorFoto(cb) {
  _fotoCallback = cb;
  const inp = document.getElementById('input-foto');
  inp.value = '';
  inp.click();
}

document.getElementById('input-foto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !_fotoCallback) return;
  const dataUrl = await comprimirImagen(file);
  _fotoCallback({ dataUrl, ts: Date.now() });
  _fotoCallback = null;
});

async function comprimirImagen(file, maxLado = 1280, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > h && w > maxLado) { h = h * maxLado / w; w = maxLado; }
      else if (h > maxLado) { w = w * maxLado / h; h = maxLado; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function agregarFoto(destino, foto, tipo, cid) {
  destino.push(foto);
  await guardarDatos();
  renderFicha();
  toast('Foto añadida');
}

/* ---------- GPS ---------- */
function capturarGPS() {
  if (!navigator.geolocation) return toast('GPS no disponible');
  toast('Obteniendo ubicación...');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      TERRENO_ACTUAL.gps = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
        ts: Date.now()
      };
      await guardarDatos();
      renderFicha();
      toast('Ubicación guardada');
    },
    (err) => toast('Error GPS: ' + err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/* ---------- Exportar ---------- */
async function exportar() {
  const json = JSON.stringify(DATA, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pahtlikalli_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  const filas = [['Terreno', 'Ubicación', 'ha', 'Precio', 'Promedio', 'GPS', 'Fotos', 'Contacto', 'Teléfono', 'Email', 'Enlace', 'Observaciones']];
  DATA.terrenos.forEach(t => {
    const prom = promedioCriterios(t);
    filas.push([
      t.nombre, t.ubicacion, t.superficie_ha, t.precio_total_mxn,
      prom ? prom.toFixed(2) : '',
      t.gps ? `${t.gps.lat.toFixed(5)},${t.gps.lng.toFixed(5)}` : '',
      contarFotos(t),
      t.contacto?.nombre || '',
      t.contacto?.telefono || '',
      t.contacto?.email || '',
      t.enlace || '',
      (t.observaciones_generales || '').replace(/\n/g, ' ')
    ]);
  });
  const csv = filas.map(f => f.map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
  const blobCsv = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const urlCsv = URL.createObjectURL(blobCsv);
  const a2 = document.createElement('a');
  a2.href = urlCsv;
  a2.download = `pahtlikalli_${new Date().toISOString().slice(0, 10)}.csv`;
  a2.click();
  URL.revokeObjectURL(urlCsv);

  toast('Exportado JSON + CSV');
}

/* ---------- Init ---------- */
async function init() {
  DB = await abrirDB();
  DATA = await cargarDatos();
  renderLista();

  document.getElementById('btn-atras').addEventListener('click', () => {
    TERRENO_ACTUAL = null;
    renderLista();
  });

  document.getElementById('btn-export').addEventListener('click', exportar);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();