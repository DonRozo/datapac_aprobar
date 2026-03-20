/* ===========================================================
   DATA-PAC | Revisión y Aprobación V3 (Ajuste Final de Cierre)
   =========================================================== */

const SERVICE_URL = "https://services6.arcgis.com/yq6pe3Lw2oWFjWtF/arcgis/rest/services/DATAPAC_V3/FeatureServer";
const URL_WEBHOOK_POWERAUTOMATE = "https://default64f30d63182749d899511db17d0949.e4.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/1123b3fd4a854b40b2b22dd45b03ca7c/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=Qz68D2G5RAq9cmMvOew1roy8bD3YQPtju4KPW2vEtvc"; 

// Índices Reales Confirmados
const URL_SEG_ROL = `${SERVICE_URL}/0`;
const URL_CFG_PAC = `${SERVICE_URL}/1`;
const URL_CFG_LINEA = `${SERVICE_URL}/2`;
const URL_CFG_PROGRAMA = `${SERVICE_URL}/3`;
const URL_CFG_PROYECTO = `${SERVICE_URL}/4`;
const URL_CFG_OBJETIVO = `${SERVICE_URL}/5`;
const URL_CFG_ACTIVIDAD = `${SERVICE_URL}/6`;
const URL_CFG_SUBACTIVIDAD = `${SERVICE_URL}/7`;
const URL_CFG_TAREA = `${SERVICE_URL}/8`;
const URL_AVANCE_TAREA = `${SERVICE_URL}/9`;
const URL_TAREA_UBICACION = `${SERVICE_URL}/10`; 
const URL_NARRATIVA = `${SERVICE_URL}/11`;

const URL_PERSONA = `${SERVICE_URL}/16`; 
const URL_OTP = `${SERVICE_URL}/17`;
const URL_PERSONA_ROL = `${SERVICE_URL}/21`; 
const URL_ALCANCE = `${SERVICE_URL}/22`; 

const URL_AUD_HISTORIAL = `${SERVICE_URL}/23`; 
const URL_AUD_EVENTO = `${SERVICE_URL}/24`; 
const URL_WF_SOLICITUD = `${SERVICE_URL}/25`;
const URL_WF_PASO = `${SERVICE_URL}/26`; 
const URL_WF_NOTIFICACION = `${SERVICE_URL}/27`;

// Estado Global
let currentUser = { gid: null, pid: null, nombre: "", correo: "", rolesFuncionales: [], alcance: [] }; 
let cacheDependencias = new Set();
let cacheActividades = new Map(); 
let dictPersonas = new Map(); 
let dictRoles = new Map(); // Cache para resolver nombres de roles (SEG_Rol)
let listInboxEnriched = []; 
let currentItem = null; 
let isProcessing = false;

// DOM Elements
const elInboxList = document.getElementById("inbox-list");
const elStatus = document.getElementById("review-status");
const viewEmpty = document.getElementById("detail-empty");
const viewContent = document.getElementById("detail-content");
const fltVigencia = document.getElementById("flt-vigencia"), fltPeriodo = document.getElementById("flt-periodo");
const fltDependencia = document.getElementById("flt-dependencia"), fltEstado = document.getElementById("flt-estado");
const fltTexto = document.getElementById("flt-texto");

// --- Helpers Genéricos ---
function setStatusMsg(msg, type="info", el = elStatus) {
    if(!el) return;
    el.textContent = msg; el.style.color = type === "error" ? "var(--danger)" : (type === "success" ? "var(--success)" : "var(--muted)");
}
function escapeHtml(s){ return (s??"").toString().replaceAll("<","&lt;").replaceAll(">","&gt;"); }
async function fetchJson(url, params){ 
    const u=new URL(url); Object.entries(params||{}).forEach(([k,v])=>u.searchParams.set(k,v)); 
    const r=await fetch(u, {method:"GET"}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); 
}
async function postForm(url, formObj){ 
    const form=new URLSearchParams(); Object.entries(formObj).forEach(([k,v])=>{ if(v!=null) form.append(k,typeof v==="string"?v:JSON.stringify(v)); }); 
    const r=await fetch(url, {method:"POST", body:form}); return await r.json(); 
}
function generateGUID() { return '{' + crypto.randomUUID().toUpperCase() + '}'; }

function normalizeState(st) {
    if (!st) return "Borrador"; const s = String(st).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.includes("devuelto")) return "Devuelto"; if (s.includes("enviado")) return "Enviado";
    if (s.includes("enrevision") || s.includes("revision")) return "EnRevision";
    if (s.includes("aprobado")) return "Aprobado"; if (s.includes("publicado")) return "Publicado";
    return "Borrador";
}
function getBadgeHtml(estado) {
    const norm = normalizeState(estado); return `<span class="status-badge status-badge--${norm.toLowerCase()}">${norm}</span>`;
}

