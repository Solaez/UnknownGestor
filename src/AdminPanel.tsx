import React, { useState, useEffect } from "react";
import type { App, DownloadEntry } from "./data/apps";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Rom { id:string;title:string;region:string;size:string;rating:number;year:number;genre:string;players:string;description:string;developer:string;downloadUrl:string;downloads?:DownloadEntry[];coverUrl:string;screenshots:string[];videoId:string;instructions:string[]; }
interface Console { id:string;name:string;shortName:string;gradient:string;logoText:string;description:string;emulator:string;fileExtensions:string[];romCount:number;roms:Rom[]; }

// ─── Storage keys ────────────────────────────────────────────────────────────
const CUSTOM_APPS_KEY = 'appstore-custom-apps';
const CUSTOM_ROMS_KEY = 'appstore-custom-roms';
const HIDDEN_APPS_KEY = 'appstore-hidden-apps';
const HIDDEN_ROMS_KEY = 'appstore-hidden-roms';
const EXTRA_ROMS_KEY  = 'appstore-extra-roms';

export function loadCustomApps(): App[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_APPS_KEY) || '[]'); } catch { return []; }
}
export function loadCustomConsoles(): Console[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_ROMS_KEY) || '[]'); } catch { return []; }
}
export function loadHiddenAppIds(): number[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_APPS_KEY) || '[]'); } catch { return []; }
}
export function loadHiddenRomIds(): string[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_ROMS_KEY) || '[]'); } catch { return []; }
}
export type ExtraRoms = Record<string, Rom[]>;
export function loadExtraRoms(): ExtraRoms {
  try { return JSON.parse(localStorage.getItem(EXTRA_ROMS_KEY) || '{}'); } catch { return {}; }
}
function saveCustomApps(apps: App[]) { localStorage.setItem(CUSTOM_APPS_KEY, JSON.stringify(apps)); }
function saveCustomConsoles(consoles: Console[]) { localStorage.setItem(CUSTOM_ROMS_KEY, JSON.stringify(consoles)); }
function saveHiddenAppIds(ids: number[]) { localStorage.setItem(HIDDEN_APPS_KEY, JSON.stringify(ids)); }
function saveHiddenRomIds(ids: string[]) { localStorage.setItem(HIDDEN_ROMS_KEY, JSON.stringify(ids)); }
function saveExtraRoms(extra: ExtraRoms) { localStorage.setItem(EXTRA_ROMS_KEY, JSON.stringify(extra)); }

const ROM_OVERRIDES_KEY = 'appstore-rom-overrides';
type RomOverrides = Record<string, Rom>;
export function loadRomOverrides(): RomOverrides {
  try { return JSON.parse(localStorage.getItem(ROM_OVERRIDES_KEY) || '{}'); } catch { return {}; }
}
function saveRomOverrides(overrides: RomOverrides) { localStorage.setItem(ROM_OVERRIDES_KEY, JSON.stringify(overrides)); }

// --- File System (Electron) ---
const fs = (window as any).require ? (window as any).require('fs') : null;
const path = (window as any).require ? (window as any).require('path') : null;

