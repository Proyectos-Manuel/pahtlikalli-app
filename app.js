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

/* v2: se añade el parámetro `decimales` (por defecto 0, igual que antes)
   para poder mostrar el precio por m² con 2 decimales sin tener que
   cambiar ninguna de las llamadas que ya existían. */
function fmtMXN(n, decimales = 0) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('es-MX', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
}

/* v2: precio por m² recalculado desde la superficie en ha.
   Devuelve null si faltan datos (la tabla muestra "—" en ese caso). */
function fmtPrecioM2(t) {
  const ha = Number(t.superficie_ha);
  const precio = Number(t.precio_total_mxn);
  if (!ha || !precio || isNaN(ha) || isNaN(precio)) return null;
  return precio / (ha * 10000);
}

function promedioCriterios(t) {
  const vals = t.criterios.map(c => c.calificacion).filter(v => typeof v === 'number' && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function contarFotos(t) {
  return (t.fotos?.length || 0) + t.criterios.reduce((a, c) => a + (c.fotos?.length || 0), 0);
}

/* ---------- Migración suave (v2) ----------
   Rellena los campos que falten sin tocar la estructura de IndexedDB
   (mismo DB_NAME / DB_VERSION / store). Así los datos que ya están
   guardados en la tablet siguen funcionando tal cual, solo que se les
   añade `enlace_earth: ''` y el resto de valores por defecto. */
function normalizarTerreno(t, criteriosBase) {
  const base = criteriosBase || [];
  const ter = {
    ...t,
    contacto: t.contacto || { nombre: '', telefono: '', email: '', notas: '' },
    enlace: t.enlace || '',
    enlace_earth: t.enlace_earth || '',        // campo nuevo de la v2
    fotos: t.fotos || [],
    observaciones_generales: t.observaciones_generales || '',
    fecha_visita: t.fecha_visita ?? null,
    gps: t.gps ?? null,
    criterios: Array.isArray(t.criterios) ? t.criterios : []
  };

  // Si el terreno no trae criterios (p. ej. recién importado), se generan
  // a partir de los criterios base.
  if (!ter.criterios.length && base.length) {
    ter.criterios = base.map(c => ({
      ...c, estado: 'Por Verificar', calificacion: 3, notas: '', fotos: []
    }));
  }

  // Cada criterio debe tener siempre sus campos completos.
  ter.criterios = ter.criterios.map(c => ({
    ...c,
    estado: c.estado || 'Por Verificar',
    calificacion: typeof c.calificacion === 'number' ? c.calificacion : 3,
    notas: c.notas || '',
    fotos: c.fotos || []
  }));

  return ter;
}

/* ---------- Carga inicial ---------- */
async function cargarDatos() {
  const guardado = await idbGet('terrenos');

  if (guardado) {
    // Migración suave: los datos guardados pueden no tener los campos nuevos.
    const base = guardado.criterios_base || [];
    guardado.terrenos = (guardado.terrenos || []).map(t => normalizarTerreno(t, base));
    return guardado;
  }

  const res = await fetch('data/terrenos.json');
  const base = await res.json();

  base.terrenos = (base.terrenos || []).map(t => normalizarTerreno(t, base.criterios_base));

  await idbSet('terrenos', base);
  return base;
}

async function guardarDatos() {
  await idbSet('terrenos', DATA);
}

/* ---------- v2: tabla resumen (va arriba de las tarjetas) ----------
   Columnas: Terreno · Ubicación · ha · Precio total · $/m² · Promedio ·
   Contacto · Enlaces. Al final, una fila de totales. La tabla se puede
   desplazar en horizontal dentro de .tabla-wrap (ver styles.css). */
function renderTablaResumen() {
  if (!DATA.terrenos.length) return '';

  let sumHa = 0, hayHa = false;
  let sumPrecio = 0;
  let sumProm = 0, nProm = 0;

  const filas = DATA.terrenos.map(t => {
    const ha = Number(t.superficie_ha);
    const precio = Number(t.precio_total_mxn);
    const m2 = fmtPrecioM2(t);
    const prom = promedioCriterios(t);

    if (ha && !isNaN(ha)) { sumHa += ha; hayHa = true; }
    if (precio && !isNaN(precio)) sumPrecio += precio;
    if (prom != null) { sumProm += prom; nProm++; }

    // Enlaces: solo se pinta el botón si el campo tiene valor
    const links = [
      t.enlace_earth
        ? `<a class="mini-link" href="${esc(t.enlace_earth)}" target="_blank" rel="noopener" title="Google Earth">🌍 Earth</a>`
        : '',
      t.enlace
        ? `<a class="mini-link" href="${esc(t.enlace)}" target="_blank" rel="noopener" title="Enlace web">🔗 Web</a>`
        : ''
    ].join('');

    return `
      <tr data-id="${esc(t.id)}">
        <td class="c-nombre">${esc(t.nombre)}</td>
        <td class="c-ubic" title="${esc(t.ubicacion)}">${esc(t.ubicacion) || '—'}</td>
        <td class="num">${t.superficie_ha ?? '—'}</td>
        <td class="num">${fmtMXN(t.precio_total_mxn)}</td>
        <td class="num">${m2 == null ? '—' : fmtMXN(m2, 2)}</td>
        <td class="num">${prom == null ? '—' : prom.toFixed(1)}</td>
        <td class="c-contacto">${esc(t.contacto?.nombre) || '—'}</td>
        <td class="c-links">${links || '<span class="sin-enlace">—</span>'}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="tabla-wrap">
      <table class="tabla-resumen" id="tabla-resumen">
        <thead>
          <tr>
            <th>Terreno</th>
            <th>Ubicación</th>
            <th class="num">ha</th>
            <th class="num">Precio total</th>
            <th class="num">$ / m²</th>
            <th class="num">Promedio</th>
            <th>Contacto</th>
            <th>Enlaces</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
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
      Toca un terreno (en la tabla o en su tarjeta) para abrir su ficha.
      Todo se guarda automáticamente en tu tablet.
    </p>
    ${renderTablaResumen()}
    <button class="btn full" id="btn-nuevo" style="margin-bottom:16px">➕ Nuevo terreno</button>
    ${html}
  `;

  document.querySelectorAll('.terreno-card').forEach(el => {
    el.addEventListener('click', () => abrirTerreno(el.dataset.id));
  });

  // v2: tocar una fila de la tabla abre la misma ficha que la tarjeta.
  // Si el toque cae sobre un enlace 🌍/🔗 se deja pasar y NO se abre la ficha.
  document.querySelectorAll('#tabla-resumen tbody tr').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      abrirTerreno(tr.dataset.id);
    });
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
      ${t.enlace_earth ? `
        <div class="acciones">
          <a class="btn sec" href="${esc(t.enlace_earth)}" target="_blank" rel="noopener"
             style="text-decoration:none;display:inline-flex;align-items:center">🌍 Ver en Google Earth</a>
        </div>` : ''}
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

      <label>Enlace Google Earth</label>
      <input type="text" id="n-enlace-earth" inputmode="url" placeholder="https://earth.google.com/...">

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
      enlace_earth: document.getElementById('n-enlace-earth').value.trim(),
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

      <label>Enlace Google Earth</label>
      <input type="text" id="e-enlace-earth" inputmode="url" placeholder="https://earth.google.com/..." value="${esc(t.enlace_earth || '')}">

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
    t.enlace_earth = document.getElementById('e-enlace-earth').value.trim();

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

/* ============================================================
   v2 · BACKUP COMPLETO (exportar / importar)
   ============================================================ */

/* Descarga un Blob con el nombre indicado. Helper compartido por
   el backup y por el CSV. */
function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // La URL se libera un poco después para no cortar la descarga en curso.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* EXPORTAR BACKUP: un único JSON con TODO el estado guardado en IndexedDB
   (terrenos, criterios y sus calificaciones, fotos, GPS, contacto, enlace,
   enlace_earth, observaciones y fechas).
   Las fotos viajan dentro como dataURL, igual que están guardadas. */
async function exportarBackup() {
  const hoy = new Date().toISOString().slice(0, 10);
  const backup = {
    app: 'pahtlikalli',
    tipo: 'backup',
    formato: 1,
    exportado: new Date().toISOString(),
    data: DATA
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  descargarBlob(blob, `pahtlikalli_backup_${hoy}.json`);
  toast('Backup descargado');
}

/* EXPORTAR CSV: se mantiene el mismo formato de siempre
   (queda como opción secundaria dentro del menú de backup). */
async function exportarCSV() {
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
  descargarBlob(blobCsv, `pahtlikalli_${new Date().toISOString().slice(0, 10)}.csv`);
  toast('CSV descargado');
}

/* IMPORTAR BACKUP.
   Acepta dos formatos:
   - el nuevo:   { tipo: 'backup', data: { criterios_base, terrenos, ... } }
   - el antiguo: { proyecto, criterios_base, terrenos, ... }  (la exportación
     JSON que hacía la v1) → así los backups antiguos siguen sirviendo.
   Pregunta con confirm(): ACEPTAR = fusionar, CANCELAR = reemplazar. */
async function importarBackup(file) {
  try {
    const texto = await file.text();

    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      throw new Error('el archivo no es un JSON válido');
    }

    // --- Validación de estructura ANTES de tocar nada ---
    if (!json || typeof json !== 'object') throw new Error('contenido vacío o inválido');
    const data = (json.data && Array.isArray(json.data.terrenos)) ? json.data : json;
    if (!data || typeof data !== 'object' || !Array.isArray(data.terrenos)) {
      throw new Error('estructura no reconocida (falta la lista "terrenos")');
    }

    const validos = data.terrenos.filter(t => t && typeof t === 'object' && t.id && t.nombre);
    if (data.terrenos.length && !validos.length) {
      throw new Error('ningún terreno del archivo tiene "id" y "nombre"');
    }

    // Los criterios base se toman del archivo si los trae; si no, se conservan
    // los actuales para poder generar los criterios que falten en cada terreno.
    const criteriosBase = (Array.isArray(data.criterios_base) && data.criterios_base.length)
      ? data.criterios_base
      : DATA.criterios_base;

    const entrantes = validos.map(t => normalizarTerreno(t, criteriosBase));

    const fusionar = confirm(
      `El backup contiene ${entrantes.length} terreno(s).\n\n` +
      `ACEPTAR  →  FUSIONAR: los del mismo id se sobrescriben y los nuevos se añaden.\n\n` +
      `CANCELAR →  REEMPLAZAR: se borran los ${DATA.terrenos.length} terrenos actuales y quedan solo los del archivo.`
    );

    let añadidos = 0, actualizados = 0, reemplazados = 0;

    if (fusionar) {
      entrantes.forEach(t => {
        const i = DATA.terrenos.findIndex(x => x.id === t.id);
        if (i === -1) { DATA.terrenos.push(t); añadidos++; }
        else { DATA.terrenos[i] = t; actualizados++; }
      });
    } else {
      // Rama destructiva: una segunda confirmación explícita antes de borrar.
      const ok = confirm(
        `⚠️ ¿Seguro? Se van a BORRAR los ${DATA.terrenos.length} terrenos actuales ` +
        `y sustituirlos por los ${entrantes.length} del archivo.`
      );
      if (!ok) { toast('Importación cancelada'); return; }

      DATA.terrenos = entrantes;
      DATA.criterios_base = criteriosBase;
      if (data.proyecto) DATA.proyecto = data.proyecto;
      if (data.version) DATA.version = data.version;
      reemplazados = entrantes.length;
    }

    await guardarDatos();
    TERRENO_ACTUAL = null;
    renderLista();

    toast(fusionar
      ? `Importado: ${añadidos} añadido(s), ${actualizados} actualizado(s)`
      : `Reemplazado: ${reemplazados} terreno(s)`);
  } catch (err) {
    toast('Error al importar: ' + err.message);
  }
}

/* ACTUALIZAR APP: desregistra el service worker, vacía las cachés y recarga.
   Los datos de IndexedDB NO se tocan. */
async function actualizarApp() {
  if (!confirm('¿Actualizar la app?\n\nSe recargará la versión más reciente. Tus terrenos, fotos y contactos NO se borran.')) return;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    // Si algo falla se recarga igual: init() vuelve a registrar el service worker.
  }

  // Nota: location.reload(true) está obsoleto y los navegadores actuales
  // ignoran el parámetro, por eso solo se llama a reload().
  location.reload();
}

/* ---------- v2 · Menú de backup (header) ---------- */
function abrirMenuBackup() {
  document.getElementById('menu-backup').classList.add('show');
  document.getElementById('menu-backdrop').classList.add('show');
}

function cerrarMenuBackup() {
  document.getElementById('menu-backup').classList.remove('show');
  document.getElementById('menu-backdrop').classList.remove('show');
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

  // v2: botón "🔄" (forzar actualización) y menú de backup
  document.getElementById('btn-actualizar').addEventListener('click', actualizarApp);

  document.getElementById('btn-backup').addEventListener('click', abrirMenuBackup);
  document.getElementById('menu-backdrop').addEventListener('click', cerrarMenuBackup);
  document.getElementById('btn-cerrar-menu').addEventListener('click', cerrarMenuBackup);

  document.getElementById('btn-export-backup').addEventListener('click', () => {
    cerrarMenuBackup();
    exportarBackup();
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    cerrarMenuBackup();
    exportarCSV();
  });

  document.getElementById('btn-import-backup').addEventListener('click', () => {
    cerrarMenuBackup();
    const inp = document.getElementById('input-backup');
    inp.value = '';   // permite volver a elegir el mismo archivo
    inp.click();
  });

  document.getElementById('input-backup').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await importarBackup(file);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();