// --- Escritura Estricta de Auditoría ---
async function writeAuditEvent(modulo, evento, resultado, detalle) {
  if (!currentUser.pid) return;
  try {
    const attrs = { 
        EventoID: generateGUID(), Modulo: modulo, Evento: evento, Resultado: resultado, 
        FechaEvento: Date.now(), PersonaID: currentUser.pid, Detalle: detalle ? detalle.substring(0, 500) : "",
        IP: "", UserAgent: navigator.userAgent
    };
    await postForm(`${URL_AUD_EVENTO}/applyEdits`, { f:"json", adds: [{attributes: attrs}] });
  } catch(e) { console.warn("Error Auditoría Evento:", e); }
}

async function writeAuditHistory(tipoObj, objId, objGid, campo, valAnt, valNuevo, motivo) {
  if (!currentUser.pid) return;
  try {
    const attrs = { 
        HistorialID: generateGUID(), TipoObjeto: tipoObj, ObjetoID: objId || "0", ObjetoGlobalID: objGid || "", 
        CampoModificado: campo || "", ValorAnterior: String(valAnt||"").substring(0, 1000), ValorNuevo: String(valNuevo||"").substring(0, 1000), 
        PersonaID: currentUser.pid, FechaCambio: Date.now(), MotivoCambio: motivo || "", OrigenCambio: "APP_REVISION" 
    };
    await postForm(`${URL_AUD_HISTORIAL}/applyEdits`, { f:"json", adds: [{attributes: attrs}] });
  } catch(e) { console.warn("Error Auditoría Historial:", e); }
}

// --- Autenticación Estricta OTP y Roles Múltiples ---
document.getElementById("btn-solicitar-codigo").addEventListener("click", async () => {
  const cedula = document.getElementById("login-cedula").value.trim(), correo = document.getElementById("login-correo").value.trim().toLowerCase();
  document.getElementById("login-msg-1").textContent = "";
  try {
    const qPers = await fetchJson(`${URL_PERSONA}/query`, { f:"json", where:`Cedula='${cedula}' AND Correo='${correo}' AND Activo='SI'`, outFields:"GlobalID" });
    if(!qPers.features.length) throw new Error("Cédula o correo incorrectos, o usuario inactivo.");
    
    const res = await fetch(URL_WEBHOOK_POWERAUTOMATE, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({cedula, correo}) });
    if(res.status === 200) { document.getElementById("login-step-1").classList.remove("active"); document.getElementById("login-step-2").classList.add("active"); }
    else throw new Error("Error comunicándose con el servicio OTP.");
  } catch(e) { document.getElementById("login-msg-1").textContent = e.message; }
});

document.getElementById("btn-validar-codigo").addEventListener("click", async () => {
  const cedula = document.getElementById("login-cedula").value.trim(), correo = document.getElementById("login-correo").value.trim().toLowerCase(), codigo = document.getElementById("login-codigo").value.trim();
  document.getElementById("login-msg-2").textContent = "Validando credenciales...";
  try {
    const qPers = await fetchJson(`${URL_PERSONA}/query`, { f:"json", where:`Cedula='${cedula}' AND Correo='${correo}' AND Activo='SI'`, outFields:"GlobalID,PersonaID,Nombre" });
    if(!qPers.features.length) throw new Error("Usuario no válido.");
    const pInfo = qPers.features[0].attributes;

    const qOtp = await fetchJson(`${URL_OTP}/query`, { f:"json", where:`PersonaGlobalID='${pInfo.GlobalID}' AND CodigoHash='${codigo}' AND Usado='NO'`, outFields:"*" });
    if(!qOtp.features.length) throw new Error("Código incorrecto o ya utilizado.");
    const otp = qOtp.features[0].attributes;
    if (Date.now() > otp.FechaExpira) throw new Error("El código ha expirado. Solicite uno nuevo.");

    // Resolución de Roles Funcionales con Join a SEG_Rol
    const qRolesAsignados = await fetchJson(`${URL_PERSONA_ROL}/query`, { f: "json", where: `PersonaID='${pInfo.PersonaID}' AND Activo='SI'`, outFields: "RolID" });
    const idsRolesAsignados = (qRolesAsignados.features || []).map(f => `'${f.attributes.RolID}'`).join(",");
    
    let rolesFuncionalesTextos = [];
    if(idsRolesAsignados) {
        const qDefRoles = await fetchJson(`${URL_SEG_ROL}/query`, { f:"json", where:`RolID IN (${idsRolesAsignados})`, outFields:"RolID,NombreRol" });
        rolesFuncionalesTextos = (qDefRoles.features || []).map(f => {
            dictRoles.set(f.attributes.RolID, f.attributes.NombreRol);
            return String(f.attributes.NombreRol).trim().toUpperCase();
        });
    }
    
    // Si el RolID estaba guardado directamente como texto en la FK por error previo, lo rescatamos
    if(rolesFuncionalesTextos.length === 0 && qRolesAsignados.features.length > 0) {
        rolesFuncionalesTextos = (qRolesAsignados.features || []).map(f => String(f.attributes.RolID).trim().toUpperCase());
    }

    const validRoles = rolesFuncionalesTextos.filter(r => ["APROBADOR", "PUBLICADOR", "SUPERADMIN"].includes(r));
    if (validRoles.length === 0) throw new Error("Acceso denegado: Su rol no permite realizar aprobaciones o revisión.");

    // Cargar SEG_Alcance general
    const qAlc = await fetchJson(`${URL_ALCANCE}/query`, { f:"json", where:`PersonaID='${pInfo.PersonaID}' AND Activo='SI'`, outFields:"NivelJerarquia,ObjetoGlobalID,Permiso" });
    const alcanceList = (qAlc.features || []).map(f => f.attributes);

    currentUser = { gid: pInfo.GlobalID, pid: pInfo.PersonaID, nombre: pInfo.Nombre, correo, rolesFuncionales: validRoles, alcance: alcanceList };
    
    await postForm(`${URL_OTP}/applyEdits`, { f:"json", updates: [{attributes: {OBJECTID: otp.OBJECTID, Usado: "SI"}}] });
    await writeAuditEvent("LOGIN", "OTP_VALIDADO", "EXITO", "Ingreso exitoso al portal de Revisión V3");
    
    document.getElementById("login-overlay").style.display = "none";
    document.getElementById("pill-user").style.display = "block"; document.getElementById("pill-roles").style.display = "block";
    document.getElementById("pill-user").textContent = `Usuario: ${currentUser.nombre}`;
    document.getElementById("pill-roles").textContent = `Roles: ${validRoles.join(", ")}`;
    
    await preCargarFiltrosBase();
    await loadInbox();
  } catch(e) { document.getElementById("login-msg-2").textContent = e.message; }
});