function saveToJson(filename: string, data: any) {
  if (!fs || !path) {
    console.warn("FS no disponible, solo se guardará en localStorage");
    return;
  }
  try {
    // Intentamos obtener la ruta del proyecto. 
    // En desarrollo con Electron y Vite, process.cwd() suele ser la raíz del proyecto.
    const filePath = path.join(process.cwd(), 'public', filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Guardado exitoso en: ${filePath}`);
  } catch (err) {
    console.error(`Error guardando ${filename}:`, err);
  }
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label:string; hint?:string; children:React.ReactNode }) {
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
      <label style={{ fontSize:12,fontWeight:600,color:'rgba(255,255,255,.5)',textTransform:'uppercase',letterSpacing:'.06em' }}>{label}</label>
      {children}
      {hint&&<span style={{ fontSize:11,color:'rgba(255,255,255,.3)' }}>{hint}</span>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background:'rgba(255,255,255,.06)',
  border:'1px solid rgba(255,255,255,.1)',
  borderRadius:'.625rem',
  color:'white',
  padding:'9px 13px',
  fontSize:13,
  outline:'none',
  width:'100%',
  fontFamily:'Inter,system-ui,sans-serif',
  transition:'border-color .15s',
};

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{ ...inputStyle,...props.style }}
      onFocus={e=>(e.target as HTMLInputElement).style.borderColor='hsl(var(--primary)/.6)'}
      onBlur={e=>(e.target as HTMLInputElement).style.borderColor='rgba(255,255,255,.1)'}/>
  );
}
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} style={{ ...inputStyle,resize:'vertical',minHeight:70,...props.style as React.CSSProperties }}
      onFocus={e=>(e.target as HTMLTextAreaElement).style.borderColor='hsl(var(--primary)/.6)'}
      onBlur={e=>(e.target as HTMLTextAreaElement).style.borderColor='rgba(255,255,255,.1)'}/>
  );
}
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{ ...inputStyle,...props.style as React.CSSProperties }}>
      {props.children}
    </select>
  );
}

const CATEGORY_OPTIONS = ['Programas','Drivers','Juegos','Desarrollos','Diseño','Emuladores','Proyectos'] as const;
const ICON_PRESETS = ['🚀','⚙️','🎮','🖼️','🎵','💾','📦','📄','🕹️','💻','🔧','🎨','🐬','🎯','⚡','🌐','🛠️','🔒','📱','🎬'];
const GRADIENT_PRESETS = [
  { label:'Rojo', value:'linear-gradient(135deg,#e52d6a,#f97316)' },
  { label:'Azul', value:'linear-gradient(135deg,#1e3a8a,#3b82f6)' },
  { label:'Verde', value:'linear-gradient(135deg,#14532d,#22c55e)' },
  { label:'Morado', value:'linear-gradient(135deg,#4c1d95,#8b5cf6)' },
  { label:'Naranja', value:'linear-gradient(135deg,#92400e,#f59e0b)' },
  { label:'Rosa', value:'linear-gradient(135deg,#9d174d,#ec4899)' },
  { label:'Cian', value:'linear-gradient(135deg,#164e63,#06b6d4)' },
  { label:'Gris', value:'linear-gradient(135deg,#1e293b,#475569)' },
];

// ─── Program Form ─────────────────────────────────────────────────────────────
const EMPTY_APP = (): Partial<App> => ({
  name:'', category:'Programas', description:'', version:'1.0.0', size:'', downloadUrl:'',
  instructions:[], color:'#6366f1', icon:'🚀', isNew:true, tags:[], developer:'',
  publisher:'', rating:8.0, reviews:0, language:'Español', releaseDate:'', platform:'Windows 10, 11',
  videoId:'', screenshots:[], coverUrl:'',
});

function AppForm({ onSave, onCancel, initialData }: { onSave:(app:App)=>void; onCancel:()=>void; initialData?:App }) {
  const [form, setForm] = useState<Partial<App>>(initialData ?? EMPTY_APP());
  const [instructionsText, setInstructionsText] = useState(initialData?.instructions?.join('\n') ?? '');
  const [tagsText, setTagsText] = useState(initialData?.tags?.join(', ') ?? '');
  const [screenshotUrls, setScreenshotUrls] = useState<string[]>(initialData?.screenshots?.length ? initialData.screenshots : ['']);
  const [customIconText, setCustomIconText] = useState('');
  const [dlEntries, setDlEntries] = useState<DownloadEntry[]>(initialData?.downloads ?? []);
  const [step, setStep] = useState(0);
  const isEdit = !!initialData;

  const set = (k: keyof App, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  function handleSave() {
    if (!form.name || !form.downloadUrl) return;
    const app: App = {
      id: initialData?.id ?? Date.now(),
      name: form.name!,
      category: form.category || 'Programas',
      description: form.description || '',
      version: form.version || '1.0',
      size: form.size || '—',
      downloadUrl: form.downloadUrl!,
      downloads: dlEntries.filter(e=>e.label&&e.url).length > 0 ? dlEntries.filter(e=>e.label&&e.url) : undefined,
      instructions: instructionsText.split('\n').filter(Boolean),
      color: form.color || '#6366f1',
      icon: form.icon || '🚀',
      isNew: form.isNew ?? true,
      tags: tagsText.split(',').map(t=>t.trim()).filter(Boolean),
      developer: form.developer || 'Desconocido',
      publisher: form.publisher || 'Desconocido',
      rating: Number(form.rating) || 8.0,
      reviews: Number(form.reviews) || 0,
      language: form.language || 'Español',
      releaseDate: form.releaseDate || new Date().toLocaleDateString('es-ES'),
      platform: form.platform || 'Windows 10, 11',
      videoId: form.videoId || '',
      screenshots: screenshotUrls.filter(u => u.trim() !== ''),
      coverUrl: form.coverUrl || '',
    };
    onSave(app);
  }

  function addAppDlEntry() { setDlEntries(p=>[...p,{label:'',url:'',size:'',type:'version' as const}]); }
  function removeAppDlEntry(i:number) { setDlEntries(p=>p.filter((_,j)=>j!==i)); }
  function updateAppDlEntry(i:number, k:keyof DownloadEntry, v:string) { setDlEntries(p=>p.map((e,j)=>j===i?{...e,[k]:v}:e)); }

  const steps = ['Básico','Detalles','Media','Descarga'];

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%' }}>
      {/* Step tabs */}
      <div style={{ display:'flex',gap:0,marginBottom:24,background:'rgba(255,255,255,.04)',borderRadius:'2rem',padding:3,border:'1px solid rgba(255,255,255,.08)' }}>
        {steps.map((s,i) => (
          <button key={s} onClick={()=>setStep(i)}
            style={{ flex:1,border:'none',borderRadius:'2rem',padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:step===i?'hsl(var(--primary))':'transparent',
              color:step===i?'white':'rgba(255,255,255,.45)',transition:'all .15s' }}>
            {i+1}. {s}
          </button>
        ))}
      </div>

      <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:16 }}>
        {step===0&&(
          <>
            {/* Icon + color picker */}
            <div style={{ display:'flex',gap:12,alignItems:'flex-end' }}>
              <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                <label style={{ fontSize:12,fontWeight:600,color:'rgba(255,255,255,.5)',textTransform:'uppercase',letterSpacing:'.06em' }}>Ícono</label>
                <div style={{ display:'flex',gap:6,flexWrap:'wrap',maxWidth:220 }}>
                  {ICON_PRESETS.map(ic=>(
                    <button key={ic} onClick={()=>set('icon',ic)}
                      style={{ width:34,height:34,borderRadius:'.5rem',border:`2px solid ${form.icon===ic?'hsl(var(--primary))':'rgba(255,255,255,.1)'}`,background:form.icon===ic?'hsl(var(--primary)/.2)':'rgba(255,255,255,.04)',cursor:'pointer',fontSize:'1.1rem',transition:'all .1s' }}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ flex:1 }}>
                {/* Preview card */}
                <div style={{ width:'100%',borderRadius:'.875rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.03)' }}>
                  <div style={{ height:90,background:`linear-gradient(135deg,${form.color}bb,${form.color}44 60%,#0a0a1a)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2.5rem' }}>{form.icon}</div>
                  <div style={{ padding:'8px 12px',fontSize:13,fontWeight:600 }}>{form.name||'Nombre del programa'}</div>
                </div>
              </div>
            </div>

            <Field label="Color de acento">
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <input type="color" value={form.color} onChange={e=>set('color',e.target.value)}
                  style={{ width:42,height:38,border:'none',borderRadius:'.5rem',cursor:'pointer',background:'transparent',padding:0 }}/>
                <span style={{ fontSize:12,color:'rgba(255,255,255,.4)' }}>{form.color}</span>
              </div>
            </Field>

            <Field label="Nombre *">
              <Input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Ej: Visual Studio Code"/>
            </Field>
            <Field label="Categoría">
              <Select value={form.category} onChange={e=>set('category',e.target.value as App['category'])}>
                {CATEGORY_OPTIONS.map(c=><option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Descripción" hint="Breve descripción del programa">
              <Textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe el programa..."/>
            </Field>
            <div style={{ display:'flex',gap:10 }}>
              <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13 }}>
                <div onClick={()=>set('isNew',!form.isNew)}
                  style={{ width:40,height:22,borderRadius:11,background:form.isNew?'hsl(var(--primary))':'rgba(255,255,255,.1)',border:'none',cursor:'pointer',position:'relative',transition:'background .15s' }}>
                  <div style={{ width:18,height:18,borderRadius:'50%',background:'white',position:'absolute',top:2,left:form.isNew?20:2,transition:'left .15s' }}/>
                </div>
                <span style={{ color:'rgba(255,255,255,.65)' }}>Marcar como Nuevo</span>
              </label>
            </div>
          </>
        )}

        {step===1&&(
          <>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              <Field label="Versión">
                <Input value={form.version} onChange={e=>set('version',e.target.value)} placeholder="1.0.0"/>
              </Field>
              <Field label="Tamaño">
                <Input value={form.size} onChange={e=>set('size',e.target.value)} placeholder="Ej: 80 MB"/>
              </Field>
              <Field label="Desarrollador">
                <Input value={form.developer} onChange={e=>set('developer',e.target.value)} placeholder="Ej: Microsoft"/>
              </Field>
              <Field label="Editor / Publisher">
                <Input value={form.publisher} onChange={e=>set('publisher',e.target.value)} placeholder="Ej: Microsoft"/>
              </Field>
              <Field label="Idioma">
                <Input value={form.language} onChange={e=>set('language',e.target.value)} placeholder="Ej: Español"/>
              </Field>
              <Field label="Plataforma">
                <Input value={form.platform} onChange={e=>set('platform',e.target.value)} placeholder="Windows 10, 11"/>
              </Field>
              <Field label="Fecha de lanzamiento">
                <Input value={form.releaseDate} onChange={e=>set('releaseDate',e.target.value)} placeholder="Ej: 01 Ene, 2024"/>
              </Field>
              <Field label="Rating (0-10)">
                <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                  <input type="range" min={0} max={10} step={0.1} value={form.rating} onChange={e=>set('rating',parseFloat(e.target.value))} style={{ flex:1,accentColor:'hsl(var(--primary))' }}/>
                  <span style={{ fontSize:13,fontWeight:700,color:'#f59e0b',minWidth:28 }}>{Number(form.rating).toFixed(1)}</span>
                </div>
              </Field>
            </div>
            <Field label="Tags" hint="Separados por comas: editor, código, ide">
              <Input value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="editor, código, gratuito"/>
            </Field>
          </>
        )}

        {/* ── STEP 2: MEDIA ── */}
        {step===2&&(
          <>
            {/* Custom icon */}
            <Field label="Ícono personalizado" hint="Escribe cualquier emoji directamente">
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <Input value={customIconText||form.icon} onChange={e=>{ setCustomIconText(e.target.value); if(e.target.value) set('icon', e.target.value); }} placeholder="🚀 o cualquier emoji" style={{ maxWidth:160 }}/>
                <span style={{ fontSize:'2rem' }}>{form.icon}</span>
              </div>
              <div style={{ display:'flex',gap:6,flexWrap:'wrap',marginTop:8 }}>
                {ICON_PRESETS.map(ic=>(
                  <button key={ic} onClick={()=>{ set('icon',ic); setCustomIconText(''); }}
                    style={{ width:34,height:34,borderRadius:'.5rem',border:`2px solid ${form.icon===ic?'hsl(var(--primary))':'rgba(255,255,255,.1)'}`,background:form.icon===ic?'hsl(var(--primary)/.2)':'rgba(255,255,255,.04)',cursor:'pointer',fontSize:'1.1rem',transition:'all .1s' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </Field>

            {/* Cover image */}
            <Field label="Imagen de portada (URL)" hint="URL directa a una imagen JPG, PNG o WebP">
              <Input type="url" value={form.coverUrl||''} onChange={e=>set('coverUrl',e.target.value)} placeholder="https://ejemplo.com/portada.jpg"/>
              {form.coverUrl&&(
                <div style={{ marginTop:8,borderRadius:'.75rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.1)',height:140,background:'#0a0a14' }}>
                  <img src={form.coverUrl} alt="Portada" style={{ width:'100%',height:'100%',objectFit:'cover' }}
                    onError={e=>{ (e.target as HTMLImageElement).style.display='none'; }}/>
                </div>
              )}
            </Field>

            {/* Video YouTube */}
            <Field label="Video de YouTube (ID)" hint="Solo el ID del video, ej: KMxo3T_MTvY">
              <Input value={form.videoId||''} onChange={e=>set('videoId',e.target.value)} placeholder="KMxo3T_MTvY"/>
              {form.videoId&&(
                <div style={{ marginTop:8,borderRadius:'.75rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.1)',aspectRatio:'16/9',background:'#0a0a14' }}>
                  <iframe src={`https://www.youtube.com/embed/${form.videoId}?rel=0&modestbranding=1`} title="preview" allowFullScreen style={{ width:'100%',height:'100%',border:'none' }}/>
                </div>
              )}
            </Field>

            {/* Screenshots */}
            <Field label="Capturas de pantalla" hint="URL directa a cada imagen (JPG, PNG, WebP)">
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {screenshotUrls.map((url,i)=>(
                  <div key={i} style={{ display:'flex',flexDirection:'column',gap:6 }}>
                    <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                      <Input type="url" value={url} onChange={e=>{ const u=[...screenshotUrls]; u[i]=e.target.value; setScreenshotUrls(u); }} placeholder={`https://ejemplo.com/captura${i+1}.jpg`}/>
                      {screenshotUrls.length>1&&(
                        <button onClick={()=>setScreenshotUrls(p=>p.filter((_,j)=>j!==i))}
                          style={{ width:30,height:30,flexShrink:0,borderRadius:'50%',background:'rgba(239,68,68,.15)',border:'1px solid rgba(239,68,68,.3)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14 }}>✕</button>
                      )}
                    </div>
                    {url&&(
                      <div style={{ borderRadius:'.625rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.08)',height:100,background:'#0a0a14' }}>
                        <img src={url} alt={`Captura ${i+1}`} style={{ width:'100%',height:'100%',objectFit:'cover' }}
                          onError={e=>{ (e.target as HTMLImageElement).style.display='none'; }}/>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={()=>setScreenshotUrls(p=>[...p,''])}
                  style={{ background:'rgba(255,255,255,.05)',border:'1px dashed rgba(255,255,255,.15)',borderRadius:'.625rem',padding:'8px',color:'rgba(255,255,255,.4)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
                  + Agregar captura
                </button>
              </div>
            </Field>
          </>
        )}

        {step===3&&(
          <>
            <Field label="URL de descarga principal *" hint="Enlace directo al instalador o página oficial">
              <Input type="url" value={form.downloadUrl} onChange={e=>set('downloadUrl',e.target.value)} placeholder="https://ejemplo.com/descarga"/>
            </Field>
            <Field label="Descargas múltiples" hint="Opcional — agrega versiones, paquetes requeridos u otras variantes">
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {dlEntries.map((entry,i)=>(
                  <div key={i} style={{ display:'flex',flexDirection:'column',gap:6,padding:'10px 12px',background:'rgba(255,255,255,.04)',borderRadius:'.75rem',border:'1px solid rgba(255,255,255,.1)' }}>
                    <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                      <Input value={entry.label} onChange={e=>updateAppDlEntry(i,'label',e.target.value)} placeholder="Nombre (ej: Versión 2022 x64)" style={{ flex:2 }}/>
                      <select value={entry.type||'version'} onChange={e=>updateAppDlEntry(i,'type',e.target.value)}
                        style={{ flex:1,background:'hsl(230 22% 18%)',border:'1px solid rgba(255,255,255,.12)',borderRadius:'.5rem',padding:'8px 10px',color:'white',fontSize:12,fontFamily:'inherit',cursor:'pointer' }}>
                        <option value="version">📦 Versión</option>
                        <option value="required">⚙️ Requerido</option>
                        <option value="base">🎮 Base</option>
                        <option value="update">🔄 Actualización</option>
                        <option value="dlc">🎁 DLC</option>
                        <option value="other">⬇️ Otro</option>
                      </select>
                      <button onClick={()=>removeAppDlEntry(i)} style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.15)',border:'1px solid rgba(239,68,68,.3)',color:'#f87171',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>✕</button>
                    </div>
                    <Input type="url" value={entry.url} onChange={e=>updateAppDlEntry(i,'url',e.target.value)} placeholder="https://..."/>
                    <Input value={entry.size||''} onChange={e=>updateAppDlEntry(i,'size',e.target.value)} placeholder="Tamaño (ej: 24 MB)"/>
                  </div>
                ))}
                <button onClick={addAppDlEntry} style={{ background:'rgba(255,255,255,.05)',border:'1px dashed rgba(255,255,255,.15)',borderRadius:'.625rem',padding:'8px',color:'rgba(255,255,255,.5)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
                  + Agregar descarga
                </button>
              </div>
            </Field>
            <Field label="Instrucciones de instalación" hint="Una instrucción por línea">
              <Textarea value={instructionsText} onChange={e=>setInstructionsText(e.target.value)}
                placeholder={`Descargar el instalador\nEjecutar como administrador\nSeguir los pasos del asistente`} rows={5}/>
            </Field>
            <div style={{ background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'.875rem',padding:'14px 16px' }}>
              <div style={{ fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,.3)',marginBottom:10 }}>Resumen</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:12 }}>
                {[['Nombre',form.name||'—'],['Categoría',form.category||'—'],['Versión',form.version||'—'],['Tamaño',form.size||'—'],['Desarrollador',form.developer||'—'],['Rating',`${form.rating}/10`],['Portada',form.coverUrl?'Sí':'No'],['Descargas',dlEntries.filter(e=>e.label&&e.url).length>0?`${dlEntries.filter(e=>e.label&&e.url).length} extras`:'—']].map(([k,v])=>(
                  <div key={k}><span style={{ color:'rgba(255,255,255,.35)' }}>{k}: </span><span style={{ color:'white',fontWeight:500 }}>{v}</span></div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display:'flex',gap:10,marginTop:20,paddingTop:16,borderTop:'1px solid rgba(255,255,255,.08)',flexShrink:0 }}>
        <button onClick={onCancel} style={{ flex:1,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'10px',color:'rgba(255,255,255,.6)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
          Cancelar
        </button>
        {step>0&&(
          <button onClick={()=>setStep(s=>s-1)} style={{ flex:1,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'10px',color:'rgba(255,255,255,.6)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
            ← Anterior
          </button>
        )}
        {step<3 ? (
          <button onClick={()=>setStep(s=>s+1)} style={{ flex:2,background:'hsl(var(--primary))',border:'none',borderRadius:'.875rem',padding:'10px 20px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700 }}>
            Siguiente →
          </button>
        ) : (
          <button onClick={handleSave} disabled={!form.name||!form.downloadUrl}
            style={{ flex:2,background:(!form.name||!form.downloadUrl)?'rgba(255,255,255,.08)':'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',border:'none',borderRadius:'.875rem',padding:'10px 20px',color:(!form.name||!form.downloadUrl)?'rgba(255,255,255,.3)':'white',cursor:(!form.name||!form.downloadUrl)?'not-allowed':'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700,transition:'opacity .15s' }}>
            ✓ {isEdit ? 'Guardar cambios' : 'Guardar programa'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ROM / Console Form ───────────────────────────────────────────────────────
const EMPTY_CONSOLE = (): Partial<Console> => ({
  id:'', name:'', shortName:'', gradient: GRADIENT_PRESETS[0].value, logoText:'',
  description:'', emulator:'', fileExtensions:[], romCount:0, roms:[],
});
const EMPTY_ROM = (): Partial<Rom> => ({
  id:'', title:'', region:'EUR', size:'', rating:4, year:new Date().getFullYear(),
  genre:'Acción', players:'1', description:'', developer:'', downloadUrl:'',
  coverUrl:'', screenshots:[], videoId:'', instructions:[],
});

function ConsoleForm({ onSave, onCancel }: { onSave:(c:Console)=>void; onCancel:()=>void }) {
  const [form, setForm] = useState<Partial<Console>>(EMPTY_CONSOLE());
  const [extText, setExtText] = useState('');
  const set = (k: keyof Console, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  function handleSave() {
    if (!form.name || !form.emulator) return;
    const c: Console = {
      id: `custom-${Date.now()}`,
      name: form.name!,
      shortName: form.shortName || form.name!.slice(0,4).toUpperCase(),
      gradient: form.gradient || GRADIENT_PRESETS[0].value,
      logoText: form.logoText || form.name!,
      description: form.description || '',
      emulator: form.emulator!,
      fileExtensions: extText.split(',').map(e=>e.trim().startsWith('.')?e.trim():`.${e.trim()}`).filter(Boolean),
      romCount: 0,
      roms: [],
    };
    onSave(c);
  }

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%' }}>
      <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14 }}>
        {/* Banner preview */}
        <div style={{ borderRadius:'.875rem',padding:'18px 22px',background:form.gradient,display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid rgba(255,255,255,.1)',flexShrink:0,minHeight:80 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:'1.1rem',color:'white',textShadow:'0 2px 8px rgba(0,0,0,.3)' }}>{form.name||'Nombre consola'}</div>
            <div style={{ fontSize:12,color:'rgba(255,255,255,.7)',marginTop:4 }}>{form.description||'Descripción de la consola'}</div>
          </div>
          <div style={{ fontWeight:900,fontSize:'2rem',color:'rgba(255,255,255,.2)',fontStyle:'italic',textTransform:'uppercase' }}>{form.logoText||form.shortName||'—'}</div>
        </div>

        {/* Gradient picker */}
        <Field label="Color del banner">
          <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
            {GRADIENT_PRESETS.map(g=>(
              <button key={g.label} onClick={()=>set('gradient',g.value)}
                style={{ width:36,height:28,borderRadius:'.5rem',background:g.value,border:`2px solid ${form.gradient===g.value?'white':'rgba(255,255,255,.1)'}`,cursor:'pointer',transition:'border-color .15s' }}
                title={g.label}/>
            ))}
          </div>
        </Field>

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
          <Field label="Nombre *">
            <Input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="PlayStation 2"/>
          </Field>
          <Field label="Nombre corto">
            <Input value={form.shortName} onChange={e=>set('shortName',e.target.value)} placeholder="PS2"/>
          </Field>
          <Field label="Emulador *">
            <Input value={form.emulator} onChange={e=>set('emulator',e.target.value)} placeholder="PCSX2"/>
          </Field>
          <Field label="Texto logo">
            <Input value={form.logoText} onChange={e=>set('logoText',e.target.value)} placeholder="PS2"/>
          </Field>
        </div>
        <Field label="Descripción">
          <Textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Descripción de la consola..."/>
        </Field>
        <Field label="Extensiones de archivo" hint="Separadas por comas: .iso, .bin, .cue">
          <Input value={extText} onChange={e=>setExtText(e.target.value)} placeholder=".iso, .bin, .cue"/>
        </Field>
      </div>

      <div style={{ display:'flex',gap:10,marginTop:20,paddingTop:16,borderTop:'1px solid rgba(255,255,255,.08)',flexShrink:0 }}>
        <button onClick={onCancel} style={{ flex:1,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'10px',color:'rgba(255,255,255,.6)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
          Cancelar
        </button>
        <button onClick={handleSave} disabled={!form.name||!form.emulator}
          style={{ flex:2,background:(!form.name||!form.emulator)?'rgba(255,255,255,.08)':'linear-gradient(135deg,#e52d6a,#f97316)',border:'none',borderRadius:'.875rem',padding:'10px 20px',color:(!form.name||!form.emulator)?'rgba(255,255,255,.3)':'white',cursor:(!form.name||!form.emulator)?'not-allowed':'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700 }}>
          ✓ Guardar consola
        </button>
      </div>
    </div>
  );
}

function RomForm({ console: c, onSave, onCancel, initialData }: { console?:Console; onSave:(r:Rom)=>void; onCancel:()=>void; initialData?:Rom }) {
  const [form, setForm] = useState<Partial<Rom>>(initialData ?? EMPTY_ROM());
  const [instructionsText, setInstructionsText] = useState(initialData?.instructions?.join('\n') ?? '');
  const [screenshotUrls, setScreenshotUrls] = useState<string[]>(initialData?.screenshots?.length ? initialData.screenshots : ['']);
  const [dlEntries, setDlEntries] = useState<DownloadEntry[]>(initialData?.downloads ?? []);
  const [step, setStep] = useState(0);
  const set = (k: keyof Rom, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const isEdit = !!initialData;

  function handleSave() {
    if (!form.title) return;
    const rom: Rom = {
      id: initialData?.id ?? `rom-${Date.now()}`,
      title: form.title!,
      region: form.region || 'EUR',
      size: form.size || '—',
      rating: Number(form.rating) || 4,
      year: Number(form.year) || new Date().getFullYear(),
      genre: form.genre || 'Acción',
      players: form.players || '1',
      description: form.description || '',
      developer: form.developer || 'Desconocido',
      downloadUrl: form.downloadUrl || '',
      downloads: dlEntries.filter(e=>e.label&&e.url).length > 0 ? dlEntries.filter(e=>e.label&&e.url) : undefined,
      coverUrl: form.coverUrl || '',
      screenshots: screenshotUrls.filter(u => u.trim() !== ''),
      videoId: form.videoId || '',
      instructions: instructionsText.split('\n').filter(Boolean),
    };
    onSave(rom);
  }

  function addRomDlEntry() { setDlEntries(p=>[...p,{label:'',url:'',size:'',type:'base' as const}]); }
  function removeRomDlEntry(i:number) { setDlEntries(p=>p.filter((_,j)=>j!==i)); }
  function updateRomDlEntry(i:number, k:keyof DownloadEntry, v:string) { setDlEntries(p=>p.map((e,j)=>j===i?{...e,[k]:v}:e)); }

  const regions = ['EUR','USA','JAP','ESP','MULTI'];
  const genres = ['Acción','Aventura','RPG','Plataformas','Deportes','Lucha','Racing','Puzzle','Estrategia','Terror','Otro'];
  const steps = ['Básico','Media','Descarga'];

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'93%' }}>
      {c&&(
        <div style={{ marginBottom:12,padding:'8px 12px',background:'rgba(255,255,255,.04)',borderRadius:'.75rem',border:'1px solid rgba(255,255,255,.08)',fontSize:12,color:'rgba(255,255,255,.5)',display:'flex',alignItems:'center',gap:6,flexShrink:0 }}>
          <span>🎮</span> Consola: <strong style={{ color:'white' }}>{c.name}</strong> · {c.emulator}
        </div>
      )}

      {/* Step tabs */}
      <div style={{ display:'flex',gap:0,marginBottom:18,background:'rgba(255,255,255,.04)',borderRadius:'2rem',padding:3,border:'1px solid rgba(255,255,255,.08)',flexShrink:0 }}>
        {steps.map((s,i)=>(
          <button key={s} onClick={()=>setStep(i)}
            style={{ flex:1,border:'none',borderRadius:'2rem',padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:step===i?'linear-gradient(135deg,#e52d6a,#f97316)':'transparent',
              color:step===i?'white':'rgba(255,255,255,.45)',transition:'all .15s' }}>
            {i+1}. {s}
          </button>
        ))}
      </div>

      <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14 }}>

        {/* ── STEP 0: BÁSICO ── */}
        {step===0&&(
          <>
            <Field label="Título del juego *">
              <Input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Ej: Gran Turismo 3"/>
            </Field>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              <Field label="Región">
                <Select value={form.region} onChange={e=>set('region',e.target.value)}>
                  {regions.map(r=><option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Género">
                <Select value={form.genre} onChange={e=>set('genre',e.target.value)}>
                  {genres.map(g=><option key={g} value={g}>{g}</option>)}
                </Select>
              </Field>
              <Field label="Año">
                <Input type="number" value={form.year} onChange={e=>set('year',parseInt(e.target.value))} min={1970} max={2030}/>
              </Field>
              <Field label="Jugadores">
                <Select value={form.players} onChange={e=>set('players',e.target.value)}>
                  {['1','2','3','4','2-4','1-2','1-4'].map(p=><option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="Tamaño">
                <Input value={form.size} onChange={e=>set('size',e.target.value)} placeholder="Ej: 1.4 GB"/>
              </Field>
              <Field label="Rating (1-5 estrellas)">
                <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                  <input type="range" min={1} max={5} step={0.5} value={form.rating} onChange={e=>set('rating',parseFloat(e.target.value))} style={{ flex:1,accentColor:'#f59e0b' }}/>
                  <span style={{ fontSize:13,fontWeight:700,color:'#f59e0b',minWidth:24 }}>{form.rating}★</span>
                </div>
              </Field>
            </div>
            <Field label="Desarrollador">
              <Input value={form.developer} onChange={e=>set('developer',e.target.value)} placeholder="Ej: Nintendo EAD"/>
            </Field>
            <Field label="Descripción">
              <Textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Descripción del juego..."/>
            </Field>
          </>
        )}

        {/* ── STEP 1: MEDIA ── */}
        {step===1&&(
          <>
            <Field label="Imagen de portada (URL)" hint="URL directa a JPG, PNG o WebP">
              <Input type="url" value={form.coverUrl||''} onChange={e=>set('coverUrl',e.target.value)} placeholder="https://ejemplo.com/portada.jpg"/>
              {form.coverUrl&&(
                <div style={{ marginTop:8,borderRadius:'.75rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.1)',height:140,background:'#0a0a14' }}>
                  <img src={form.coverUrl} alt="Portada" style={{ width:'100%',height:'100%',objectFit:'cover' }}
                    onError={e=>{ (e.target as HTMLImageElement).style.display='none'; }}/>
                </div>
              )}
            </Field>
            <Field label="Video de YouTube (Gameplay ID)" hint="Solo el ID del video, ej: pAOe4UVZ6Cg">
              <Input value={form.videoId||''} onChange={e=>set('videoId',e.target.value)} placeholder="pAOe4UVZ6Cg"/>
              {form.videoId&&(
                <div style={{ marginTop:8,borderRadius:'.75rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.1)',aspectRatio:'16/9',background:'#0a0a14' }}>
                  <iframe src={`https://www.youtube.com/embed/${form.videoId}?rel=0&modestbranding=1`} title="preview" allowFullScreen style={{ width:'100%',height:'100%',border:'none' }}/>
                </div>
              )}
            </Field>
            <Field label="Capturas de pantalla" hint="URL directa a cada imagen">
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {screenshotUrls.map((url,i)=>(
                  <div key={i} style={{ display:'flex',flexDirection:'column',gap:6 }}>
                    <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                      <Input type="url" value={url} onChange={e=>{ const u=[...screenshotUrls]; u[i]=e.target.value; setScreenshotUrls(u); }} placeholder={`https://ejemplo.com/captura${i+1}.jpg`}/>
                      {screenshotUrls.length>1&&(
                        <button onClick={()=>setScreenshotUrls(p=>p.filter((_,j)=>j!==i))}
                          style={{ width:30,height:30,flexShrink:0,borderRadius:'50%',background:'rgba(239,68,68,.15)',border:'1px solid rgba(239,68,68,.3)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14 }}>✕</button>
                      )}
                    </div>
                    {url&&(
                      <div style={{ borderRadius:'.625rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.08)',height:90,background:'#0a0a14' }}>
                        <img src={url} alt={`Captura ${i+1}`} style={{ width:'100%',height:'100%',objectFit:'cover' }}
                          onError={e=>{ (e.target as HTMLImageElement).style.display='none'; }}/>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={()=>setScreenshotUrls(p=>[...p,''])}
                  style={{ background:'rgba(255,255,255,.05)',border:'1px dashed rgba(255,255,255,.15)',borderRadius:'.625rem',padding:'8px',color:'rgba(255,255,255,.4)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
                  + Agregar captura
                </button>
              </div>
            </Field>
          </>
        )}

        {/* ── STEP 2: DESCARGA ── */}
        {step===2&&(
          <>
            <Field label="URL de descarga principal" hint="Enlace directo al archivo ROM (juego base)">
              <Input type="url" value={form.downloadUrl||''} onChange={e=>set('downloadUrl',e.target.value)} placeholder="https://archive.org/..."/>
            </Field>
            <Field label="Descargas múltiples" hint="Opcional — agrega actualización, DLC, versiones alternativas">
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                {dlEntries.map((entry,i)=>(
                  <div key={i} style={{ display:'flex',flexDirection:'column',gap:6,padding:'10px 12px',background:'rgba(255,255,255,.04)',borderRadius:'.75rem',border:'1px solid rgba(255,255,255,.1)' }}>
                    <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                      <Input value={entry.label} onChange={e=>updateRomDlEntry(i,'label',e.target.value)} placeholder="Nombre (ej: Actualización v1.1)" style={{ flex:2 }}/>
                      <select value={entry.type||'base'} onChange={e=>updateRomDlEntry(i,'type',e.target.value)}
                        style={{ flex:1,background:'hsl(230 22% 18%)',border:'1px solid rgba(255,255,255,.12)',borderRadius:'.5rem',padding:'8px 10px',color:'white',fontSize:12,fontFamily:'inherit',cursor:'pointer' }}>
                        <option value="base">🎮 Juego Base</option>
                        <option value="update">🔄 Actualización</option>
                        <option value="dlc">🎁 DLC</option>
                        <option value="version">📦 Versión</option>
                        <option value="other">⬇️ Otro</option>
                      </select>
                      <button onClick={()=>removeRomDlEntry(i)} style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.15)',border:'1px solid rgba(239,68,68,.3)',color:'#f87171',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>✕</button>
                    </div>
                    <Input type="url" value={entry.url} onChange={e=>updateRomDlEntry(i,'url',e.target.value)} placeholder="https://..."/>
                    <Input value={entry.size||''} onChange={e=>updateRomDlEntry(i,'size',e.target.value)} placeholder="Tamaño (ej: 4.37 GB)"/>
                  </div>
                ))}
                <button onClick={addRomDlEntry} style={{ background:'rgba(255,255,255,.05)',border:'1px dashed rgba(255,255,255,.15)',borderRadius:'.625rem',padding:'8px',color:'rgba(255,255,255,.5)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
                  + Agregar descarga
                </button>
              </div>
            </Field>
            <Field label="Instrucciones" hint="Una instrucción por línea">
              <Textarea value={instructionsText} onChange={e=>setInstructionsText(e.target.value)}
                placeholder={`Descargar el archivo ROM\nAbrir en ${c?.emulator||'el emulador'}\nConfigurar controles`} rows={4}/>
            </Field>
            <div style={{ background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'.875rem',padding:'14px 16px' }}>
              <div style={{ fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,.3)',marginBottom:10 }}>Resumen</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:12 }}>
                {[['Título',form.title||'—'],['Género',form.genre||'—'],['Año',String(form.year||'—')],['Región',form.region||'—'],['Portada',form.coverUrl?'✓ Sí':'✗ No'],['Video',form.videoId?'✓ Sí':'✗ No'],['Descarga',form.downloadUrl?'✓ Sí':'✗ No'],['Extras',dlEntries.filter(e=>e.label&&e.url).length>0?`${dlEntries.filter(e=>e.label&&e.url).length} archivos`:'—']].map(([k,v])=>(
                  <div key={k}><span style={{ color:'rgba(255,255,255,.35)' }}>{k}: </span><span style={{ color:'white',fontWeight:500 }}>{v}</span></div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display:'flex',gap:10,marginTop:20,paddingTop:16,borderTop:'1px solid rgba(255,255,255,.08)',flexShrink:0 }}>
        <button onClick={onCancel} style={{ flex:1,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'10px',color:'rgba(255,255,255,.6)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
          Cancelar
        </button>
        {step>0&&(
          <button onClick={()=>setStep(s=>s-1)} style={{ flex:1,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'10px',color:'rgba(255,255,255,.6)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
            ← Anterior
          </button>
        )}
        {step<2 ? (
          <button onClick={()=>setStep(s=>s+1)} style={{ flex:2,background:'linear-gradient(135deg,#e52d6a,#f97316)',border:'none',borderRadius:'.875rem',padding:'10px 20px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700 }}>
            Siguiente →
          </button>
        ) : (
          <button onClick={handleSave} disabled={!form.title}
            style={{ flex:2,background:!form.title?'rgba(255,255,255,.08)':'linear-gradient(135deg,#e52d6a,#f97316)',border:'none',borderRadius:'.875rem',padding:'10px 20px',color:!form.title?'rgba(255,255,255,.3)':'white',cursor:!form.title?'not-allowed':'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700,transition:'opacity .15s' }}>
            ✓ {isEdit ? 'Guardar cambios' : 'Guardar ROM'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
type AdminTab = 'apps' | 'roms';
type RomSubView = 'list' | 'add-console' | { consoleId:string; view:'add-rom'|'rom-list' };

interface AdminPanelProps {
  baseApps: App[];
  customApps: App[];
  hiddenAppIds: number[];
  customConsoles: Console[];
  baseConsoles: Console[];
  extraRoms: ExtraRoms;
  hiddenRomIds: string[];
  onUpdateBaseConsoles: (consoles: Console[]) => void;
  onUpdateApps: (apps: App[]) => void;
  onUpdateHiddenApps: (ids: number[]) => void;
  onUpdateConsoles: (consoles: Console[]) => void;
  onUpdateRomOverrides: (overrides: RomOverrides) => void;
  onUpdateExtraRoms: (extra: ExtraRoms) => void;
  onUpdateHiddenRoms: (ids: string[]) => void;
  onClose: () => void;
}

export function AdminPanel({ baseApps, customApps, hiddenAppIds, customConsoles, baseConsoles, extraRoms: extraRomsProp, hiddenRomIds: hiddenRomIdsProp, onUpdateBaseConsoles, onUpdateApps, onUpdateHiddenApps, onUpdateConsoles, onUpdateRomOverrides, onUpdateExtraRoms, onUpdateHiddenRoms, onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('apps');
  const [showAppForm, setShowAppForm] = useState(false);
  const [editingApp, setEditingApp] = useState<App|null>(null);
  const [romView, setRomView] = useState<RomSubView>('list');
  const [deleteConfirm, setDeleteConfirm] = useState<number|null>(null);
  const [appFilter, setAppFilter] = useState<'all'|'base'|'custom'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [romSearchQuery, setRomSearchQuery] = useState('');
  const [romTabFilter, setRomTabFilter] = useState<'base'|'custom'>('base');
  const [editingBaseRom, setEditingBaseRom] = useState<{ rom: Rom; consoleId: string; consoleName: string; emulator: string; isExtra?: boolean } | null>(null);
  const [expandedConsole, setExpandedConsole] = useState<string|null>(null);
  const [romOverrides, setRomOverrides] = useState<RomOverrides>(loadRomOverrides);
  const [romDeleteConfirm, setRomDeleteConfirm] = useState<string|null>(null);
  const [extraRoms, setExtraRoms] = useState<ExtraRoms>(extraRomsProp);
  const [hiddenRomIds, setHiddenRomIds] = useState<string[]>(hiddenRomIdsProp);
  const [addingRomToConsoleId, setAddingRomToConsoleId] = useState<string|null>(null);
  const [baseConsolesLocal, setBaseConsolesLocal] = useState<Console[]>(baseConsoles);

  useEffect(() => { setBaseConsolesLocal(baseConsoles); }, [baseConsoles]);

  function saveRomsToJsonFinal(
    bConsoles: Console[],
    cConsoles: Console[],
    over: RomOverrides,
    ext: ExtraRoms,
    hid: string[]
  ) {
    const finalConsoles = bConsoles.map(c => {
      // Aplicar overrides y filtrar ocultos
      const baseRoms = c.roms.map(r => over[r.id] || r)
                            .filter(r => !hid.includes(r.id));
      // Agregar ROMs extras
      const extras = ext[c.id] || [];
      const byId = new Map<string, Rom>();
      for (const r of baseRoms) byId.set(r.id, r);
      for (const r of extras) if (!byId.has(r.id)) byId.set(r.id, r);
      const merged = Array.from(byId.values());
      return { ...c, roms: merged, romCount: merged.length };
    });
    
    // Agregar consolas personalizadas
    const allConsoles = [...finalConsoles, ...cConsoles];
    saveToJson('roms.json', { consoles: allConsoles });
  }

  function handleSaveRomOverride(rom: Rom) {
    let updatedExtra = extraRoms;
    let updatedOverrides = romOverrides;

    if (editingBaseRom?.isExtra) {
      const consoleId = editingBaseRom.consoleId;
      updatedExtra = { ...extraRoms, [consoleId]: (extraRoms[consoleId]||[]).map(r => r.id===rom.id ? rom : r) };
      saveExtraRoms(updatedExtra);
      setExtraRoms(updatedExtra);
      onUpdateExtraRoms(updatedExtra);
    } else {
      updatedOverrides = { ...romOverrides, [rom.id]: rom };
      saveRomOverrides(updatedOverrides);
      setRomOverrides(updatedOverrides);
      onUpdateRomOverrides(updatedOverrides);
    }
    setEditingBaseRom(null);
    saveRomsToJsonFinal(baseConsolesLocal, customConsoles, updatedOverrides, updatedExtra, hiddenRomIds);
  }

  function handleDeleteRomOverride(romId: string) {
    const updated = { ...romOverrides };
    delete updated[romId];
    saveRomOverrides(updated);
    setRomOverrides(updated);
    onUpdateRomOverrides(updated);
    setRomDeleteConfirm(null);
    saveRomsToJsonFinal(baseConsolesLocal, customConsoles, updated, extraRoms, hiddenRomIds);
  }

  function handleAddRomToBaseConsole(consoleId: string, rom: Rom) {
    const updated = { ...extraRoms, [consoleId]: [...(extraRoms[consoleId] || []), rom] };
    saveExtraRoms(updated);
    setExtraRoms(updated);
    onUpdateExtraRoms(updated);
    setAddingRomToConsoleId(null);
    saveRomsToJsonFinal(baseConsolesLocal, customConsoles, romOverrides, updated, hiddenRomIds);
  }

  function handleDeleteExtraRom(consoleId: string, romId: string) {
    const updated = { ...extraRoms, [consoleId]: (extraRoms[consoleId] || []).filter(r => r.id !== romId) };
    saveExtraRoms(updated);
    setExtraRoms(updated);
    onUpdateExtraRoms(updated);
    setRomDeleteConfirm(null);
    saveRomsToJsonFinal(baseConsolesLocal, customConsoles, romOverrides, updated, hiddenRomIds);
  }

  function handleDeleteBaseRom(consoleId: string, romId: string) {
    const updatedBase = baseConsolesLocal.map(c => c.id === consoleId ? { ...c, roms: (c.roms || []).filter(r => r.id !== romId) } : c);
    const updatedOverrides = { ...romOverrides };
    delete updatedOverrides[romId];
    const updatedHidden = hiddenRomIds.filter(id => id !== romId);
    const updatedExtra = { ...extraRoms, [consoleId]: (extraRoms[consoleId] || []).filter(r => r.id !== romId) };

    setBaseConsolesLocal(updatedBase);
    onUpdateBaseConsoles(updatedBase);

    saveRomOverrides(updatedOverrides);
    setRomOverrides(updatedOverrides);
    onUpdateRomOverrides(updatedOverrides);

    saveHiddenRomIds(updatedHidden);
    setHiddenRomIds(updatedHidden);
    onUpdateHiddenRoms(updatedHidden);

    saveExtraRoms(updatedExtra);
    setExtraRoms(updatedExtra);
    onUpdateExtraRoms(updatedExtra);

    setRomDeleteConfirm(null);
    saveRomsToJsonFinal(updatedBase, customConsoles, updatedOverrides, updatedExtra, updatedHidden);
  }

  function handleSaveApp(app: App) {
    // Evitar duplicados en customApps por ID
    const updated = customApps.filter(a => a.id !== app.id);
    updated.push(app);
    
    saveCustomApps(updated);
    onUpdateApps(updated);
    setShowAppForm(false);
    
    // Guardar en apps.json
    const allAppsForJson = [
      ...baseApps.filter(a => !hiddenAppIds.includes(a.id)),
      ...updated
    ];
    saveToJson('apps.json', { apps: allAppsForJson });
  }

  function handleDeleteApp(id: number) {
    const updated = customApps.filter(a => a.id !== id);
    saveCustomApps(updated);
    onUpdateApps(updated);
    setDeleteConfirm(null);

    // If this was a hidden base app, unhide it
    if (hiddenAppIds.includes(id)) {
      const updatedHidden = hiddenAppIds.filter(hid => hid !== id);
      saveHiddenAppIds(updatedHidden);
      onUpdateHiddenApps(updatedHidden);
      
      // Guardar en apps.json con la base app restaurada
      const allAppsForJson = [
        ...baseApps.filter(a => !updatedHidden.includes(a.id)),
        ...updated
      ];
      saveToJson('apps.json', { apps: allAppsForJson });
    } else {
      // Guardar en apps.json
      const allAppsForJson = [
        ...baseApps.filter(a => !hiddenAppIds.includes(a.id)),
        ...updated
      ];
      saveToJson('apps.json', { apps: allAppsForJson });
    }
  }

  function handleDeleteBaseApp(id: number) {
    const updated = [...hiddenAppIds, id];
    saveHiddenAppIds(updated);
    onUpdateHiddenApps(updated);
    setDeleteConfirm(null);

    // Guardar en apps.json
    const allAppsForJson = [
      ...baseApps.filter(a => !updated.includes(a.id)),
      ...customApps
    ];
    saveToJson('apps.json', { apps: allAppsForJson });
  }

  function handleEditApp(app: App, source: 'base'|'custom') {
    setEditingApp(app);
    setShowAppForm(false);
  }

  function handleSaveEditedApp(app: App, originalSource: 'base'|'custom') {
    let customUpdated = customApps;
    let hiddenUpdated = hiddenAppIds;

    if (originalSource === 'custom') {
      customUpdated = customApps.map(a => a.id === app.id ? app : a);
    } else {
      // For base apps: hide the original and add edited version as custom
      if (!hiddenAppIds.includes(app.id)) {
        hiddenUpdated = [...hiddenAppIds, app.id];
        saveHiddenAppIds(hiddenUpdated);
        onUpdateHiddenApps(hiddenUpdated);
      }
      
      // Asegurarse de no duplicar en customApps si ya existía
      customUpdated = customApps.filter(a => a.id !== app.id);
      customUpdated.push(app);
    }
    
    saveCustomApps(customUpdated);
    onUpdateApps(customUpdated);
    setEditingApp(null);

    // Guardar en apps.json
    const allAppsForJson = [
      ...baseApps.filter(a => !hiddenUpdated.includes(a.id)),
      ...customUpdated
    ];
    saveToJson('apps.json', { apps: allAppsForJson });
  }

  const allApps = [
    ...baseApps.map(a => ({ ...a, _source: 'base' as const })),
    ...customApps.map(a => ({ ...a, _source: 'custom' as const })),
  ];

  // Deduplicate apps by ID, prioritizing custom over base
  const dedupedAppsMap = new Map<number, App & { _source: 'base' | 'custom' }>();
  allApps.forEach(app => {
    const existing = dedupedAppsMap.get(app.id);
    if (!existing || app._source === 'custom') {
      dedupedAppsMap.set(app.id, app);
    }
  });
  const dedupedApps = Array.from(dedupedAppsMap.values());

  const q = searchQuery.trim().toLowerCase();
  const romQ = romSearchQuery.trim().toLowerCase();
  const visibleApps = dedupedApps.filter(a => {
    if (appFilter === 'base') return a._source === 'base';
    if (appFilter === 'custom') return a._source === 'custom';
    return true;
  }).filter(a => a._source === 'custom' || !hiddenAppIds.includes(a.id))
    .filter(a => !q || a.name.toLowerCase().includes(q) || (a.category||'').toLowerCase().includes(q) || (a.developer||'').toLowerCase().includes(q));

  const romMatches = (rom: Rom) => {
    if (!romQ) return true;
    const hay = [
      rom.title,
      rom.region,
      rom.genre,
      rom.developer,
      rom.players,
      rom.size,
      String(rom.year ?? ''),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(romQ);
  };

  const baseConsoleMatches = (c: Console) => {
    if (!romQ) return true;
    const consoleHay = `${c.name} ${c.emulator}`.toLowerCase();
    if (consoleHay.includes(romQ)) return true;
    const extras = extraRoms[c.id] || [];
    return c.roms.some(r => romMatches(romOverrides[r.id] || r)) || extras.some(r => romMatches(r));
  };

  const visibleCustomConsoles = customConsoles.filter(c => {
    if (!romQ) return true;
    const consoleHay = `${c.name} ${c.emulator}`.toLowerCase();
    if (consoleHay.includes(romQ)) return true;
    return (c.roms || []).some(r => romMatches(r));
  });

  function handleSaveConsole(c: Console) {
    const updated = [...customConsoles, c];
    saveCustomConsoles(updated);
    onUpdateConsoles(updated);
    setRomView('list');
    saveRomsToJsonFinal(baseConsolesLocal, updated, romOverrides, extraRoms, hiddenRomIds);
  }

  function handleDeleteConsole(id: string) {
    const updated = customConsoles.filter(c => c.id !== id);
    saveCustomConsoles(updated);
    onUpdateConsoles(updated);
    saveRomsToJsonFinal(baseConsolesLocal, updated, romOverrides, extraRoms, hiddenRomIds);
  }

  function handleSaveRom(consoleId: string, rom: Rom) {
    const updated = customConsoles.map(c =>
      c.id === consoleId ? { ...c, roms: [...c.roms, rom], romCount: c.romCount + 1 } : c
    );
    saveCustomConsoles(updated);
    onUpdateConsoles(updated);
    setRomView({ consoleId, view:'rom-list' });
    saveRomsToJsonFinal(baseConsolesLocal, updated, romOverrides, extraRoms, hiddenRomIds);
  }

  function handleDeleteCustomRom(consoleId: string, romId: string) {
    const updated = customConsoles.map(c => c.id === consoleId ? { ...c, roms: (c.roms || []).filter(r => r.id !== romId), romCount: Math.max(0, (c.romCount || 0) - 1) } : c);
    saveCustomConsoles(updated);
    onUpdateConsoles(updated);
    setRomDeleteConfirm(null);
    saveRomsToJsonFinal(baseConsolesLocal, updated, romOverrides, extraRoms, hiddenRomIds);
  }

  const bg = 'linear-gradient(160deg,#0f0f18 0%,#0a0a14 100%)';

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.7)',backdropFilter:'blur(8px)',zIndex:700 }}/>
      <div style={{ position:'fixed',inset:0,zIndex:701,display:'flex',alignItems:'stretch',justifyContent:'flex-end',pointerEvents:'none' }}>
        <div style={{ width:'min(680px,96vw)',background:bg,borderLeft:'1px solid rgba(255,255,255,.08)',display:'flex',flexDirection:'column',height:'100%',pointerEvents:'auto',animation:'settingsSlideIn .3s cubic-bezier(.22,1,.36,1) forwards' }}>

          {/* Header */}
          <div style={{ padding:'20px 24px 16px',borderBottom:'1px solid rgba(255,255,255,.07)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div>
              <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                <div style={{ width:36,height:36,borderRadius:'.75rem',background:'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem' }}>⚙️</div>
                <div>
                  <h2 style={{ margin:0,fontSize:'1.1rem',fontWeight:800,color:'white' }}>Administrar contenido</h2>
                  <p style={{ margin:0,fontSize:12,color:'rgba(255,255,255,.35)' }}>Agrega programas y juegos al catálogo</p>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{ width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.1)',color:'rgba(255,255,255,.6)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16 }}>✕</button>
          </div>

          {/* Tab bar */}
          <div style={{ display:'flex',padding:'12px 24px 0',gap:4,borderBottom:'1px solid rgba(255,255,255,.07)',flexShrink:0 }}>
            {([['apps','💻 Programas'],['roms','🎮 Juegos ROM']] as [AdminTab,string][]).map(([id,label])=>(
              <button key={id} onClick={()=>{ setTab(id); setShowAppForm(false); setRomView('list'); setSearchQuery(''); setRomSearchQuery(''); }}
                style={{ border:'none',background:'transparent',color:tab===id?'white':'rgba(255,255,255,.4)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:600,padding:'8px 18px',borderBottom:tab===id?'2px solid hsl(var(--primary))':'2px solid transparent',transition:'all .15s' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column',padding:'20px 24px 24px' }}>

            {/* ── APPS TAB ── */}
            {tab==='apps'&&(
              <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>
                {showAppForm ? (
                  <AppForm onSave={handleSaveApp} onCancel={()=>setShowAppForm(false)}/>
                ) : editingApp ? (
                  <AppForm
                    key={editingApp.id}
                    initialData={editingApp}
                    onSave={app=>handleSaveEditedApp(app, allApps.find(a=>a.id===editingApp.id)?._source ?? 'custom')}
                    onCancel={()=>setEditingApp(null)}/>
                ) : (
                  <>
                    {/* Header */}
                    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexShrink:0 }}>
                      <div>
                        <span style={{ fontSize:14,fontWeight:600,color:'white' }}>Todos los programas</span>
                        <span style={{ marginLeft:10,fontSize:12,background:'hsl(var(--primary)/.2)',color:'hsl(var(--primary))',padding:'2px 8px',borderRadius:20,border:'1px solid hsl(var(--primary)/.3)' }}>{visibleApps.length}</span>
                      </div>
                      <button onClick={()=>setShowAppForm(true)}
                        style={{ background:'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',border:'none',borderRadius:'.875rem',padding:'9px 18px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6 }}>
                        + Agregar programa
                      </button>
                    </div>

                    {/* Search */}
                    <div style={{ position:'relative',marginBottom:10,flexShrink:0 }}>
                      <span style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:14,color:'rgba(255,255,255,.3)',pointerEvents:'none' }}>🔍</span>
                      <input
                        value={searchQuery}
                        onChange={e=>setSearchQuery(e.target.value)}
                        placeholder="Buscar por nombre, categoría o desarrollador..."
                        style={{ ...inputStyle,paddingLeft:36,width:'100%',boxSizing:'border-box' }}
                        onFocus={e=>(e.target as HTMLInputElement).style.borderColor='hsl(var(--primary)/.6)'}
                        onBlur={e=>(e.target as HTMLInputElement).style.borderColor='rgba(255,255,255,.1)'}
                      />
                      {searchQuery&&(
                        <button onClick={()=>setSearchQuery('')} style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'rgba(255,255,255,.4)',cursor:'pointer',fontSize:14,padding:0,lineHeight:1 }}>✕</button>
                      )}
                    </div>

                    {/* Filter pills */}
                    <div style={{ display:'flex',gap:6,marginBottom:14,flexShrink:0 }}>
                      {(['all','base','custom'] as const).map(f=>(
                        <button key={f} onClick={()=>setAppFilter(f)}
                          style={{ border:`1px solid ${appFilter===f?'hsl(var(--primary))':'rgba(255,255,255,.12)'}`,background:appFilter===f?'hsl(var(--primary)/.2)':'transparent',color:appFilter===f?'hsl(var(--primary))':'rgba(255,255,255,.5)',borderRadius:20,padding:'4px 12px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all .15s' }}>
                          {f==='all'?`Todos (${visibleApps.length})`:f==='base'?`Catálogo (${baseApps.filter(a=>!hiddenAppIds.includes(a.id)).length})`:`Personalizados (${customApps.length})`}
                        </button>
                      ))}
                    </div>

                    {visibleApps.length===0 ? (
                      <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,color:'rgba(255,255,255,.25)' }}>
                        <div style={{ fontSize:'4rem' }}>{q ? '🔍' : '📭'}</div>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:15,fontWeight:600,marginBottom:6 }}>{q ? `Sin resultados para "${searchQuery}"` : 'No hay programas aquí'}</div>
                          <div style={{ fontSize:13 }}>{q ? 'Prueba con otro término de búsqueda' : 'Haz clic en "+ Agregar programa" para empezar'}</div>
                        </div>
                        {q&&<button onClick={()=>setSearchQuery('')} style={{ background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.12)',borderRadius:'2rem',padding:'8px 20px',color:'rgba(255,255,255,.5)',cursor:'pointer',fontFamily:'inherit',fontSize:13 }}>Limpiar búsqueda</button>}
                      </div>
                    ) : (
                      <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8 }}>
                        {visibleApps.map(app => {
                          const isBase = app._source === 'base';
                          return (
                            <div key={app.id} style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'.875rem',padding:'12px 16px',display:'flex',alignItems:'center',gap:12 }}>
                              <div style={{ width:46,height:46,borderRadius:'.75rem',background:`linear-gradient(135deg,${app.color}bb,${app.color}44)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.4rem',flexShrink:0 }}>{app.icon}</div>
                              <div style={{ flex:1,minWidth:0 }}>
                                <div style={{ display:'flex',alignItems:'center',gap:7,flexWrap:'wrap' }}>
                                  <span style={{ fontWeight:600,fontSize:14,color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180 }}>{app.name}</span>
                                  {isBase
                                    ? <span style={{ fontSize:10,background:'rgba(59,130,246,.2)',color:'#60a5fa',padding:'1px 7px',borderRadius:20,border:'1px solid rgba(59,130,246,.3)',fontWeight:700,flexShrink:0 }}>CATÁLOGO</span>
                                    : <span style={{ fontSize:10,background:'hsl(var(--primary)/.2)',color:'hsl(var(--primary))',padding:'1px 7px',borderRadius:20,border:'1px solid hsl(var(--primary)/.3)',fontWeight:700,flexShrink:0 }}>PERSONALIZADO</span>}
                                </div>
                                <div style={{ fontSize:12,color:'rgba(255,255,255,.4)',marginTop:3 }}>{app.category} · v{app.version} · {app.size}</div>
                              </div>

                              {/* Actions */}
                              {deleteConfirm===app.id ? (
                                <div style={{ display:'flex',gap:6,alignItems:'center',flexShrink:0 }}>
                                  <span style={{ fontSize:12,color:'rgba(255,255,255,.5)' }}>¿Eliminar?</span>
                                  <button onClick={()=>isBase ? handleDeleteBaseApp(app.id) : handleDeleteApp(app.id)} style={{ background:'#ef4444',border:'none',borderRadius:'.5rem',padding:'5px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600 }}>Sí</button>
                                  <button onClick={()=>setDeleteConfirm(null)} style={{ background:'rgba(255,255,255,.08)',border:'none',borderRadius:'.5rem',padding:'5px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12 }}>No</button>
                                </div>
                              ) : (
                                <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                                  <button onClick={()=>handleEditApp(app, app._source)} title="Editar"
                                    style={{ height:30,padding:'0 12px',borderRadius:'.5rem',background:'rgba(99,102,241,.15)',border:'1px solid rgba(99,102,241,.3)',color:'#a5b4fc',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4 }}>
                                    ✏️ Editar
                                  </button>
                                  <button onClick={()=>setDeleteConfirm(app.id)} title="Eliminar"
                                    style={{ width:30,height:30,borderRadius:'50%',background:'rgba(239,68,68,.15)',border:'1px solid rgba(239,68,68,.3)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14 }}>✕</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── ROMS TAB ── */}
            {tab==='roms'&&(
              <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>

                {/* Editing a base ROM */}
                {editingBaseRom ? (
                  <RomForm
                    key={editingBaseRom.rom.id}
                    initialData={editingBaseRom.rom}
                    onSave={handleSaveRomOverride}
                    onCancel={()=>setEditingBaseRom(null)}/>

                /* Adding ROM to custom console */
                ) : romView==='add-console' ? (
                  <ConsoleForm onSave={handleSaveConsole} onCancel={()=>setRomView('list')}/>
                ) : typeof romView==='object'&&romView.view==='add-rom' ? (
                  <RomForm
                    console={customConsoles.find(c=>c.id===romView.consoleId)}
                    onSave={rom=>handleSaveRom(romView.consoleId,rom)}
                    onCancel={()=>setRomView({consoleId:romView.consoleId,view:'rom-list'})}/>

                /* Custom console ROM list */
                ) : typeof romView==='object'&&romView.view==='rom-list' ? (
                  <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:16,flexShrink:0 }}>
                      <button onClick={()=>setRomView('list')} style={{ background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.75rem',padding:'6px 14px',color:'rgba(255,255,255,.7)',cursor:'pointer',fontFamily:'inherit',fontSize:13 }}>← Volver</button>
                      <span style={{ fontSize:14,fontWeight:600,color:'white' }}>{customConsoles.find(c=>c.id===romView.consoleId)?.name}</span>
                      <button onClick={()=>setRomView({consoleId:romView.consoleId,view:'add-rom'})}
                        style={{ marginLeft:'auto',background:'linear-gradient(135deg,#e52d6a,#f97316)',border:'none',borderRadius:'.875rem',padding:'7px 16px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700 }}>
                        + Agregar ROM
                      </button>
                    </div>
                    <div style={{ position:'relative',marginBottom:10,flexShrink:0 }}>
                      <span style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:14,color:'rgba(255,255,255,.3)',pointerEvents:'none' }}>🔍</span>
                      <input
                        value={romSearchQuery}
                        onChange={e=>setRomSearchQuery(e.target.value)}
                        placeholder="Buscar ROMs por título, género, región o desarrollador..."
                        style={{ ...inputStyle,paddingLeft:36,width:'100%',boxSizing:'border-box' }}
                        onFocus={e=>(e.target as HTMLInputElement).style.borderColor='hsl(var(--primary)/.6)'}
                        onBlur={e=>(e.target as HTMLInputElement).style.borderColor='rgba(255,255,255,.1)'}
                      />
                      {romSearchQuery&&(
                        <button onClick={()=>setRomSearchQuery('')} style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'rgba(255,255,255,.4)',cursor:'pointer',fontSize:14,padding:0,lineHeight:1 }}>✕</button>
                      )}
                    </div>
                    <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8 }}>
                      {(customConsoles.find(c=>c.id===romView.consoleId)?.roms||[]).filter(romMatches).map(rom=>{
                        const confirmKey = `custom-${romView.consoleId}-${rom.id}`;
                        return (
                        <div key={rom.id} style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'.875rem',padding:'10px 14px',display:'flex',alignItems:'center',gap:12 }}>
                          {rom.coverUrl
                            ? <img src={rom.coverUrl} alt={rom.title} style={{ width:42,height:42,borderRadius:'.5rem',objectFit:'cover',flexShrink:0 }}/>
                            : <span style={{ fontSize:'1.5rem' }}>🎮</span>}
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600,fontSize:13,color:'white' }}>{rom.title}</div>
                            <div style={{ fontSize:11,color:'rgba(255,255,255,.4)' }}>{rom.region} · {rom.year} · {rom.genre}</div>
                          </div>
                          <div style={{ display:'flex',gap:6,alignItems:'center',flexShrink:0 }}>
                            {romDeleteConfirm===confirmKey ? (
                              <>
                                <span style={{ fontSize:11,color:'rgba(255,255,255,.5)' }}>¿Eliminar?</span>
                                <button onClick={()=>handleDeleteCustomRom(romView.consoleId, rom.id)} style={{ background:'#ef4444',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:600 }}>Sí</button>
                                <button onClick={()=>setRomDeleteConfirm(null)} style={{ background:'rgba(255,255,255,.08)',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11 }}>No</button>
                              </>
                            ) : (
                              <>
                                <button onClick={()=>{ const c=customConsoles.find(cc=>cc.id===romView.consoleId); setEditingBaseRom({ rom, consoleId:romView.consoleId, consoleName:c?.name||'', emulator:c?.emulator||'' }); }}
                                  style={{ height:28,padding:'0 10px',borderRadius:'.5rem',background:'rgba(229,45,106,.15)',border:'1px solid rgba(229,45,106,.3)',color:'#f472b6',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600 }}>
                                  ✏️ Editar
                                </button>
                                <button onClick={()=>setRomDeleteConfirm(confirmKey)} title="Eliminar ROM"
                                  style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.25)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13 }}>
                                  🗑️
                                </button>
                              </>
                            )}
                            <div style={{ fontSize:12,color:'#f59e0b' }}>{'★'.repeat(Math.round(rom.rating))}</div>
                          </div>
                        </div>
                        );
                      })}
                      {(customConsoles.find(c=>c.id===romView.consoleId)?.roms||[]).filter(romMatches).length===0&&(
                        <div style={{ textAlign:'center',color:'rgba(255,255,255,.25)',paddingTop:40 }}>
                          <div style={{ fontSize:'2.5rem',marginBottom:10 }}>🎮</div>
                          <div style={{ fontSize:13 }}>{romQ ? `Sin resultados para "${romSearchQuery}"` : 'Sin ROMs todavía. ¡Agrega el primero!'}</div>
                        </div>
                      )}
                    </div>
                  </div>

                /* Main ROM view */
                ) : (
                  <>
                    {/* Sub-tab filter: Base / Custom */}
                    <div style={{ display:'flex',gap:0,marginBottom:16,background:'rgba(255,255,255,.04)',borderRadius:'2rem',padding:3,border:'1px solid rgba(255,255,255,.08)',flexShrink:0 }}>
                      {([['base','📂 Catálogo base'],['custom','⚙️ Mis consolas']] as const).map(([f,label])=>(
                        <button key={f} onClick={()=>setRomTabFilter(f)}
                          style={{ flex:1,border:'none',borderRadius:'2rem',padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                            background:romTabFilter===f?'linear-gradient(135deg,#e52d6a,#f97316)':'transparent',
                            color:romTabFilter===f?'white':'rgba(255,255,255,.45)',transition:'all .15s' }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <div style={{ position:'relative',marginBottom:10,flexShrink:0 }}>
                      <span style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:14,color:'rgba(255,255,255,.3)',pointerEvents:'none' }}>🔍</span>
                      <input
                        value={romSearchQuery}
                        onChange={e=>setRomSearchQuery(e.target.value)}
                        placeholder="Buscar ROMs por título, género, región o desarrollador..."
                        style={{ ...inputStyle,paddingLeft:36,width:'100%',boxSizing:'border-box' }}
                        onFocus={e=>(e.target as HTMLInputElement).style.borderColor='hsl(var(--primary)/.6)'}
                        onBlur={e=>(e.target as HTMLInputElement).style.borderColor='rgba(255,255,255,.1)'}
                      />
                      {romSearchQuery&&(
                        <button onClick={()=>setRomSearchQuery('')} style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'rgba(255,255,255,.4)',cursor:'pointer',fontSize:14,padding:0,lineHeight:1 }}>✕</button>
                      )}
                    </div>

                    {/* ── BASE CONSOLES ── */}
                    {romTabFilter==='base'&&(
                      addingRomToConsoleId ? (
                        <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>
                          <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexShrink:0 }}>
                            <button onClick={()=>setAddingRomToConsoleId(null)} style={{ background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.75rem',padding:'6px 14px',color:'rgba(255,255,255,.7)',cursor:'pointer',fontFamily:'inherit',fontSize:13 }}>← Volver</button>
                            <span style={{ fontSize:13,color:'rgba(255,255,255,.5)' }}>Agregar ROM a <strong style={{ color:'white' }}>{baseConsoles.find(c=>c.id===addingRomToConsoleId)?.name}</strong></span>
                          </div>
                          <RomForm
                            console={baseConsoles.find(c=>c.id===addingRomToConsoleId)}
                            onSave={rom=>handleAddRomToBaseConsole(addingRomToConsoleId, rom)}
                            onCancel={()=>setAddingRomToConsoleId(null)}/>
                        </div>
                      ) : (
                        <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10 }}>
                          {baseConsolesLocal.filter(baseConsoleMatches).map(c=>{
                            const consoleExtraRoms = (extraRoms[c.id] || []).filter(er => !c.roms.some(br => br.id === er.id));
                            const filteredBaseRoms = c.roms.filter(r => romMatches(romOverrides[r.id] || r));
                            const filteredExtraRoms = consoleExtraRoms.filter(r => romMatches(r));
                            const hasMatch = baseConsoleMatches(c);
                            const isOpen = expandedConsole===c.id || (!!romQ && hasMatch);
                            const visibleBase = c.roms.filter(r => !hiddenRomIds.includes(r.id));
                            const hiddenCount = c.roms.length - visibleBase.length;
                            const editedCount = Object.keys(romOverrides).filter(rid=>c.roms.some(r=>r.id===rid)).length;
                            const matchCount = (romQ ? (filteredBaseRoms.length + filteredExtraRoms.length) : (visibleBase.length + consoleExtraRoms.length));
                            return (
                              <div key={c.id} style={{ borderRadius:'.875rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.08)' }}>
                                {/* Console header */}
                                <div style={{ background:c.gradient,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
                                  <div onClick={()=>setExpandedConsole(isOpen ? null : c.id)} style={{ flex:1,cursor:'pointer' }}>
                                    <div style={{ fontWeight:700,color:'white',fontSize:14 }}>{c.name}</div>
                                    <div style={{ fontSize:11,color:'rgba(255,255,255,.7)',marginTop:2 }}>
                                      {c.emulator} · {matchCount} {romQ ? 'resultados' : 'ROMs'}
                                      {editedCount>0&&` · ${editedCount} editados`}
                                      {hiddenCount>0&&` · ${hiddenCount} ocultos`}
                                      {consoleExtraRoms.length>0&&` · ${consoleExtraRoms.length} agregados`}
                                    </div>
                                  </div>
                                  <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                                    <button onClick={e=>{e.stopPropagation();setAddingRomToConsoleId(c.id);setExpandedConsole(c.id);}}
                                      style={{ background:'rgba(255,255,255,.2)',border:'1px solid rgba(255,255,255,.35)',borderRadius:'.625rem',padding:'5px 12px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700 }}>
                                      + ROM
                                    </button>
                                    <span onClick={()=>setExpandedConsole(isOpen ? null : c.id)} style={{ fontSize:12,color:'rgba(255,255,255,.6)',fontWeight:600,cursor:'pointer',padding:'4px' }}>{isOpen?'▲':'▼'}</span>
                                  </div>
                                </div>
                                {/* ROM list */}
                                {isOpen&&(
                                  <div style={{ background:'rgba(0,0,0,.25)',display:'flex',flexDirection:'column',gap:0,overflowY: 'auto',height: '100%' }}>
                                    {/* Base ROMs */}
                                    {filteredBaseRoms.map((rom,i)=>{
                                      const override = romOverrides[rom.id];
                                      const displayRom = override || rom;
                                      const hasOverride = !!override;
                                      const isHidden = hiddenRomIds.includes(rom.id);
                                      const confirmKey = `del-${rom.id}`;
                                      return (
                                        <div key={rom.id} style={{ padding:'10px 16px',display:'flex',alignItems:'center',gap:12,borderTop:i>0?'1px solid rgba(255,255,255,.05)':undefined,opacity:isHidden?.45:1 }}>
                                          {displayRom.coverUrl
                                            ? <img src={displayRom.coverUrl} alt={displayRom.title} style={{ width:40,height:40,borderRadius:'.5rem',objectFit:'cover',flexShrink:0,border:'1px solid rgba(255,255,255,.1)' }}/>
                                            : <div style={{ width:40,height:40,borderRadius:'.5rem',background:'rgba(255,255,255,.08)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.3rem',flexShrink:0 }}>🎮</div>}
                                          <div style={{ flex:1,minWidth:0 }}>
                                            <div style={{ display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
                                              <span style={{ fontWeight:600,fontSize:13,color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{displayRom.title}</span>
                                              {hasOverride&&<span style={{ fontSize:10,background:'rgba(232,105,42,.2)',color:'#fb923c',padding:'1px 6px',borderRadius:20,border:'1px solid rgba(232,105,42,.3)',fontWeight:700,flexShrink:0 }}>EDITADO</span>}
                                              {isHidden&&<span style={{ fontSize:10,background:'rgba(239,68,68,.15)',color:'#f87171',padding:'1px 6px',borderRadius:20,border:'1px solid rgba(239,68,68,.25)',fontWeight:700,flexShrink:0 }}>OCULTO</span>}
                                            </div>
                                            <div style={{ fontSize:11,color:'rgba(255,255,255,.35)',marginTop:1 }}>{displayRom.region} · {displayRom.year} · {displayRom.genre}{displayRom.downloadUrl?' · ✓ Descarga':' · ✗ Sin descarga'}</div>
                                          </div>
                                          <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                                            {romDeleteConfirm===confirmKey ? (
                                              <>
                                                <span style={{ fontSize:11,color:'rgba(255,255,255,.5)',alignSelf:'center' }}>¿Eliminar?</span>
                                                <button onClick={()=>handleDeleteBaseRom(c.id, rom.id)} style={{ background:'#ef4444',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:600 }}>Sí</button>
                                                <button onClick={()=>setRomDeleteConfirm(null)} style={{ background:'rgba(255,255,255,.08)',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11 }}>No</button>
                                              </>
                                            ) : romDeleteConfirm===`rev-${rom.id}` ? (
                                              <>
                                                <span style={{ fontSize:11,color:'rgba(255,255,255,.5)',alignSelf:'center' }}>¿Revertir edición?</span>
                                                <button onClick={()=>handleDeleteRomOverride(rom.id)} style={{ background:'#ef4444',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:600 }}>Sí</button>
                                                <button onClick={()=>setRomDeleteConfirm(null)} style={{ background:'rgba(255,255,255,.08)',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11 }}>No</button>
                                              </>
                                            ) : (
                                              <>
                                                {!isHidden&&(
                                                  <button onClick={()=>setEditingBaseRom({ rom:displayRom, consoleId:c.id, consoleName:c.name, emulator:c.emulator })}
                                                    style={{ height:28,padding:'0 10px',borderRadius:'.5rem',background:'rgba(229,45,106,.15)',border:'1px solid rgba(229,45,106,.3)',color:'#f472b6',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4 }}>
                                                    ✏️ Editar
                                                  </button>
                                                )}
                                                {hasOverride&&!isHidden&&(
                                                  <button onClick={()=>setRomDeleteConfirm(`rev-${rom.id}`)} title="Revertir cambios"
                                                    style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.25)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12 }}>↺</button>
                                                )}
                                                <button onClick={()=>setRomDeleteConfirm(confirmKey)} title="Eliminar ROM"
                                                  style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.25)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13 }}>
                                                  🗑️
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* Extra ROMs added to this base console */}
                                    {filteredExtraRoms.map((rom,i)=>(
                                      <div key={rom.id} style={{ padding:'10px 16px',display:'flex',alignItems:'center',gap:12,borderTop:'1px solid rgba(255,255,255,.05)',background:'rgba(34,197,94,.03)' }}>
                                        {rom.coverUrl
                                          ? <img src={rom.coverUrl} alt={rom.title} style={{ width:40,height:40,borderRadius:'.5rem',objectFit:'cover',flexShrink:0,border:'1px solid rgba(34,197,94,.2)' }}/>
                                          : <div style={{ width:40,height:40,borderRadius:'.5rem',background:'rgba(34,197,94,.08)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.3rem',flexShrink:0 }}>🎮</div>}
                                        <div style={{ flex:1,minWidth:0 }}>
                                          <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                                            <span style={{ fontWeight:600,fontSize:13,color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{rom.title}</span>
                                            <span style={{ fontSize:10,background:'rgba(34,197,94,.2)',color:'#4ade80',padding:'1px 6px',borderRadius:20,border:'1px solid rgba(34,197,94,.3)',fontWeight:700,flexShrink:0 }}>AGREGADO</span>
                                          </div>
                                          <div style={{ fontSize:11,color:'rgba(255,255,255,.35)',marginTop:1 }}>{rom.region} · {rom.year} · {rom.genre}{rom.downloadUrl?' · ✓ Descarga':' · ✗ Sin descarga'}</div>
                                        </div>
                                        <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                                          {romDeleteConfirm===`extra-${rom.id}` ? (
                                            <>
                                              <span style={{ fontSize:11,color:'rgba(255,255,255,.5)',alignSelf:'center' }}>¿Eliminar?</span>
                                              <button onClick={()=>handleDeleteExtraRom(c.id, rom.id)} style={{ background:'#ef4444',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:600 }}>Sí</button>
                                              <button onClick={()=>setRomDeleteConfirm(null)} style={{ background:'rgba(255,255,255,.08)',border:'none',borderRadius:'.5rem',padding:'4px 10px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:11 }}>No</button>
                                            </>
                                          ) : (
                                            <>
                                              <button onClick={()=>setEditingBaseRom({ rom, consoleId:c.id, consoleName:c.name, emulator:c.emulator, isExtra:true })}
                                                style={{ height:28,padding:'0 10px',borderRadius:'.5rem',background:'rgba(229,45,106,.15)',border:'1px solid rgba(229,45,106,.3)',color:'#f472b6',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4 }}>
                                                ✏️ Editar
                                              </button>
                                              <button onClick={()=>setRomDeleteConfirm(`extra-${rom.id}`)}
                                                style={{ width:28,height:28,borderRadius:'50%',background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.25)',color:'#ef4444',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14 }}>✕</button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    {romQ && (filteredBaseRoms.length + filteredExtraRoms.length) === 0 && (
                                      <div style={{ padding:'14px 16px',borderTop:'1px solid rgba(255,255,255,.05)',color:'rgba(255,255,255,.35)',fontSize:12 }}>
                                        Sin ROMs que coincidan con "{romSearchQuery}" en esta consola.
                                      </div>
                                    )}
                                    {/* Add ROM button at bottom of list */}
                                    <div style={{ padding:'10px 16px',borderTop:'1px solid rgba(255,255,255,.05)' }}>
                                      <button onClick={()=>setAddingRomToConsoleId(c.id)}
                                        style={{ width:'100%',background:'rgba(255,255,255,.04)',border:'1px dashed rgba(255,255,255,.15)',borderRadius:'.625rem',padding:'8px',color:'rgba(255,255,255,.4)',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:500 }}>
                                        + Agregar ROM a {c.name}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}

                    {/* ── CUSTOM CONSOLES ── */}
                    {romTabFilter==='custom'&&(
                      <>
                        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexShrink:0 }}>
                          <span style={{ fontSize:13,color:'rgba(255,255,255,.5)' }}>Consolas y ROMs personalizados</span>
                          <button onClick={()=>setRomView('add-console')}
                            style={{ background:'linear-gradient(135deg,#e52d6a,#f97316)',border:'none',borderRadius:'.875rem',padding:'8px 16px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700 }}>
                            + Nueva consola
                          </button>
                        </div>
                        {visibleCustomConsoles.length===0 ? (
                          <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,color:'rgba(255,255,255,.25)' }}>
                            <div style={{ fontSize:'4rem' }}>🕹️</div>
                            <div style={{ textAlign:'center' }}>
                              <div style={{ fontSize:15,fontWeight:600,marginBottom:6 }}>{romQ ? `Sin resultados para "${romSearchQuery}"` : 'No hay consolas personalizadas'}</div>
                              <div style={{ fontSize:13 }}>{romQ ? 'Prueba con otro término o limpia la búsqueda' : 'Crea una consola primero, luego agrega sus ROMs'}</div>
                            </div>
                            <button onClick={()=>romQ ? setRomSearchQuery('') : setRomView('add-console')}
                              style={{ background:'rgba(232,105,42,.15)',border:'1px solid rgba(232,105,42,.3)',borderRadius:'2rem',padding:'10px 24px',color:'#e8692a',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:600,marginTop:4 }}>
                              {romQ ? 'Limpiar búsqueda' : 'Crear primera consola →'}
                            </button>
                          </div>
                        ) : (
                          <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10 }}>
                            {visibleCustomConsoles.map(c=>(
                              <div key={c.id} style={{ borderRadius:'.875rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.08)' }}>
                                <div style={{ background:c.gradient,padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
                                  <div>
                                    <div style={{ fontWeight:700,color:'white',fontSize:14 }}>{c.name}</div>
                                    <div style={{ fontSize:11,color:'rgba(255,255,255,.7)',marginTop:2 }}>{c.emulator} · {c.roms.length} ROMs</div>
                                  </div>
                                  <div style={{ display:'flex',gap:8 }}>
                                    <button onClick={()=>setRomView({consoleId:c.id,view:'rom-list'})}
                                      style={{ background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.25)',borderRadius:'.625rem',padding:'5px 12px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600 }}>
                                      Ver ROMs
                                    </button>
                                    <button onClick={()=>setRomView({consoleId:c.id,view:'add-rom'})}
                                      style={{ background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.25)',borderRadius:'.625rem',padding:'5px 12px',color:'white',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600 }}>
                                      + ROM
                                    </button>
                                    <button onClick={()=>handleDeleteConsole(c.id)}
                                      style={{ width:30,height:30,borderRadius:'50%',background:'rgba(0,0,0,.25)',border:'1px solid rgba(255,255,255,.15)',color:'rgba(255,255,255,.6)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13 }}>✕</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