// --- Cargas Maestras ---
async function preCargarFiltrosBase() {
    const qAct = await fetchJson(`${URL_CFG_ACTIVIDAD}/query`, { f:"json", where:"Activo='SI'", outFields:"GlobalID,ActividadID,NombreActividad,DependenciaResponsable" });
    (qAct.features || []).forEach(f => {
        const a = f.attributes; cacheActividades.set(a.GlobalID, a);
        if(a.DependenciaResponsable) cacheDependencias.add(a.DependenciaResponsable);
    });
    
    const selDep = document.getElementById("flt-dependencia");
    Array.from(cacheDependencias).sort().forEach(dep => {
        selDep.innerHTML += `<option value="${escapeHtml(dep)}">${escapeHtml(dep)}</option>`;
    });
}

// --- Bandeja Progresiva Enriquecida ---
async function loadInbox() {
    elInboxList.innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">Consultando solicitudes...</div>`;
    
    let w = `1=1`;
    if (fltVigencia.value) w += ` AND Vigencia=${fltVigencia.value}`;
    if (fltPeriodo.value) w += ` AND Periodo='${fltPeriodo.value}'`;
    
    if (fltEstado.value) { w += ` AND EstadoActual='${fltEstado.value}'`; }
    else if (!currentUser.rolesFuncionales.includes("SUPERADMIN")) {
        const estPermitidos = [];
        if(currentUser.rolesFuncionales.includes("APROBADOR")) estPermitidos.push("'Enviado'", "'EnRevision'", "'Devuelto'");
        if(currentUser.rolesFuncionales.includes("PUBLICADOR")) estPermitidos.push("'Aprobado'");
        if(estPermitidos.length > 0) w += ` AND EstadoActual IN (${estPermitidos.join(",")})`;
        else w += ` AND 1=0`; 
    } else { w += ` AND EstadoActual <> 'Borrador'`; }

    try {
        const qWf = await fetchJson(`${URL_WF_SOLICITUD}/query`, { f: "json", where: w, outFields: "*", orderByFields: "FechaSolicitud DESC" });
        const bases = (qWf.features || []).map(f => f.attributes);
        if(!bases.length) { elInboxList.innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">No hay registros pendientes.</div>`; return; }

        const gidsAvance = bases.filter(b=>b.TipoObjeto==='AvanceTarea').map(b=>`'${b.ObjetoGlobalID}'`).join(",");
        const gidsNarrativa = bases.filter(b=>b.TipoObjeto==='ReporteNarrativo').map(b=>`'${b.ObjetoGlobalID}'`).join(",");
        
        let mapAvances = new Map(), mapNarrativas = new Map();
        if(gidsAvance) {
            const qAv = await fetchJson(`${URL_AVANCE_TAREA}/query`, { f:"json", where:`GlobalID IN (${gidsAvance})`, outFields:"GlobalID,TareaGlobalID,Responsable,EstadoRegistro" });
            (qAv.features||[]).forEach(f=>mapAvances.set(f.attributes.GlobalID, f.attributes));
        }
        if(gidsNarrativa) {
            const qNa = await fetchJson(`${URL_NARRATIVA}/query`, { f:"json", where:`GlobalID IN (${gidsNarrativa})`, outFields:"GlobalID,ActividadGlobalID,Responsable,EstadoRegistro" });
            (qNa.features||[]).forEach(f=>mapNarrativas.set(f.attributes.GlobalID, f.attributes));
        }

        const tareasFaltantes = [...mapAvances.values()].map(a=>`'${a.TareaGlobalID}'`).join(",");
        let mapTareas = new Map();
        if(tareasFaltantes) {
            const qT = await fetchJson(`${URL_CFG_TAREA}/query`, { f:"json", where:`GlobalID IN (${tareasFaltantes})`, outFields:"GlobalID,SubActividadGlobalID" });
            const subActGids = (qT.features||[]).map(f=>`'${f.attributes.SubActividadGlobalID}'`).join(",");
            let mapSubActs = new Map();
            if(subActGids) {
                const qS = await fetchJson(`${URL_CFG_SUBACTIVIDAD}/query`, { f:"json", where:`GlobalID IN (${subActGids})`, outFields:"GlobalID,ActividadGlobalID" });
                (qS.features||[]).forEach(f=>mapSubActs.set(f.attributes.GlobalID, f.attributes.ActividadGlobalID));
            }
            (qT.features||[]).forEach(f=>mapTareas.set(f.attributes.GlobalID, mapSubActs.get(f.attributes.SubActividadGlobalID)));
        }

        listInboxEnriched = bases.map(b => {
            let actGid = null, resp = "Desconocido", estReal = b.EstadoActual;
            if(b.TipoObjeto === 'AvanceTarea') { const av = mapAvances.get(b.ObjetoGlobalID); if(av) { actGid = mapTareas.get(av.TareaGlobalID); resp = av.Responsable; estReal = av.EstadoRegistro; } }
            else { const na = mapNarrativas.get(b.ObjetoGlobalID); if(na) { actGid = na.ActividadGlobalID; resp = na.Responsable; estReal = na.EstadoRegistro; } }
            
            const actData = cacheActividades.get(actGid) || {};
            return { ...b, Dependencia: actData.DependenciaResponsable || "N/A", ActividadNombre: actData.NombreActividad || "N/A", ActividadGlobalID: actGid, Responsable: resp, EstadoActual: estReal };
        });

        renderInbox();
    } catch(e) { elInboxList.innerHTML = `<div class="msg-error">Error cargando bandeja: ${e.message}</div>`; }
}

function renderInbox() {
    elInboxList.innerHTML = "";
    const tFlt = fltTexto.value.toLowerCase().trim(), dFlt = fltDependencia.value;
    
    let filtradas = listInboxEnriched.filter(s => {
        if (dFlt && s.Dependencia !== dFlt) return false;
        if (tFlt && !(s.SolicitudID.toLowerCase().includes(tFlt) || s.ActividadNombre.toLowerCase().includes(tFlt) || s.Responsable.toLowerCase().includes(tFlt))) return false;
        return true;
    });

    if (!filtradas.length) { elInboxList.innerHTML = `<div class="muted" style="text-align:center; padding: 20px;">No hay registros con los filtros actuales.</div>`; return; }

    filtradas.forEach(sol => {
        const est = normalizeState(sol.EstadoActual), fDate = new Date(sol.FechaSolicitud).toLocaleDateString();
        const div = document.createElement("div"); div.className = "inbox-item"; div.dataset.gid = sol.GlobalID;
        div.innerHTML = `
            <div class="inbox-item__top">
                <span class="inbox-item__title">${sol.TipoObjeto === 'AvanceTarea' ? 'Avance Operativo' : 'Reporte Narrativo'}</span>
                ${getBadgeHtml(est)}
            </div>
            <div class="inbox-item__meta">
                <span><b>Sol ID:</b> <span class="mono">${sol.SolicitudID}</span></span>
                <span><b>Dep:</b> ${escapeHtml(sol.Dependencia)} | <b>Resp:</b> ${escapeHtml(sol.Responsable)}</span>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><b>Act:</b> ${escapeHtml(sol.ActividadNombre)}</span>
                <div style="margin-top:4px;">
                    <span class="meta-chip">${sol.Vigencia}-${sol.Periodo}</span>
                    <span class="meta-chip">V${sol.Version||1}</span>
                    <span class="meta-chip">${fDate}</span>
                </div>
            </div>`;
        div.addEventListener("click", () => selectItem(sol, div));
        elInboxList.appendChild(div);
    });
}

document.getElementById("btn-recargar-bandeja").addEventListener("click", loadInbox);
document.getElementById("btn-limpiar-filtros").addEventListener("click", () => {
    fltVigencia.value = new Date().getFullYear(); fltPeriodo.value = ""; fltEstado.value = ""; fltDependencia.value = ""; fltTexto.value = ""; loadInbox();
});

// --- Selección y Jerarquía ---
async function selectItem(solicitud, element) {
    if (isProcessing) return;
    document.querySelectorAll(".inbox-item").forEach(el => el.classList.remove("active")); if(element) element.classList.add("active");
    
    currentItem = solicitud;
    viewEmpty.style.display = "none"; viewContent.style.display = "flex";
    
    document.getElementById("det-subtitle").textContent = `Sol. ID: ${solicitud.SolicitudID}`;
    document.getElementById("det-badge-container").innerHTML = getBadgeHtml(solicitud.EstadoActual);
    
    document.getElementById("ctx-tipo").textContent = solicitud.TipoObjeto;
    document.getElementById("ctx-vigper").textContent = `${solicitud.Vigencia} / ${solicitud.Periodo}`;
    document.getElementById("ctx-resp").textContent = solicitud.Responsable;
    document.getElementById("ctx-dep").textContent = solicitud.Dependencia;
    document.getElementById("ctx-fecha").textContent = new Date(solicitud.FechaSolicitud).toLocaleString();
    document.getElementById("ctx-ver").textContent = solicitud.Version || "1";
    document.getElementById("ctx-solid").textContent = solicitud.SolicitudID;
    document.getElementById("ctx-gid").textContent = solicitud.ObjetoGlobalID;
    document.getElementById("ctx-hierarchy").innerHTML = `<span class="muted">Cargando jerarquía profunda...</span>`;

    ["section-tarea", "section-narrativa", "section-ubicaciones"].forEach(id => document.getElementById(id).style.display = "none");
    document.getElementById("txt-observacion-revision").value = ""; setStatusMsg("", "info");

    try {
        let actGidHier = solicitud.ActividadGlobalID;
        if (solicitud.TipoObjeto === "AvanceTarea") {
            const obj = await loadDetalleTarea(solicitud.ObjetoGlobalID);
            const qT = await fetchJson(`${URL_CFG_TAREA}/query`, { f:"json", where:`GlobalID='${obj.TareaGlobalID}'`, outFields:"SubActividadGlobalID" });
            if(qT.features.length) {
                currentItem.JerarquiaContext = { TareaGlobalID: obj.TareaGlobalID, SubActividadGlobalID: qT.features[0].attributes.SubActividadGlobalID };
                const qS = await fetchJson(`${URL_CFG_SUBACTIVIDAD}/query`, { f:"json", where:`GlobalID='${qT.features[0].attributes.SubActividadGlobalID}'`, outFields:"ActividadGlobalID" });
                if(qS.features.length) actGidHier = qS.features[0].attributes.ActividadGlobalID;
            }
        } else {
            await loadDetalleNarrativa(solicitud.ObjetoGlobalID);
            currentItem.JerarquiaContext = { ActividadGlobalID: actGidHier };
        }
        
        await renderHierarchy(actGidHier);
        configureButtonsByState(normalizeState(solicitud.EstadoActual));
        await loadTrazabilidad(solicitud);
    } catch(e) { setStatusMsg(`Error cargando detalle: ${e.message}`, "error"); }
}

// Autorización Dura por Herencia Jerárquica
function tienePermisoAlcance(permisoRequerido) {
    if (currentUser.rolesFuncionales.includes("SUPERADMIN")) return true;
    
    // Obtenemos todos los IDs de la cadena guardados durante el renderHierarchy y carga de detalle
    const h = currentItem.JerarquiaCompletaIds || {};
    const idsAValidar = [
        h.PACGlobalID, h.LineaGlobalID, h.ProgramaGlobalID, h.ProyectoGlobalID, 
        h.ObjetivoGlobalID, h.ActividadGlobalID, 
        (currentItem.JerarquiaContext||{}).SubActividadGlobalID, 
        (currentItem.JerarquiaContext||{}).TareaGlobalID, 
        currentItem.ObjetoGlobalID
    ].filter(Boolean);
    
    return currentUser.alcance.some(sc => 
        (sc.Permiso === permisoRequerido || sc.Permiso === "Administrar") &&
        (idsAValidar.includes(sc.ObjetoGlobalID))
    );
}

function configureButtonsByState(estado) {
    const bDev = document.getElementById("btn-devolver"), bApr = document.getElementById("btn-aprobar"), bPub = document.getElementById("btn-publicar"), tObs = document.getElementById("txt-observacion-revision");
    bDev.disabled = true; bApr.disabled = true; bPub.disabled = true; tObs.disabled = true;

    // Validación de alcance profundo
    const puedeRevisar = tienePermisoAlcance("Revisar") || tienePermisoAlcance("Aprobar");
    const puedePublicar = tienePermisoAlcance("Publicar");

    if (!puedeRevisar && !puedePublicar && !currentUser.rolesFuncionales.includes("SUPERADMIN")) {
        setStatusMsg("Vista de solo lectura: No tienes permisos de jurisdicción sobre este registro específico.", "info");
        return; 
    }

    if (["Enviado", "EnRevision"].includes(estado) && (puedeRevisar || currentUser.rolesFuncionales.includes("SUPERADMIN"))) {
        bDev.disabled = false; bApr.disabled = false; tObs.disabled = false;
    }
    if (estado === "Aprobado" && (puedePublicar || currentUser.rolesFuncionales.includes("SUPERADMIN"))) {
        bDev.disabled = false; bPub.disabled = false; tObs.disabled = false;
    }
}

async function renderHierarchy(actGid) {
    const elH = document.getElementById("ctx-hierarchy");
    currentItem.JerarquiaCompletaIds = {}; // Para la validación de alcance
    if(!actGid) { elH.innerHTML = `<span class="muted">Sin jerarquía superior.</span>`; return; }
    try {
        let hHtml = "";
        const qAct = await fetchJson(`${URL_CFG_ACTIVIDAD}/query`, { f:"json", where:`GlobalID='${actGid}'`, outFields:"ObjetivoGlobalID,NombreActividad" });
        if(!qAct.features.length) throw new Error("Actividad huérfana");
        const act = qAct.features[0].attributes; hHtml = `<div class="hier-level"><span class="hier-tag">Actividad</span><span class="hier-text">${escapeHtml(act.NombreActividad)}</span></div>` + hHtml;
        currentItem.JerarquiaCompletaIds.ActividadGlobalID = actGid;

        const qObj = await fetchJson(`${URL_CFG_OBJETIVO}/query`, { f:"json", where:`GlobalID='${act.ObjetivoGlobalID}'`, outFields:"ProyectoGlobalID,NombreObjetivo" });
        if(qObj.features.length) {
            const obj = qObj.features[0].attributes; hHtml = `<div class="hier-level"><span class="hier-tag">Objetivo</span><span class="hier-text">${escapeHtml(obj.NombreObjetivo)}</span></div>` + hHtml;
            currentItem.JerarquiaCompletaIds.ObjetivoGlobalID = act.ObjetivoGlobalID;

            const qProy = await fetchJson(`${URL_CFG_PROYECTO}/query`, { f:"json", where:`GlobalID='${obj.ProyectoGlobalID}'`, outFields:"ProgramaGlobalID,NombreProyecto" });
            if(qProy.features.length) {
                const proy = qProy.features[0].attributes; hHtml = `<div class="hier-level"><span class="hier-tag">Proyecto</span><span class="hier-text">${escapeHtml(proy.NombreProyecto)}</span></div>` + hHtml;
                currentItem.JerarquiaCompletaIds.ProyectoGlobalID = obj.ProyectoGlobalID;

                const qProg = await fetchJson(`${URL_CFG_PROGRAMA}/query`, { f:"json", where:`GlobalID='${proy.ProgramaGlobalID}'`, outFields:"LineaGlobalID,NombrePrograma" });
                if(qProg.features.length) {
                    const prog = qProg.features[0].attributes; hHtml = `<div class="hier-level"><span class="hier-tag">Programa</span><span class="hier-text">${escapeHtml(prog.NombrePrograma)}</span></div>` + hHtml;
                    currentItem.JerarquiaCompletaIds.ProgramaGlobalID = proy.ProgramaGlobalID;

                    const qLin = await fetchJson(`${URL_CFG_LINEA}/query`, { f:"json", where:`GlobalID='${prog.LineaGlobalID}'`, outFields:"PACGlobalID,NombreLinea" });
                    if(qLin.features.length) {
                        const lin = qLin.features[0].attributes; hHtml = `<div class="hier-level"><span class="hier-tag">Línea</span><span class="hier-text">${escapeHtml(lin.NombreLinea)}</span></div>` + hHtml;
                        currentItem.JerarquiaCompletaIds.LineaGlobalID = prog.LineaGlobalID;

                        const qPac = await fetchJson(`${URL_CFG_PAC}/query`, { f:"json", where:`GlobalID='${lin.PACGlobalID}'`, outFields:"NombrePAC" });
                        if(qPac.features.length) {
                            hHtml = `<div class="hier-level"><span class="hier-tag" style="background:var(--primary); color:#fff;">PAC</span><span class="hier-text">${escapeHtml(qPac.features[0].attributes.NombrePAC)}</span></div>` + hHtml;
                            currentItem.JerarquiaCompletaIds.PACGlobalID = lin.PACGlobalID;
                        }
                    }
                }
            }
        }
        elH.innerHTML = hHtml;
    } catch(e) { elH.innerHTML = `<span class="msg-error">No se pudo resolver jerarquía completa.</span>`; }
}

async function loadDetalleTarea(gid) {
    const q = await fetchJson(`${URL_AVANCE_TAREA}/query`, { f:"json", where:`GlobalID='${gid}'`, outFields:"*" });
    if (!q.features.length) throw new Error("Registro de Avance no encontrado.");
    const obj = q.features[0].attributes; currentItem.ObjBase = obj; currentItem.ObjType = "REP_AvanceTarea";

    document.getElementById("section-tarea").style.display = "block";
    document.getElementById("tar-valor").textContent = obj.ValorReportado ?? "N/A";
    document.getElementById("tar-obs").textContent = obj.Observaciones || "Sin observaciones operativas.";
    document.getElementById("tar-motivo").textContent = obj.MotivoAjuste || "N/A";
    
    const eviLnk = document.getElementById("tar-evi");
    if(obj.EvidenciaURL) { eviLnk.href = obj.EvidenciaURL; eviLnk.textContent = obj.EvidenciaURL; eviLnk.style.display="inline"; }
    else { eviLnk.style.display="none"; }

    const qUb = await fetchJson(`${URL_TAREA_UBICACION}/query`, { f:"json", where:`AvanceTareaGlobalID='${gid}'`, outFields:"*" });
    if((qUb.features || []).length > 0) {
        document.getElementById("section-ubicaciones").style.display = "block";
        document.getElementById("list-ubicaciones").innerHTML = qUb.features.map(u => `<div class="loc-item"><div class="loc-item__desc">📍 ${escapeHtml(u.attributes.DescripcionSitio || "Sin descripción")}</div><div><b>Mun:</b> ${escapeHtml(u.attributes.MunicipioNombre)}</div><div><b>DANE:</b> ${escapeHtml(u.attributes.CodigoDANE)}</div></div>`).join("");
    }
    return obj;
}

async function loadDetalleNarrativa(gid) {
    const q = await fetchJson(`${URL_NARRATIVA}/query`, { f:"json", where:`GlobalID='${gid}'`, outFields:"*" });
    if (!q.features.length) throw new Error("Registro Narrativo no encontrado.");
    const obj = q.features[0].attributes; currentItem.ObjBase = obj; currentItem.ObjType = "REP_ReporteNarrativo";
    document.getElementById("section-narrativa").style.display = "block";
    document.getElementById("nar-txt1").textContent = obj.TextoNarrativo || "N/A";
    document.getElementById("nar-txt2").textContent = obj.DescripcionLogrosAlcanzados || "N/A";
    document.getElementById("nar-txt3").textContent = obj.PrincipalesLogros || "N/A";
    document.getElementById("nar-motivo").textContent = obj.MotivoAjuste || "N/A";
    return obj;
}

async function resolverNombrePersona(personaId) {
    if(!personaId) return "Sistema";
    if(dictPersonas.has(personaId)) return dictPersonas.get(personaId);
    try {
        const q = await fetchJson(`${URL_PERSONA}/query`, { f:"json", where:`PersonaID='${personaId}'`, outFields:"Nombre" });
        const nombre = q.features.length ? q.features[0].attributes.Nombre : personaId;
        dictPersonas.set(personaId, nombre);
        return nombre;
    } catch(e) { return personaId; }
}

// Trazabilidad 360 (Unificada WF + AUD + Evento Base)
async function loadTrazabilidad(solicitudObj) {
    const list = document.getElementById("list-trazabilidad"); list.innerHTML = `<span class="muted">Cargando histórico integral...</span>`;
    try {
        const solId = solicitudObj.SolicitudID;
        const objGid = solicitudObj.ObjetoGlobalID;

        const qWf = await fetchJson(`${URL_WF_PASO}/query`, { f:"json", where:`SolicitudID='${solId}'`, outFields:"*", orderByFields:"FechaDecision DESC" });
        const qAudH = await fetchJson(`${URL_AUD_HISTORIAL}/query`, { f:"json", where:`ObjetoGlobalID='${objGid}'`, outFields:"*", orderByFields:"FechaCambio DESC" });
        const qAudE = await fetchJson(`${URL_AUD_EVENTO}/query`, { f:"json", where:`Detalle LIKE '%${objGid}%'`, outFields:"*", orderByFields:"FechaEvento DESC" });
        
        let combinados = [];
        
        // 1. Evento Base (Creación de la solicitud) extraído directamente del registro actual WF_SolicitudRevision
        if(solicitudObj.FechaSolicitud) {
            combinados.push({ 
                t: solicitudObj.FechaSolicitud, 
                tipo: 'WF-BASE', 
                titulo: `Solicitud Creada/Enviada`, 
                desc: solicitudObj.ComentarioSolicitante || "Inicia flujo de revisión", 
                userId: solicitudObj.PersonaSolicitaID || "Operador" 
            });
        }

        // 2. Pasos de Aprobación
        for (let f of (qWf.features || [])) {
            const a = f.attributes;
            combinados.push({ t: a.FechaDecision, tipo: 'WF', titulo: `Paso: ${a.EstadoPaso || 'Finalizado'} - Decisión: ${a.Decision}`, desc: a.ObservacionDecision, userId: a.PersonaResponsableID });
            // Guardamos el máximo OrdenPaso para la lógica de inserción
            if(currentItem) currentItem.MaxOrdenPaso = Math.max(currentItem.MaxOrdenPaso || 0, a.OrdenPaso || 0);
        }

        // 3. Historial de Auditoría
        for (let f of (qAudH.features || [])) {
            const a = f.attributes;
            combinados.push({ t: a.FechaCambio, tipo: 'AUD-H', titulo: `Edición de Dato: ${a.CampoModificado}`, desc: `De: [${a.ValorAnterior}] a [${a.ValorNuevo}]`, userId: a.PersonaID });
        }

        // 4. Eventos de Sistema
        for (let f of (qAudE.features || [])) {
            const a = f.attributes;
            combinados.push({ t: a.FechaEvento, tipo: 'AUD-E', titulo: `Sistema: ${a.Evento}`, desc: a.Detalle, userId: a.PersonaID });
        }
        
        combinados.sort((a,b) => b.t - a.t);
        if (!combinados.length) { list.innerHTML = `<span class="muted">No hay histórico registrado.</span>`; return; }
        
        for(let c of combinados) { c.userNombre = await resolverNombrePersona(c.userId); }

        list.innerHTML = combinados.map(c => `
            <div class="traz-item">
                <div class="traz-item__top"><span class="traz-type ${c.tipo.toLowerCase()}">${c.tipo}</span> <span>${new Date(c.t).toLocaleString()}</span></div>
                <div style="margin-top:4px;"><b>${escapeHtml(c.titulo)}</b> <span class="muted">(Usr: ${escapeHtml(c.userNombre)})</span></div>
                ${c.desc ? `<div class="traz-item__obs">${escapeHtml(c.desc)}</div>` : ''}
            </div>`).join("");
    } catch(e) { list.innerHTML = `<span class="msg-error">Error al cargar trazabilidad integral.</span>`; }
}

document.getElementById("btn-refrescar-traz").addEventListener("click", () => { if(currentItem) loadTrazabilidad(currentItem); });

// --- Transiciones de Flujo ---
document.getElementById("btn-devolver").addEventListener("click", () => processWorkflowAction("Devuelto"));
document.getElementById("btn-aprobar").addEventListener("click", () => processWorkflowAction("Aprobado"));
document.getElementById("btn-publicar").addEventListener("click", () => processWorkflowAction("Publicado"));

async function processWorkflowAction(nuevoEstado) {
    if (!currentItem) return;
    const obs = document.getElementById("txt-observacion-revision").value.trim();
    if (nuevoEstado === "Devuelto" && !obs) { setStatusMsg("La observación es OBLIGATORIA para devolver un registro.", "error"); document.getElementById("txt-observacion-revision").focus(); return; }
    if (!confirm(`¿Confirmas la decisión: ${nuevoEstado}?`)) return;

    isProcessing = true; document.querySelectorAll(".review-actions .btn").forEach(b => b.disabled = true);
    setStatusMsg(`Procesando decisión (${nuevoEstado})...`, "info");

    try {
        const urlBase = currentItem.ObjType === "REP_AvanceTarea" ? URL_AVANCE_TAREA : URL_NARRATIVA;
        
        await postForm(`${urlBase}/applyEdits`, { f:"json", updates: [{ attributes: { OBJECTID: currentItem.ObjBase.OBJECTID, EstadoRegistro: nuevoEstado } }] });
        await postForm(`${URL_WF_SOLICITUD}/applyEdits`, { f:"json", updates: [{ attributes: { OBJECTID: currentItem.OBJECTID, EstadoActual: nuevoEstado } }] });

        // Identificación del Rol Real para el Paso
        let rolRealPaso = "Aprobador";
        if(nuevoEstado === "Publicado") rolRealPaso = "Publicador";
        else if(currentUser.rolesFuncionales.includes("SUPERADMIN")) rolRealPaso = "SuperAdmin";
        
        const siguienteOrden = (currentItem.MaxOrdenPaso || 0) + 1;

        const addPaso = { attributes: { 
            PasoID: generateGUID(), 
            SolicitudID: currentItem.SolicitudID, 
            OrdenPaso: siguienteOrden, 
            RolResponsable: rolRealPaso, 
            PersonaResponsableID: currentUser.pid, 
            EstadoPaso: "Cerrado",
            FechaAsignacion: Date.now(), 
            FechaDecision: Date.now(), 
            Decision: nuevoEstado, 
            ObservacionDecision: obs 
        }};
        await postForm(`${URL_WF_PASO}/applyEdits`, { f:"json", adds: [addPaso] });

        await writeAuditEvent("REVISION_APP", `ACCION_${nuevoEstado.toUpperCase()}`, "EXITO", `Registro ${currentItem.ObjetoGlobalID} evaluado. Obs: ${obs}`);
        if (nuevoEstado === "Devuelto" || nuevoEstado === "Aprobado" || nuevoEstado === "Publicado") {
            await writeAuditHistory(currentItem.ObjType, currentItem.ObjBase.OBJECTID, currentItem.ObjetoGlobalID, "EstadoRegistro", currentItem.EstadoActual, nuevoEstado, obs);
        }

        setStatusMsg(`Decisión registrada: ${nuevoEstado}`, "success");
        
        currentItem.EstadoActual = nuevoEstado;
        document.getElementById("det-badge-container").innerHTML = getBadgeHtml(nuevoEstado);
        configureButtonsByState(nuevoEstado);
        document.getElementById("txt-observacion-revision").value = "";
        loadTrazabilidad(currentItem);
        
        const activeCard = document.querySelector(`.inbox-item[data-gid="${currentItem.GlobalID}"]`);
        if(activeCard) {
            const topDiv = activeCard.querySelector('.inbox-item__top');
            if(topDiv) { topDiv.innerHTML = `<span class="inbox-item__title">${currentItem.TipoObjeto === 'AvanceTarea' ? 'Avance Operativo' : 'Reporte Narrativo'}</span> ${getBadgeHtml(nuevoEstado)}`; }
        }
        
        setTimeout(loadInbox, 1500);

    } catch(e) { setStatusMsg(`Error procesando flujo: ${e.message}`, "error"); configureButtonsByState(normalizeState(currentItem.EstadoActual)); } 
    finally { isProcessing = false; }
}