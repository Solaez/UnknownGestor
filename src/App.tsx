import React, { useState, useEffect, useRef, useCallback } from "react";
import type { App } from "./data/apps";
import { AdminPanel, loadCustomApps, loadCustomConsoles, loadHiddenAppIds, loadRomOverrides, loadExtraRoms, loadHiddenRomIds } from "./AdminPanel";
import type { ExtraRoms } from "./AdminPanel";
import type { DownloadEntry } from "./data/apps";
type RomOverrides = Record<string, Rom>;

// ─── Electron Utilities ───────────────────────────────────────────────────────
const isElectron = !!(window as any).require;
const fs = isElectron ? (window as any).require('fs') : null;
const path = isElectron ? (window as any).require('path') : null;
const https = isElectron ? (window as any).require('https') : null;
const http = isElectron ? (window as any).require('http') : null;
const os = isElectron ? (window as any).require('os') : null;
const electron = isElectron ? (window as any).require('electron') : null;
const shell = electron ? electron.shell : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// Gestor de Torrent Global (Removido del renderizador por compatibilidad)

// ─── Node Fetch Helper (To bypass CORS) ───────────────────────────────────────
async function nodeFetch(url: string, options: any = {}): Promise<any> {
  if (!isElectron || !https) {
    const res = await fetch(url, options);
    if (options.returnFull) {
      return { data: await res.json(), headers: Object.fromEntries(res.headers.entries()) };
    }
    return res.json();
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const headers = { ...(options.headers || {}) };
    
    if (options.body) {
      const isJson = typeof options.body !== 'string';
      const bodyStr = isJson ? JSON.stringify(options.body) : options.body;
      const byteLength = typeof Buffer !== 'undefined' 
        ? Buffer.byteLength(bodyStr) 
        : new TextEncoder().encode(bodyStr).length;
      
      headers['Content-Length'] = byteLength;
      options.body = bodyStr;
      
      if (isJson && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: headers
    };

    const req = https.request(reqOptions, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400 && !options.ignoreError) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        if (options.returnFull) {
          resolve({ data: parsed, headers: res.headers });
        } else {
          resolve(parsed);
        }
      });
    });

    req.on('error', (e: any) => reject(e));
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── IGDB API Integration ─────────────────────────────────────────────────────
const IGDB_CLIENT_ID = 'sfmq38omo45t49q8izcxjbf188lcan';
const IGDB_CLIENT_SECRET = 'fmx7bwhs40sp9q5dqk37710dyy3ye6';
let igdbToken: string | null = null;

// Cargar caché de IGDB desde sessionStorage si existe
const loadIgdbCache = (): Record<string, any> => {
  try {
    const saved = sessionStorage.getItem('igdb_cache');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
};

const igdbCache: Record<string, any> = loadIgdbCache();

const saveIgdbCache = () => {
  try {
    sessionStorage.setItem('igdb_cache', JSON.stringify(igdbCache));
  } catch (e) {
    console.warn("No se pudo guardar el caché de IGDB en sessionStorage", e);
  }
};

// ─── Global Responsive Styles ────────────────────────────────────────────────
function GlobalStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      @media (max-width: 900px) {
        .sidebar-container {
          display: none;
        }
        .hero-preview-container {
          display: none;
        }
        .hero-text-content {
          flex: 1 !important;
          padding: 0 20px !important;
        }
        .hero-title {
          font-size: 2.5rem !important;
        }
        .stats-grid {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        .titlebar-search {
          max-width: 150px !important;
        }
        .titlebar-version {
          display: none !important;
        }
        .titlebar-clock {
          display: none !important;
        }
      }

      @media (max-width: 600px) {
        .hero-carousel {
          height: 350px !important;
        }
        .hero-title {
          font-size: 2rem !important;
        }
        .hero-desc {
          display: none !important;
        }
        .hero-badge {
          font-size: 9px !important;
          padding: 4px 10px !important;
        }
        .btn-hero-main {
          padding: 10px 20px !important;
          font-size: 14px !important;
        }
        .btn-hero-sec {
          display: none !important;
        }
        .stats-grid {
          gap: 10px !important;
        }
        .titlebar-tabs {
          display: none !important;
        }
        .titlebar-search {
          flex: 1 !important;
          max-width: none !important;
        }
      }

      .apps-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 20px;
      }

      @media (max-width: 650px) {
        .apps-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Custom Scrollbar for better UX */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    `}} />
  );
}

// ─── IGDB Rate Limit & Queue ──────────────────────────────────────────────────
interface QueuedRequest {
  fn: () => Promise<any>;
  resolve: (val: any) => void;
  reject: (err: any) => void;
  retries: number;
}

const igdbQueue: QueuedRequest[] = [];
let activeRequests = 0;
const MAX_CONCURRENT = 4; // Permitir hasta 4 peticiones a la vez
const MAX_RETRIES = 3;
const REQUEST_DELAY = 150; // ms entre ráfagas para evitar 429

async function processIgdbQueue() {
  if (activeRequests >= MAX_CONCURRENT || igdbQueue.length === 0) return;

  while (igdbQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
    const request = igdbQueue.shift();
    if (!request) continue;

    activeRequests++;
    
    (async () => {
      try {
        const result = await request.fn();
        request.resolve(result);
      } catch (err: any) {
        // Si es un error 429 (Too Many Requests), reintentamos con retraso
        if (err.message?.includes('429') && request.retries < MAX_RETRIES) {
          request.retries++;
          const delay = 1500 * Math.pow(2, request.retries);
          console.warn(`IGDB 429 detectado. Reintentando en ${delay}ms... (Intento ${request.retries})`);
          
          setTimeout(() => {
            igdbQueue.push(request);
            processIgdbQueue();
          }, delay);
        } else {
          request.reject(err);
        }
      } finally {
        activeRequests--;
        // Pequeño respiro antes de procesar la siguiente en este slot
        setTimeout(() => processIgdbQueue(), REQUEST_DELAY);
      }
    })();
  }
}

function enqueueIgdbRequest(fn: () => Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    igdbQueue.push({ fn, resolve, reject, retries: 0 });
    processIgdbQueue();
  });
}

async function getIgdbToken() {
  if (igdbToken) return igdbToken;
  try {
    const data = await nodeFetch(`https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`, {
      method: 'POST'
    });
    if (data && data.access_token) {
      igdbToken = data.access_token;
      return igdbToken;
    }
    throw new Error("No access_token in response");
  } catch (err) {
    console.error("IGDB Auth Error:", err);
    if (err instanceof Error) showToast(`IGDB Auth Error: ${err.message}`, 'error');
    return null;
  }
}

async function fetchIgdbData(title: string, consoleName?: string) {
  const cacheKey = `${title}-${consoleName}`;
  if (igdbCache[cacheKey]) return igdbCache[cacheKey];

  return enqueueIgdbRequest(async () => {
    // Re-check cache inside the queue in case it was populated while waiting
    if (igdbCache[cacheKey]) return igdbCache[cacheKey];

    const token = await getIgdbToken();
    if (!token) return null;

    const IGDB_PLATFORM_MAP: Record<string, number> = {
      'wii': 5, 'gamecube': 21, 'gc': 21, 'n64': 4, 'snes': 19, 'nes': 18, 'switch': 130,
      'gba': 24, 'gbc': 22, 'gb': 33, 'nds': 20, '3ds': 37, 'ps1': 7, 'ps2': 8,
      'ps3': 9, 'psp': 38, 'psvita': 46, 'wiiu': 41, 'dreamcast': 23, 'genesis': 29,
      'saturn': 32, 'gamegear': 35, 'master-system': 64, 'playstation1': 7, 'playstation2': 8,
      'playstation3': 9, 'nintendo64': 4
    };

    let platformId = 0;
    if (consoleName) {
      const slug = consoleName.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Try exact match first
      for (const key in IGDB_PLATFORM_MAP) {
        if (slug === key || slug.includes(key)) {
          platformId = IGDB_PLATFORM_MAP[key];
          break;
        }
      }
    }

    // Search for the game
    const cleanTitle = title.replace(/\(.*\)|\[.*\]/g, '').trim();
    const executeQuery = async (pId: number) => {
      let q = `fields name, summary, total_rating, total_rating_count, first_release_date, 
                 cover.url, screenshots.url, videos.video_id,
                 involved_companies.developer, involved_companies.company.name;
                 search "${cleanTitle.replace(/"/g, '\\"')}";`;
      if (pId) q += ` where platforms = (${pId});`;
      q += ` limit 10;`;

      return await nodeFetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': IGDB_CLIENT_ID,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain'
        },
        body: q
      });
    };

    let results = await executeQuery(platformId);

    // Fallback: if no results with platform, try without platform
    if ((!results || !Array.isArray(results) || results.length === 0) && platformId !== 0) {
      results = await executeQuery(0);
    }

    if (!results || !Array.isArray(results) || results.length === 0) return null;

    // Find best match
    let bestMatch = results[0];
    const target = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // 1. Try exact match
    const exactMatch = results.find(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === target);
    if (exactMatch) {
      bestMatch = exactMatch;
    } else {
      // 2. Try match that contains target
      const partialMatch = results.find(r => {
        const current = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return current.includes(target) || target.includes(current);
      });
      if (partialMatch) bestMatch = partialMatch;
    }

    // Process URLs to get high quality images
    const processImg = (url: string) => {
      if (!url) return null;
      let finalUrl = url.startsWith('//') ? 'https:' + url : url;
      // IGDB URL usually looks like //images.igdb.com/igdb/image/upload/t_thumb/co1lc5.jpg
      return finalUrl.replace('/t_thumb/', '/t_720p/').replace('/t_cover_big/', '/t_720p/');
    };
    const processCover = (url: string) => {
      if (!url) return null;
      let finalUrl = url.startsWith('//') ? 'https:' + url : url;
      return finalUrl.replace('/t_thumb/', '/t_cover_big/').replace('/t_720p/', '/t_cover_big/');
    };

    const finalData = {
      details: {
        ...bestMatch,
        cover_url: processCover(bestMatch.cover?.url),
        background_image: processImg(bestMatch.screenshots?.[0]?.url),
        description_raw: bestMatch.summary,
        released: bestMatch.first_release_date ? new Date(bestMatch.first_release_date * 1000).toISOString().split('T')[0] : null,
        rating: bestMatch.total_rating ? bestMatch.total_rating / 10 : 0,
        ratings_count: bestMatch.total_rating_count || 0,
        developers: bestMatch.involved_companies?.filter((c: any) => c.developer).map((c: any) => ({ name: c.company.name })) || []
      },
      screenshots: bestMatch.screenshots?.map((s: any) => ({ image: processImg(s.url) })) || [],
      trailers: bestMatch.videos?.map((v: any) => ({ name: 'Trailer', videoId: v.video_id })) || []
    };
    
    igdbCache[cacheKey] = finalData;
    saveIgdbCache(); // Persistir en la sesión
    return finalData;
  }).catch(err => {
    console.error("IGDB API Error:", err);
    // Solo mostramos toast si NO es un error de rate limit (porque esos se reintentan)
    if (err instanceof Error && !err.message.includes('429')) {
      showToast(`IGDB Error: ${err.message}`, 'error');
    }
    return null;
  });
}

async function resolve1FichierLink(url: string): Promise<string> {
  if (!isElectron || !https) return url;
  
  console.log("Resolving 1Fichier link:", url);
  try {
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Referer': 'https://1fichier.com/'
    };

    // 1. Obtener la página inicial y capturar cookies (con ignoreError para ver el bot check)
    const response = await nodeFetch(url, { headers: baseHeaders, returnFull: true, ignoreError: true });
    const html = response.data;
    if (typeof html !== 'string') return url;

    // Si detectamos bloqueo por JS/Cookies (Error #122), devolvemos el link original 
    // para que downloadFile use el fallback de la ventana de Electron.
    if (html.includes('error #122') || html.includes('Javascript') || html.includes('accept cookies')) {
      console.warn("1Fichier Bot Check detected, falling back to window...");
      return url; 
    }

    // Extraer cookies de Set-Cookie
    let cookies = '';
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
        .map(c => c.split(';')[0])
        .join('; ');
    }

    // Verificar si hay tiempo de espera
    if (html.includes('Waiting time') || html.includes('You must wait')) {
      const waitMatch = html.match(/(\d+)\s+minutes/i);
      const minutes = waitMatch ? waitMatch[1] : '?';
      throw new Error(`1Fichier: Debes esperar ${minutes} minutos entre descargas.`);
    }

    // 2. Enviar el formulario con las cookies obtenidas
    const postResponse = await nodeFetch(url, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://1fichier.com',
        'Referer': url,
        'Cookie': cookies
      },
      body: 'dl_no_ssl=1&d_password=0',
      returnFull: true,
      ignoreError: true
    });

    const directLinkHtml = postResponse.data;
    if (typeof directLinkHtml !== 'string') return url;

    // 3. Buscar el enlace de descarga real
    const linkMatch = directLinkHtml.match(/href="(https?:\/\/[^"]+\.1fichier\.com\/dl\/[^"]+)"/i);
    if (linkMatch && linkMatch[1]) {
      console.log("Direct link resolved with session:", linkMatch[1]);
      return linkMatch[1];
    }

    if (directLinkHtml.includes('captcha')) {
      throw new Error("1Fichier: Captcha detectado. Abre el link una vez en tu navegador.");
    }

    return url;
  } catch (e) {
    console.error("Error resolving 1Fichier link:", e);
    if (e instanceof Error) showToast(e.message, 'error');
    return url;
  }
}

async function resolveMediaFireLink(url: string): Promise<string> {
  if (!isElectron) return url;
  try {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('resolve-mediafire', url);
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve(url), 30000);
        ipcRenderer.once('resolved-mediafire', (event: any, resolvedUrl: string) => {
          clearTimeout(t);
          resolve(resolvedUrl && typeof resolvedUrl === 'string' ? resolvedUrl : url);
        });
      });
    }
    return url;
  } catch {
    return url;
  }
}

async function resolveRomsFunLink(url: string): Promise<{url: string, cookies: string, userAgent: string}> {
  if (!isElectron) return { url, cookies: '', userAgent: '' };
  try {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('resolve-romsfun', url);
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ url, cookies: '', userAgent: '' }), 45000);
        ipcRenderer.once('resolved-romsfun', (event: any, result: any) => {
          clearTimeout(t);
          if (result && typeof result === 'object') {
            resolve({ 
              url: result.url || url, 
              cookies: result.cookies || '',
              userAgent: result.userAgent || ''
            });
          } else {
            resolve({ url: result || url, cookies: '', userAgent: '' });
          }
        });
      });
    }
    return { url, cookies: '', userAgent: '' };
  } catch {
    return { url, cookies: '', userAgent: '' };
  }
}

async function resolveNswpediaLink(url: string): Promise<{url: string, cookies: string, userAgent: string}> {
  if (!isElectron) return { url, cookies: '', userAgent: '' };
  try {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('resolve-nswpedia', url);
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ url, cookies: '', userAgent: '' }), 45000);
        ipcRenderer.once('resolved-nswpedia', (event: any, result: any) => {
          clearTimeout(t);
          if (result && typeof result === 'object') {
            resolve({ 
              url: result.url || url, 
              cookies: result.cookies || '',
              userAgent: result.userAgent || ''
            });
          } else {
            resolve({ url: result || url, cookies: '', userAgent: '' });
          }
        });
      });
    }
    return { url, cookies: '', userAgent: '' };
  } catch {
    return { url, cookies: '', userAgent: '' };
  }
}


const downloadControllers: Record<string, { abort: () => void; pause: () => void; resume: () => void; isPaused: boolean }> = {};

async function downloadTorrent(magnet: string, filename: string, onProgress: (p: number) => void, downloadId?: string): Promise<string> {
  if (!isElectron) return Promise.reject("Not in Electron");
  
  const { ipcRenderer } = window.require('electron');
  
  return new Promise((resolve, reject) => {
    showToast('Iniciando descarga de Torrent en segundo plano...', 'info');

    if (downloadId) {
      downloadControllers[downloadId] = {
        abort: () => { 
          ipcRenderer.send('cancel-torrent', { downloadId });
          delete downloadControllers[downloadId]; 
        },
        pause: () => { /* No soportado aún en IPC */ },
        resume: () => { /* No soportado aún en IPC */ },
        isPaused: false
      };
    }

    ipcRenderer.send('start-torrent', { magnet, downloadId });

    const progressHandler = (event: any, data: any) => {
      if (data.downloadId === downloadId) {
        onProgress(data.progress);
      }
    };

    const doneHandler = (event: any, data: any) => {
      if (data.downloadId === downloadId) {
        onProgress(100);
        showToast(`Descarga completada: ${data.name}`, 'success');
        ipcRenderer.removeListener('torrent-progress', progressHandler);
        ipcRenderer.removeListener('torrent-done', doneHandler);
        ipcRenderer.removeListener('torrent-error', errorHandler);
        resolve(data.path);
      }
    };

    const errorHandler = (event: any, data: any) => {
      if (data.downloadId === downloadId) {
        showToast(`Error en torrent: ${data.error}`, 'error');
        ipcRenderer.removeListener('torrent-progress', progressHandler);
        ipcRenderer.removeListener('torrent-done', doneHandler);
        ipcRenderer.removeListener('torrent-error', errorHandler);
        reject(new Error(data.error));
      }
    };

    ipcRenderer.on('torrent-progress', progressHandler);
    ipcRenderer.on('torrent-done', doneHandler);
    ipcRenderer.on('torrent-error', errorHandler);
  });
}

async function downloadFile(url: string, filename: string, onProgress: (p: number) => void, downloadId?: string): Promise<string> {
  if (!isElectron || !fs || !path || !https || !os) {
    console.warn("Not in Electron environment, falling back to window.open");
    window.open(url, '_blank');
    return Promise.resolve('');
  }

  // Detectar Magnet Link
  if (url.startsWith('magnet:')) {
    return downloadTorrent(url, filename, onProgress, downloadId);
  }

  let finalUrl = url;
  let downloadCookies = '';
  let downloadUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let referer = 'https://romsfun.com/';

  if (url.includes('nswpedia.com')) referer = 'https://nswpedia.com/';
  if (url.includes('romsfun.com')) referer = 'https://romsfun.com/';


  if (url.includes('romsfun.com/download/')) {
    showToast('Preparando descarga (esperando respuesta del servidor)...', 'info');
    const resolved = await resolveRomsFunLink(url);
    if (resolved.url && resolved.url !== url) {
      finalUrl = resolved.url;
      downloadCookies = resolved.cookies;
      if (resolved.userAgent) downloadUserAgent = resolved.userAgent;
    } else {
      throw new Error('No se pudo resolver el enlace de RomsFun automáticamente.');
    }
  }

  if (url.includes('nswpedia.com/download/')) {
    showToast('Preparando descarga (esperando 12s)...', 'info');
    const resolved = await resolveNswpediaLink(url);
    if (resolved.url && resolved.url !== url) {
      finalUrl = resolved.url;
      downloadCookies = resolved.cookies;
      if (resolved.userAgent) downloadUserAgent = resolved.userAgent;

      // Extraer nombre de archivo real del enlace final si es posible
      try {
        const urlObj = new URL(finalUrl);
        let urlFilename = path.basename(urlObj.pathname);
        
        // Si el nombre es genérico como 'download_list', intentar sacarlo de los parámetros
        if (urlFilename === 'download_list' || !urlFilename.includes('.')) {
          const searchParams = new URLSearchParams(urlObj.search);
          const fileParam = searchParams.get('file') || searchParams.get('name');
          if (fileParam) urlFilename = fileParam;
        }

        if (urlFilename && urlFilename !== 'download_list' && urlFilename.includes('.')) {
          filename = decodeURIComponent(urlFilename);
        }
      } catch (e) {}
    } else {
      throw new Error('No se pudo resolver el enlace de NswPedia automáticamente.');
    }
  }

  if (url.includes('mediafire.com/file/')) {
    showToast('Obteniendo enlace directo de MediaFire...', 'info');
    const resolved = await resolveMediaFireLink(url);
    if (resolved && resolved !== url) {
      finalUrl = resolved;
    }
  }
  
  if (url.includes('1fichier.com')) {
    showToast('Intentando descarga automática de 1Fichier...', 'info');
    finalUrl = await resolve1FichierLink(url);
    
    if (finalUrl === url) {
      showToast('Se requiere verificación manual para 1Fichier.', 'info');
      if (isElectron && window.require) {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.send('download-window', url);
        
        return new Promise((resolve) => {
          ipcRenderer.once('resolved-1fichier', (event: any, resolvedUrl: string) => {
            downloadFile(resolvedUrl, filename, onProgress, downloadId).then(resolve);
          });
        });
      } else {
        window.open(url, '_blank');
        return Promise.resolve('');
      }
    }
  }

  let absoluteUrl = finalUrl;
  if (!finalUrl.startsWith('http')) {
    absoluteUrl = new URL(finalUrl, window.location.href).toString();
  }

  if (!path.extname(filename) && absoluteUrl.includes('.')) {
    const urlPath = new URL(absoluteUrl).pathname;
    const ext = path.extname(urlPath);
    if (ext && ext.length <= 5) filename += ext;
  }

  const defaultDownloadsPath = path.join(os.homedir(), 'Downloads');
  const downloadsPath = localStorage.getItem('appstore_download_path') || defaultDownloadsPath;

  if (!fs.existsSync(downloadsPath)) {
    try { fs.mkdirSync(downloadsPath, { recursive: true }); } catch(e) { console.error("Error creating downloads dir", e); }
  }
  
  const filePath = path.join(downloadsPath, filename);
  let finalFilePath = filePath;
  
  return new Promise((resolve, reject) => {
    let file: any = null;
    let request: any = null;
    let isAborted = false;
    let isPausing = false;

    const cleanup = () => {
      if (file) { file.close(); file = null; }
      if (downloadId) delete downloadControllers[downloadId];
    };

    const startReq = (startByte = 0) => {
      isPausing = false;
      const protocol = absoluteUrl.startsWith('https') ? https : http;
      const options: any = { 
        headers: {
          'User-Agent': downloadUserAgent,
          'Accept': '*/*',
          'Referer': referer,
          'Cookie': downloadCookies,
          'Connection': 'keep-alive'
        },
        timeout: 60000
      };
      
      if (startByte > 0) {
        options.headers['Range'] = `bytes=${startByte}-`;
      }

      if (request) request.destroy();

      request = protocol.get(absoluteUrl, options, (response: any) => {
        // 1. Manejar redirecciones ANTES de crear el archivo
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const newLocation = response.headers.location;
          if (newLocation) {
            absoluteUrl = new URL(newLocation, absoluteUrl).toString();
            startReq(startByte);
            return;
          }
        }

        // --- NUEVA LÓGICA: EXTRAER NOMBRE DE CABECERAS ---
        const contentDisp = response.headers['content-disposition'];
        if (contentDisp && contentDisp.includes('filename=')) {
          let match = contentDisp.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)['"]?/i);
          if (match && match[1]) {
            const realName = decodeURIComponent(match[1].replace(/['"]/g, ''));
            if (realName && realName.includes('.')) {
              finalFilePath = path.join(downloadsPath, realName);
            }
          }
        }
        // ------------------------------------------------

        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && (absoluteUrl.includes('romsfun') || absoluteUrl.includes('romsfast'))) {
          cleanup();
          reject(new Error("El servidor devolvió HTML. El enlace de descarga ha caducado."));
          return;
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          cleanup();
          reject(new Error(`Error ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const contentLength = parseInt(response.headers['content-length'], 10);
        const totalSize = (isNaN(contentLength) ? 0 : contentLength) + startByte;
        let downloadedSize = startByte;
        let lastReportedProgress = 0;

        // 2. Crear el archivo SOLO cuando ya tenemos respuesta exitosa (usando finalFilePath)
        if (!file) {
          file = fs.createWriteStream(finalFilePath, { flags: startByte > 0 ? 'a' : 'w' });
        }
        
        response.on('data', (chunk: any) => {
          if (isAborted) return;
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const currentProgress = Number(((downloadedSize / totalSize) * 100).toFixed(1));
            if (currentProgress > lastReportedProgress) {
              lastReportedProgress = currentProgress;
              onProgress(Math.min(currentProgress, 99.9)); // Mantener en 99.9% hasta el finish
            }
          }
        });

        response.pipe(file);

        response.on('end', () => {
          // El servidor cerró la conexión correctamente
        });

        file.on('finish', () => {
          if (isAborted || isPausing) return;
          
          // 3. Verificación de tamaño más flexible para servidores de PS3/Grandes
          // Si descargamos al menos el 95% o el servidor no dio tamaño, lo damos por bueno
          const isSizeOk = totalSize === 0 || downloadedSize >= (totalSize * 0.95);
          
          if (isSizeOk) {
            cleanup();
            onProgress(100);
            resolve(finalFilePath);
          } else {
            cleanup();
            reject(new Error(`Descarga incompleta: ${downloadedSize} de ${totalSize} bytes.`));
          }
        });

        file.on('error', (err: any) => {
          cleanup();
          fs.unlink(finalFilePath, () => {});
          reject(err);
        });
      });

      request.on('error', (err: any) => {
        if (isAborted) return;
        cleanup();
        reject(err);
      });
    };

    if (downloadId) {
      downloadControllers[downloadId] = {
        abort: () => {
          isAborted = true;
          if (request) request.destroy();
          cleanup();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          reject(new Error('Descarga cancelada'));
        },
        pause: () => {
          isPausing = true;
          if (request) request.destroy();
          if (file) { file.close(); file = null; }
          downloadControllers[downloadId].isPaused = true;
        },
        resume: () => {
          if (!downloadControllers[downloadId].isPaused) return;
          const stats = fs.statSync(filePath);
          downloadControllers[downloadId].isPaused = false;
          startReq(stats.size);
        },
        isPaused: false
      };
    }

    startReq();
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Rom { id:string;title:string;region:string;size:string;rating:number;year:number;genre:string;players:string;description:string;developer:string;downloadUrl:string;downloads?:DownloadEntry[];coverUrl:string;screenshots:string[];videoId:string;instructions:string[]; }
interface Console { id:string;name:string;shortName:string;gradient:string;logoText:string;description:string;emulator:string;fileExtensions:string[];romCount:number;roms:Rom[]; }
interface RomsData { consoles: Console[] }
interface AppsData { apps: App[] }
type Theme = 'default' | 'moody' | 'midnight' | 'forest' | 'fire';
type Language = 'es' | 'en';
interface DownloadRecord { id: string; name: string; icon: string; type: 'app'|'rom'|'mod'; category: string; size: string; date: string; filePath?: string; }
interface ActiveDownload { id: string; name: string; icon: string; progress: number; size?: string; isPaused?: boolean; speedBps?: number; etaSec?: number; spark?: number[]; _lastTs?: number; _lastProgress?: number; _totalBytes?: number; }
const DOWNLOAD_HISTORY_KEY = 'appstore_download_history';
const LIBRARY_KEY = 'appstore_rom_library';
const EMULATOR_PATHS_KEY = 'appstore_emulator_paths';
const ROM_PATHS_KEY = 'appstore_rom_paths';

interface LibraryItem {
  rom: Rom;
  console: Console;
  cachedCover?: string;
}

function loadLibrary(): LibraryItem[] {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); } catch { return []; }
}
function saveToLibrary(item: LibraryItem) {
  const lib = loadLibrary();
  const index = lib.findIndex(i => i.rom.id === item.rom.id);
  if (index !== -1) {
    lib[index] = item;
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  } else {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify([...lib, item]));
  }
}
function removeFromLibrary(romId: string) {
  const lib = loadLibrary();
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib.filter(i => i.rom.id !== romId)));
}

// Persistencia de Emuladores por Consola
function saveEmulatorPath(consoleName: string, path: string) {
  const paths = JSON.parse(localStorage.getItem(EMULATOR_PATHS_KEY) || '{}');
  paths[consoleName] = path;
  localStorage.setItem(EMULATOR_PATHS_KEY, JSON.stringify(paths));
}
function getEmulatorPath(consoleName: string): string {
  const paths = JSON.parse(localStorage.getItem(EMULATOR_PATHS_KEY) || '{}');
  return paths[consoleName] || '';
}

// Persistencia de Rutas de ROMs por juego
function saveRomPath(romId: string, path: string) {
  const paths = JSON.parse(localStorage.getItem(ROM_PATHS_KEY) || '{}');
  paths[romId] = path;
  localStorage.setItem(ROM_PATHS_KEY, JSON.stringify(paths));
}
function getRomPath(romId: string): string {
  const paths = JSON.parse(localStorage.getItem(ROM_PATHS_KEY) || '{}');
  return paths[romId] || '';
}

async function imageUrlToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Error caching image:", e);
    return null;
  }
}

function parseSizeToBytes(size?: string): number | null {
  if (!size) return null;
  const s = size.trim().replace(',', '.');
  const m = s.match(/([\d.]+)\s*(TB|GB|MB|KB|B|G|M|K)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  const mult =
    unit === 'TB' ? 1024 ** 4 :
    unit === 'GB' || unit === 'G' ? 1024 ** 3 :
    unit === 'MB' || unit === 'M' ? 1024 ** 2 :
    unit === 'KB' || unit === 'K' ? 1024 :
    1;
  return Math.round(n * mult);
}
function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}
function formatSpeed(bps?: number) {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return '—';
  const mb = bps / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bps / 1024;
  return `${kb.toFixed(0)} KB/s`;
}
function formatEta(sec?: number) {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}
function loadDownloadHistory(): DownloadRecord[] {
  try { return JSON.parse(localStorage.getItem(DOWNLOAD_HISTORY_KEY)||'[]'); } catch { return []; }
}
function saveDownloadRecord(record: DownloadRecord) {
  const history = loadDownloadHistory();
  const updated = [record, ...history.filter(r=>r.id!==record.id)].slice(0,100);
  localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(updated));
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const s = size;
  const icons: Record<string, React.ReactNode> = {
    trash:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>,
    plus:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    link:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    home:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    grid:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    refresh:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
    monitor:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    cpu:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>,
    gamepad:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/><path d="M6 6h12c2.21 0 4 1.79 4 4v4c0 2.21-1.79 4-4 4H6c-2.21 0-4-1.79-4-4v-4c0-2.21 1.79-4 4-4z"/></svg>,
    code:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
    pen:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
    disc:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>,
    folder:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    wrench:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
    zoomIn:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
    zoomOut:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
    maximize:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>,
    terminal:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
    search:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    bell:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    download:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    arrowLeft: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
    arrowRight:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
    wifi:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" strokeLinecap="round"/></svg>,
    clock:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    check:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    x:         <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    info:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3" strokeLinecap="round"/></svg>,
    star:      <svg width={s} height={s} viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    starEmpty: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    play:      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    fileOpen:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
    run:       <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    image:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
    video:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="15" height="10" rx="2"/><polygon points="22 7 16 12 22 17 22 7" fill="currentColor"/></svg>,
    windows:   <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>,
    trophy:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/><path d="M7 4H4l1 5a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4l1-5h-3"/><line x1="7" y1="4" x2="17" y2="4"/></svg>,
    lock:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    settings:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    user:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    share:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
    heart:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    sun:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
    moon:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    globe:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    palette:   <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
    shield:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    zap:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/></svg>,
    sparkles:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3L9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5L12 3z" fill="currentColor"/></svg>,
    flame:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill="currentColor"/></svg>,
    tag:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="3" strokeLinecap="round"/></svg>,
    hdd:       <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16" strokeWidth="3" strokeLinecap="round"/><line x1="10" y1="16" x2="10.01" y2="16" strokeWidth="3" strokeLinecap="round"/></svg>,
    users:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    calendar:  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  };
  return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icons[name] || null}</span>;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
interface ToastMsg { id: number; text: string; type: 'success'|'info'|'error' }
let _toastId = 0;
let _setToasts: React.Dispatch<React.SetStateAction<ToastMsg[]>> | null = null;
function showToast(text: string, type: ToastMsg['type'] = 'info') {
  if (_setToasts) {
    const id = ++_toastId;
    _setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => _setToasts!(p => p.filter(t => t.id !== id)), 3200);
  }
}
function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  useEffect(() => { _setToasts = setToasts; return () => { _setToasts = null; }; }, []);
  const colors = { success: '#22c55e', info: '#3b82f6', error: '#ef4444' };
  return (
    <div style={{ position:'fixed',bottom:20,right:20,zIndex:999,display:'flex',flexDirection:'column',gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background:'hsl(var(--card))',border:'1px solid hsl(var(--border))',borderRadius:'.75rem',padding:'10px 16px',fontSize:13,boxShadow:'0 8px 30px rgba(0,0,0,.5)',display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ color: colors[t.type] }}><Icon name={t.type==='success'?'check':t.type==='error'?'x':'info'} size={15}/></span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  const h = t.getHours().toString().padStart(2,'0');
  const m = t.getMinutes().toString().padStart(2,'0');
  const d = t.getDate().toString().padStart(2,'0');
  return <div style={{ fontSize:'1.05rem',fontWeight:700,letterSpacing:'.05em',color:'rgba(255,255,255,.65)',whiteSpace:'nowrap',userSelect:'none' }}>{h}:{m} <span style={{ fontSize:'.7rem',opacity:.6 }}>{d}</span></div>;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, color='#e8692a' }: { value:number; color?:string }) {
  return (
    <div style={{ height:4,background:'rgba(255,255,255,.12)',borderRadius:4,overflow:'hidden',width:'100%' }}>
      <div style={{ height:'100%',width:`${value}%`,background:color,borderRadius:4,transition:'width .25s' }}/>
    </div>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────
function SplashScreen({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 22 + 8;
      if (p >= 100) { p = 100; clearInterval(iv); }
      setProgress(Math.min(p, 100));
    }, 80);
    const t1 = setTimeout(() => setExiting(true), 2000);
    const t2 = setTimeout(() => onDone(), 2500);
    return () => { clearInterval(iv); clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,background:'hsl(var(--background))',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:28 }}
      className={exiting ? 'splash-exit' : ''}>
      {/* Dot matrix background */}
      <div style={{ position:'absolute',inset:0,backgroundImage:'radial-gradient(circle, rgba(255,255,255,.025) 1px, transparent 1px)',backgroundSize:'24px 24px',pointerEvents:'none' }}/>
      {/* Glow radial */}
      <div style={{ position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:400,height:400,background:'radial-gradient(circle, hsl(var(--primary)/.2), transparent 70%)',pointerEvents:'none' }}/>

      {/* Logo */}
      <div className="splash-logo" style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:16,position:'relative',zIndex:1 }}>
        <div style={{ width:90,height:90,borderRadius:'1.5rem',background:'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2.8rem',boxShadow:`0 0 60px hsl(var(--primary)/.4), 0 0 120px hsl(var(--primary)/.15)`,position:'relative' }}>
          <div className="pulse-ring"/>
          <div className="pulse-ring" style={{ animationDelay:'.5s' }}/>
          🚀
        </div>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:'1.8rem',fontWeight:900,letterSpacing:'-.01em',background:'linear-gradient(135deg,white,hsl(var(--primary)))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text' }}>
            AppStore XD
          </div>
          <div style={{ fontSize:13,color:'hsl(var(--muted-foreground))',marginTop:4 }}>v2.0 — Cargando...</div>
        </div>
      </div>

      {/* Loading bar */}
      <div style={{ width:220,position:'relative',zIndex:1 }}>
        <ProgressBar value={progress} color='hsl(var(--primary))'/>
        <div style={{ fontSize:11,color:'hsl(var(--muted-foreground))',textAlign:'center',marginTop:8 }}>{progress.toFixed(1)}%</div>
      </div>
    </div>
  );
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const USER_SESSION_KEY = 'appstore_user_session';
const USERS_DB_KEY = 'appstore_users_db';
interface UserSession { username: string; email: string; role: 'admin' | 'user' }
interface StoredUser { username: string; email: string; password: string; role: 'admin' | 'user' }
const ADMIN_CREDENTIALS: Record<string, string> = { solaez: 'solaez', unknown: 'solaez' };

function loadUserSession(): UserSession | null {
  try { return JSON.parse(localStorage.getItem(USER_SESSION_KEY) || 'null'); } catch { return null; }
}
function saveUserSession(session: UserSession) {
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session));
}
function clearUserSession() { localStorage.removeItem(USER_SESSION_KEY); }

function loadUsersDb(): Record<string, StoredUser> {
  try { return JSON.parse(localStorage.getItem(USERS_DB_KEY) || '{}'); } catch { return {}; }
}
function saveUsersDb(db: Record<string, StoredUser>) {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(db));
}

function authLogin(username: string, password: string): { ok: boolean; session?: UserSession; error?: string } {
  const u = username.trim().toLowerCase();
  const p = password.trim();
  if (ADMIN_CREDENTIALS[u] !== undefined) {
    if (ADMIN_CREDENTIALS[u] !== p) return { ok: false, error: 'Contraseña incorrecta.' };
    return { ok: true, session: { username: u, email: `${u}@admin.local`, role: 'admin' } };
  }
  const db = loadUsersDb();
  const stored = db[u];
  if (!stored) return { ok: false, error: 'Usuario no encontrado. ¿Quieres crear una cuenta?' };
  if (stored.password !== p) return { ok: false, error: 'Contraseña incorrecta.' };
  return { ok: true, session: { username: stored.username, email: stored.email, role: 'user' } };
}

function authRegister(username: string, email: string, password: string): { ok: boolean; session?: UserSession; error?: string } {
  const u = username.trim().toLowerCase();
  if (ADMIN_CREDENTIALS[u] !== undefined) return { ok: false, error: 'Ese nombre de usuario no está disponible.' };
  if (u.length < 3) return { ok: false, error: 'El usuario debe tener al menos 3 caracteres.' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) return { ok: false, error: 'Correo electrónico inválido.' };
  if (password.trim().length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
  const db = loadUsersDb();
  if (db[u]) return { ok: false, error: 'Ese usuario ya existe. Intenta iniciar sesión.' };
  const newUser: StoredUser = { username: u, email: email.trim(), password: password.trim(), role: 'user' };
  db[u] = newUser;
  saveUsersDb(db);
  return { ok: true, session: { username: u, email: email.trim(), role: 'user' } };
}

function AuthPanel({ onLogin, onClose }: { onLogin: (session: UserSession) => void; onClose?: () => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function reset() { setUsername(''); setEmail(''); setPassword(''); setError(''); }
  function switchTab(t: 'login' | 'register') { setTab(t); reset(); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim() || (tab === 'register' && !email.trim())) {
      setError('Por favor completa todos los campos.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      const result = tab === 'login'
        ? authLogin(username, password)
        : authRegister(username, email, password);
      if (result.ok && result.session) {
        saveUserSession(result.session);
        onLogin(result.session);
      } else {
        setError(result.error || 'Error desconocido.');
      }
      setLoading(false);
    }, 500);
  }

  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '.75rem', color: 'white', padding: '13px 16px', fontSize: 14,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'all .2s',
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }} onClick={onClose}/>
      <div className="settings-panel" style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(680px, 96vw)', background: 'linear-gradient(160deg, #0f0f18 0%, #0a0a14 100%)', borderLeft: '1px solid rgba(255,255,255,0.08)', zIndex: 9001, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        
        {/* Header */}
        <div style={{ padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 950, fontSize: 26, letterSpacing: '-0.01em', color: '#f2f6ff' }}>
              {tab === 'login' ? '🔑 Iniciar Sesión' : '🚀 Crear Cuenta'}
            </div>
            <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(210,225,255,0.72)' }}>
              {tab === 'login' ? 'Bienvenido de nuevo a AppStore XD.' : 'Únete a la comunidad y gestiona tus apps.'}
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="btn-icon" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)' }}>
              <Icon name="x" size={18}/>
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left info panel (Desktop only) */}
          <div className="hero-preview-container" style={{ flex: '0 0 35%', background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)', padding: '32px', display: 'flex', flexDirection: 'column', gap: 24, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'hsl(var(--primary)/.2)', color: 'hsl(var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🚀</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { ico: '🔒', tit: 'Seguridad', desc: 'Tus datos están cifrados y seguros.' },
                { ico: '⚡', tit: 'Velocidad', desc: 'Descargas sin límites de velocidad.' },
                { ico: '🎮', tit: 'Catálogo', desc: 'Miles de ROMs y apps a tu alcance.' }
              ].map(item => (
                <div key={item.tit}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'white', marginBottom: 4 }}>
                    <span>{item.ico}</span> {item.tit}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Form panel */}
          <div style={{ flex: 1, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.04)', borderRadius: '1rem', padding: 4 }}>
              {(['login', 'register'] as const).map(t => (
                <button key={t} onClick={() => switchTab(t)}
                  style={{ flex: 1, border: 'none', borderRadius: '.75rem', padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s', background: tab === t ? 'hsl(var(--primary))' : 'transparent', color: tab === t ? 'white' : 'rgba(255,255,255,.4)' }}>
                  {t === 'login' ? 'Entrar' : 'Registrarse'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Usuario</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Tu nombre de usuario" style={inp} autoComplete="username"
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'hsl(var(--primary))'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,.12)'}/>
              </div>

              {tab === 'register' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" style={inp} autoComplete="email"
                    onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'hsl(var(--primary))'}
                    onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,.12)'}/>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Contraseña</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inp} autoComplete="current-password"
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'hsl(var(--primary))'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,.12)'}/>
              </div>

              {error && (
                <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: '10px', color: '#ef4444', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap:10 }}>
                  <Icon name="info" size={16}/> {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                style={{ marginTop: 10, background: 'white', color: '#0f0f18', border: 'none', borderRadius: '1rem', padding: '14px', fontSize: 15, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all .2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 10px 25px rgba(255,255,255,0.1)' }}
                onMouseEnter={e => { if(!loading) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { if(!loading) e.currentTarget.style.transform = ''; }}>
                {loading ? <Icon name="refresh" size={18}/> : <Icon name="check" size={18}/>}
                {tab === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
              </button>
            </form>

            <div style={{ marginTop: 'auto', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.5 }}>
              Al continuar, aceptas nuestros términos de servicio y política de privacidad.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
interface SettingsProps {
  theme: Theme; onTheme: (t: Theme) => void;
  lang: Language; onLang: (l: Language) => void;
  onClose: () => void;
  onAdmin: () => void;
  onDev: () => void;
  onControllerTest: () => void;
  isAdmin: boolean;
  currentUser: UserSession;
  onLogout: () => void;
}
const THEMES: { id: Theme; label: string; color: string; icon: string }[] = [
  { id:'default', label:'Oscuro', color:'hsl(250 80% 65%)', icon:'moon' },
  { id:'moody',   label:'Moody',  color:'hsl(280 75% 60%)', icon:'sparkles' },
  { id:'midnight',label:'Medianoche', color:'hsl(210 90% 60%)', icon:'sun' },
  { id:'forest',  label:'Bosque', color:'hsl(145 65% 50%)', icon:'zap' },
  { id:'fire',    label:'Fuego',  color:'hsl(20 90% 55%)',  icon:'flame' },
];

function ControllerTestModal({ onClose }: { onClose: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [connected, setConnected] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<{ name: string; index: number; buttons: any[]; axes: number[]; hasVibration: boolean } | null>(null);
  const lastPressRef = useRef<{ idx: number; ts: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const pickPad = (pads: any[]) => {
    if (pads.length === 0) return null;
    if (selectedIndex !== null) {
      const found = pads.find(p => p && p.index === selectedIndex);
      if (found) return found;
    }
    return pads[0];
  };

  const getHasVibration = (gp: any) => {
    const va = gp?.vibrationActuator;
    if (va && typeof va.playEffect === 'function') return true;
    const ha = gp?.hapticActuators?.[0];
    if (ha && typeof ha.pulse === 'function') return true;
    return false;
  };

  const pulse = async () => {
    const gp = (navigator as any).getGamepads?.()?.[selectedIndex ?? 0];
    if (!gp) return;
    try {
      if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
        await gp.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 280, weakMagnitude: 0.9, strongMagnitude: 0.9 });
        showToast('Vibración: OK', 'success');
        return;
      }
      if (gp.hapticActuators?.[0] && typeof gp.hapticActuators[0].pulse === 'function') {
        await gp.hapticActuators[0].pulse(1.0, 280);
        showToast('Vibración: OK', 'success');
        return;
      }
      showToast('Este mando no soporta vibración', 'info');
    } catch (e) {
      showToast('No se pudo activar la vibración', 'error');
    }
  };

  useEffect(() => {
    const tick = () => {
      const padsArr = Array.from((navigator as any).getGamepads?.() || []).filter(Boolean) as any[];
      setConnected(padsArr);
      const gp = pickPad(padsArr);
      if (gp) {
        if (selectedIndex === null) setSelectedIndex(gp.index);
        const hasVibration = getHasVibration(gp);
        const buttons = Array.isArray(gp.buttons) ? gp.buttons : [];
        const axes = Array.isArray(gp.axes) ? gp.axes : [];
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i]?.pressed) {
            const prev = lastPressRef.current;
            if (!prev || prev.idx !== i) lastPressRef.current = { idx: i, ts: Date.now() };
          }
        }
        setSnapshot({ name: gp.id || 'Mando', index: gp.index, buttons, axes, hasVibration });
      } else {
        setSnapshot(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [selectedIndex]);

  const btn = (i: number) => !!snapshot?.buttons?.[i]?.pressed;
  const val = (i: number) => Number(snapshot?.buttons?.[i]?.value || 0);
  const ax = (i: number) => Number(snapshot?.axes?.[i] || 0);
  
  const isXbox = snapshot?.name.toLowerCase().includes('xbox') || snapshot?.name.toLowerCase().includes('x-input') || snapshot?.name.toLowerCase().includes('microsoft');

  const stickDot = (x: number, y: number) => ({ cx: x + ax(0) * 20, cy: y + ax(1) * 20 });
  const stickDotR = (x: number, y: number) => ({ cx: x + ax(2) * 20, cy: y + ax(3) * 20 });

  const left = isXbox ? stickDot(180, 190) : stickDot(280, 280);
  const right = isXbox ? stickDotR(440, 280) : stickDotR(440, 280);

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.65)',backdropFilter:'blur(10px)',zIndex:650 }} />
      <div style={{ position:'fixed',inset:0,zIndex:651,display:'flex',alignItems:'stretch',justifyContent:'flex-end',background:'rgba(10,16,28,.45)',backdropFilter:'blur(5px)',pointerEvents:'none' }}>
        <div style={{ width:'min(680px,96vw)',background:'linear-gradient(160deg,rgb(15,15,24) 0%,rgb(10,10,20) 100%)',borderLeft:'1px solid rgba(255,255,255,.08)',display:'flex',flexDirection:'column',height:'100%',pointerEvents:'auto',animation:'settingsSlideIn .3s cubic-bezier(.22,1,.36,1) forwards' }}>
          <div style={{ padding:'20px 22px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
            <div style={{ flex:1,textAlign:'left' }}>
              <div style={{ fontWeight:950,fontSize:26,letterSpacing:'-.01em',color:'#f2f6ff' }}>🎮 Test de Mando {isXbox ? '(Xbox)' : '(PlayStation)'}</div>
              <div style={{ marginTop:8,fontSize:14,color:'rgba(210,225,255,.72)' }}>Diseño adaptativo según el mando conectado.</div>
            </div>
            <button onClick={onClose} className="btn-icon" style={{ width:36,height:36,borderRadius:10,background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.18)',color:'rgba(255,255,255,.9)' }}><Icon name="x" size={16}/></button>
          </div>

          <div style={{ flex:1,minHeight:0,display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'16px 18px 20px',gap:16 }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',justifyContent:'space-between',padding:'10px',borderRadius:'1rem',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.09)',backdropFilter:'blur(4px)' }}>
              <select value={selectedIndex ?? ''} onChange={e => setSelectedIndex(e.target.value === '' ? null : Number(e.target.value))}
                style={{ background:'rgba(27,35,58,.9)',border:'1px solid rgba(116,152,255,.5)',borderRadius:999,padding:'10px 14px',color:'rgba(237,244,255,.95)',fontFamily:'inherit',fontSize:13,outline:'none',minWidth:260,flex:'1 1 auto',boxShadow:'inset 0 2px 6px rgba(0,0,0,.3)' }}>
                {connected.length === 0 ? <option value="">Sin mandos conectados</option> : connected.map(g => <option key={g.index} value={g.index}>{(g.id || 'Mando').slice(0, 44)} (#{g.index})</option>)}
              </select>
              <button onClick={pulse} disabled={!snapshot?.hasVibration}
                style={{ padding:'10px 14px',borderRadius:999,border:'1px solid rgba(83,112,220,.6)',background: snapshot?.hasVibration ? 'linear-gradient(135deg, rgba(255,210,98,.35), rgba(255,164,60,.32))' : 'rgba(255,255,255,.08)',color: snapshot?.hasVibration ? '#ffe7b3' : 'rgba(255,255,255,.55)',cursor: snapshot?.hasVibration ? 'pointer' : 'not-allowed',fontFamily:'inherit',fontWeight:800,fontSize:13,display:'flex',alignItems:'center',gap:8,flexShrink:0,transition:'transform .15s' }}>
                <Icon name="zap" size={15}/> {snapshot?.hasVibration ? 'Probar vibración' : 'Vibración ND'}
              </button>
            </div>

            {!snapshot ? (
              <div style={{ textAlign:'center',color:'rgba(250,250,255,.85)',marginTop:12,padding:'22px',borderRadius:'1rem',border:'1px dashed rgba(255,255,255,.25)',background:'rgba(6,12,24,.5)' }}>
                <div style={{ fontSize:64,marginBottom:8 }}>🎮</div>
                <div style={{ fontWeight:900,fontSize:18 }}>No hay mandos conectados</div>
                <div style={{ fontSize:13,marginTop:6,color:'rgba(220,234,255,.72)' }}>Conecta por USB o Bluetooth y presiona un botón para iniciar.</div>
              </div>
            ) : (
              <>
                <div style={{ width:'100%',maxWidth:880,display:'flex',justifyContent:'center' }}>
                  <svg viewBox="0 0 720 420" style={{ width:'100%',maxWidth:920,height:'auto',filter:'drop-shadow(0 22px 70px rgba(0,0,0,.55))' }}>
                    <defs>
                      <linearGradient id="padBody" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="rgba(255,255,255,.14)"/>
                        <stop offset="1" stopColor="rgba(255,255,255,.05)"/>
                      </linearGradient>
                    </defs>

                    {isXbox ? (
                      /* --- DISEÑO XBOX --- */
                      <g>
                        <path d="M180 80 Q360 70 540 80 Q630 90 660 160 Q690 260 620 340 Q580 380 500 350 Q460 330 420 310 Q360 300 300 310 Q260 330 220 350 Q140 380 100 340 Q30 260 60 160 Q90 90 180 80 Z" fill="url(#padBody)" stroke="rgba(255,255,255,.3)" strokeWidth="2.5" />
                        
                        {/* Gatillos Xbox */}
                        <rect x="140" y="40" width="100" height="40" rx="10" fill={val(6) > 0.1 ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.2)" />
                        <rect x="480" y="40" width="100" height="40" rx="10" fill={val(7) > 0.1 ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.2)" />
                        <rect x="140" y="70" width="100" height="20" rx="5" fill={btn(4) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />
                        <rect x="480" y="70" width="100" height="20" rx="5" fill={btn(5) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />

                        {/* Sticks Asimétricos */}
                        <circle cx="180" cy="190" r="45" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.15)" strokeWidth="2"/>
                        <circle cx={left.cx} cy={left.cy} r="22" fill={btn(10) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.3)"} stroke="rgba(255,255,255,.5)" strokeWidth="2" />

                        <circle cx="440" cy="280" r="45" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.15)" strokeWidth="2"/>
                        <circle cx={right.cx} cy={right.cy} r="22" fill={btn(11) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.3)"} stroke="rgba(255,255,255,.5)" strokeWidth="2" />

                        {/* Botones A, B, X, Y */}
                        <g transform="translate(540, 190)">
                          <circle cx="0" cy="-40" r="20" fill={btn(3) ? "#facc15" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <text x="0" y="-34" textAnchor="middle" fill={btn(3)?"#000":"#facc15"} style={{fontSize:18,fontWeight:900}}>Y</text>
                          <circle cx="40" cy="0" r="20" fill={btn(1) ? "#ef4444" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <text x="40" y="6" textAnchor="middle" fill={btn(1)?"#000":"#ef4444"} style={{fontSize:18,fontWeight:900}}>B</text>
                          <circle cx="-40" cy="0" r="20" fill={btn(2) ? "#3b82f6" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <text x="-40" y="6" textAnchor="middle" fill={btn(2)?"#000":"#3b82f6"} style={{fontSize:18,fontWeight:900}}>X</text>
                          <circle cx="0" cy="40" r="20" fill={btn(0) ? "#22c55e" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <text x="0" y="46" textAnchor="middle" fill={btn(0)?"#000":"#22c55e"} style={{fontSize:18,fontWeight:900}}>A</text>
                        </g>

                        {/* D-Pad Xbox */}
                        <g transform="translate(280, 280)">
                          <circle cx="0" cy="0" r="40" fill="rgba(0,0,0,.3)" stroke="rgba(255,255,255,.1)" />
                          <path d="M-6 -10 L6 -10 L6 -30 L-6 -30 Z" fill={btn(12) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M-6 10 L6 10 L6 30 L-6 30 Z" fill={btn(13) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M-10 -6 L-10 6 L-30 6 L-30 -6 Z" fill={btn(14) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M10 -6 L10 6 L30 6 L30 -6 Z" fill={btn(15) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                        </g>

                        {/* Botones Centrales Xbox */}
                        <circle cx="360" cy="160" r="22" fill={btn(16) ? "#facc15" : "rgba(255,255,255,.15)"} stroke="rgba(255,255,255,.4)" strokeWidth="2" />
                        <path d="M352 160 L368 160 M360 152 L360 168" fill="none" stroke="white" strokeWidth="3" transform="rotate(45 360 160)" />
                        <rect x="310" y="185" width="20" height="12" rx="6" fill={btn(8) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />
                        <rect x="390" y="185" width="20" height="12" rx="6" fill={btn(9) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />
                      </g>
                    ) : (
                      /* --- DISEÑO PLAYSTATION (PS4) --- */
                      <g>
                        <path d="M180 100 Q360 90 540 100 Q630 110 650 160 Q670 240 640 320 Q610 380 540 350 Q500 330 460 300 Q410 270 360 270 Q310 270 260 300 Q220 330 180 350 Q110 380 80 320 Q50 240 70 160 Q90 110 180 100 Z" fill="url(#padBody)" stroke="rgba(255,255,255,.3)" strokeWidth="2.5" />
                        <rect x="230" y="105" width="260" height="90" rx="10" fill={btn(17) ? "rgba(218,142,53,.8)" : "rgba(255,255,255,.05)"} stroke="rgba(255,255,255,.2)" strokeWidth="2" />
                        <rect x="200" y="115" width="12" height="30" rx="6" fill={btn(8) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />
                        <rect x="508" y="115" width="12" height="30" rx="6" fill={btn(9) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} />
                        <path d="M140 95 Q180 60 220 95" fill="none" stroke={btn(4) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} strokeWidth="14" strokeLinecap="round" />
                        <path d="M500 95 Q540 60 580 95" fill="none" stroke={btn(5) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} strokeWidth="14" strokeLinecap="round" />
                        <path d="M140 85 Q180 30 220 85" fill="none" stroke={val(6) > 0.1 ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.08)"} strokeWidth="12" strokeLinecap="round" />
                        <path d="M500 85 Q540 30 580 85" fill="none" stroke={val(7) > 0.1 ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.08)"} strokeWidth="12" strokeLinecap="round" />
                        <circle cx="280" cy="280" r="45" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.15)" strokeWidth="2"/>
                        <circle cx={left.cx} cy={left.cy} r="22" fill={btn(10) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.3)"} stroke="rgba(255,255,255,.5)" strokeWidth="2" />
                        <circle cx="440" cy="280" r="45" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.15)" strokeWidth="2"/>
                        <circle cx={right.cx} cy={right.cy} r="22" fill={btn(11) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.3)"} stroke="rgba(255,255,255,.5)" strokeWidth="2" />
                        <g transform="translate(540, 190)">
                          <circle cx="0" cy="-40" r="20" fill={btn(3) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <path d="M-6 -34 L6 -34 L0 -45 Z" fill="none" stroke="#5cdb95" strokeWidth="2.5" strokeLinejoin="round" />
                          <circle cx="40" cy="0" r="20" fill={btn(1) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <circle cx="40" cy="0" r="8" fill="none" stroke="#ef4444" strokeWidth="2.5" />
                          <circle cx="-40" cy="0" r="20" fill={btn(2) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <rect x="-47" y="-7" width="14" height="14" fill="none" stroke="#fbbf24" strokeWidth="2.5" rx="1" />
                          <circle cx="0" cy="40" r="20" fill={btn(0) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.1)"} stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
                          <path d="M-6 34 L6 46 M6 34 L-6 46" fill="none" stroke="#6366f1" strokeWidth="2.5" />
                        </g>
                        <g transform="translate(180, 190)">
                          <circle cx="0" cy="0" r="45" fill="rgba(0,0,0,.2)" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" />
                          <path d="M-8 -15 L8 -15 L8 -40 L-8 -40 Z" fill={btn(12) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M-8 15 L8 15 L8 40 L-8 40 Z" fill={btn(13) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M-15 -8 L-15 8 L-40 8 L-40 -8 Z" fill={btn(14) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                          <path d="M15 -8 L15 8 L40 8 L40 -8 Z" fill={btn(15) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.2)"} />
                        </g>
                        <circle cx="360" cy="305" r="18" fill={btn(16) ? "rgba(218,142,53,.95)" : "rgba(255,255,255,.15)"} stroke="rgba(255,255,255,.4)" strokeWidth="2" />
                        <path d="M354 305 Q360 295 366 305 Q360 315 354 305" fill="none" stroke="white" strokeWidth="2" />
                      </g>
                    )}
                  </svg>
                </div>

                <div style={{ display:'flex',gap:14,flexWrap:'wrap',justifyContent:'center',marginTop:6 }}>
                  <div style={{ minWidth:220,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.10)',borderRadius:16,padding:'10px 14px',backdropFilter:'blur(10px)' }}>
                    <div style={{ fontSize:12,fontWeight:900,color:'rgba(255,255,255,.7)',marginBottom:4 }}>Izquierdo</div>
                    <div style={{ fontSize:13,color:'rgba(255,255,255,.8)' }}>X: {ax(0).toFixed(2)} · Y: {ax(1).toFixed(2)}</div>
                  </div>
                  <div style={{ minWidth:220,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.10)',borderRadius:16,padding:'10px 14px',backdropFilter:'blur(10px)' }}>
                    <div style={{ fontSize:12,fontWeight:900,color:'rgba(255,255,255,.7)',marginBottom:4 }}>Derecho</div>
                    <div style={{ fontSize:13,color:'rgba(255,255,255,.8)' }}>X: {ax(2).toFixed(2)} · Y: {ax(3).toFixed(2)}</div>
                  </div>
                  <div style={{ minWidth:260,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.10)',borderRadius:16,padding:'10px 14px',backdropFilter:'blur(10px)' }}>
                    <div style={{ fontSize:12,fontWeight:900,color:'rgba(255,255,255,.7)',marginBottom:4 }}>Estado</div>
                    <div style={{ fontSize:13,color:'rgba(255,255,255,.8)' }}>
                      {lastPressRef.current ? `Último botón: #${lastPressRef.current.idx}` : 'Presiona cualquier botón'}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SourceManager({ title, sources, onAdd, onRemove, icon, accentColor }: { title: string; sources: string[]; onAdd: (url: string) => void; onRemove: (url: string) => void; icon: string; accentColor: string }) {
  const [newUrl, setNewUrl] = useState('');
  const [showInput, setShowInput] = useState(false);
  return (
    <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.08)', borderRadius:'.875rem', padding:'16px', display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, color:'rgba(255,255,255,.4)' }}>
          <Icon name={icon} size={14}/>
          <span style={{ fontWeight:700, fontSize:11, textTransform:'uppercase', letterSpacing:'.08em' }}>{title}</span>
        </div>
        <button 
          onClick={() => setShowInput(!showInput)}
          style={{ background:`${accentColor}15`, color:accentColor, border:`1px solid ${accentColor}33`, borderRadius:8, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6, transition:'all .2s' }}
          onMouseEnter={e => e.currentTarget.style.background = `${accentColor}25`}
          onMouseLeave={e => e.currentTarget.style.background = `${accentColor}15`}
        >
          <Icon name={showInput ? 'x' : 'plus'} size={12}/>
          {showInput ? 'Cancelar' : 'Agregar link'}
        </button>
      </div>

      {showInput && (
        <div style={{ display:'flex', gap:8, animation:'slideDown .2s ease' }}>
          <input 
            value={newUrl} 
            onChange={e => setNewUrl(e.target.value)}
            placeholder="Pegar link JSON aquí..." 
            autoFocus
            style={{ flex:1, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', borderRadius:'8px', padding:'8px 12px', color:'white', fontSize:12, outline:'none', fontFamily:'inherit' }}
            onKeyDown={e => { if(e.key === 'Enter' && newUrl.trim()) { onAdd(newUrl.trim()); setNewUrl(''); setShowInput(false); } }}
          />
          <button 
            onClick={() => { if(newUrl.trim()) { onAdd(newUrl.trim()); setNewUrl(''); setShowInput(false); } }}
            style={{ background:accentColor, color:'white', border:'none', borderRadius:'8px', width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <Icon name="check" size={16}/>
          </button>
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {sources.map(url => (
            <div key={url} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'rgba(0,0,0,.2)', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{url}</div>
              <button onClick={() => onRemove(url)} style={{ background:'transparent', border:'none', color:'#ef4444', cursor:'pointer', padding:2, display:'flex', opacity:0.7 }} onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='0.7'}>
                <Icon name="trash" size={13}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SourcesPanelProps {
  appSources: string[];
  romSources: string[];
  onAddAppSource: (url: string) => void;
  onRemoveAppSource: (url: string) => void;
  onAddRomSource: (url: string) => void;
  onRemoveRomSource: (url: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function SourcesPanel({ appSources, romSources, onAddAppSource, onRemoveAppSource, onAddRomSource, onRemoveRomSource, onRefresh, onClose }: SourcesPanelProps) {
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',backdropFilter:'blur(4px)',zIndex:600 }}/>
      <div className="settings-panel" style={{ position:'fixed',right:0,top:0,bottom:0,width:'min(680px, 96vw)',background:'linear-gradient(160deg, #0f0f18 0%, #0a0a14 100%)',borderLeft:'1px solid rgba(255,255,255,0.08)',zIndex:601,display:'flex',flexDirection:'column',overflowY:'auto' }}>
        <div style={{ padding:'24px 28px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontWeight:950, fontSize:26, letterSpacing:'-0.01em', color:'#f2f6ff' }}>🔗 Fuentes de Contenido</div>
            <div style={{ marginTop:8, fontSize:14, color:'rgba(210,225,255,0.72)' }}>Gestiona tus catálogos remotos de aplicaciones y juegos.</div>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ width:36, height:36, borderRadius:10, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.18)', color:'rgba(255,255,255,0.9)' }}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div style={{ padding:'28px', display:'flex', flexDirection:'column', gap:24 }}>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button onClick={onRefresh} className="btn-primary" style={{ padding:'10px 20px', fontSize:13, fontWeight:800, borderRadius:99, display:'flex', alignItems:'center', gap:8 }}>
              <Icon name="refresh" size={14}/> Sincronizar todo
            </button>
          </div>

          <SourceManager 
            title="Apps & Programas" 
            sources={appSources} 
            onAdd={onAddAppSource} 
            onRemove={onRemoveAppSource} 
            icon="grid"
            accentColor="hsl(var(--primary))"
          />
          
          <SourceManager 
            title="Consolas & ROMs" 
            sources={romSources} 
            onAdd={onAddRomSource} 
            onRemove={onRemoveRomSource} 
            icon="disc"
            accentColor="#e8692a"
          />

          <div style={{ padding:'20px', borderRadius:'1rem', border:'1px dashed rgba(255,255,255,0.25)', background:'rgba(6,12,24,0.5)', textAlign:'center', color:'rgba(220,234,255,0.72)', fontSize:13 }}>
            <div style={{ fontSize:32, marginBottom:10 }}>💡</div>
            Los enlaces deben apuntar a un archivo JSON válido con el formato compatible de la AppStore XD.
          </div>
        </div>
      </div>
    </>
  );
}

function SettingsPanel({ theme, onTheme, lang, onLang, onClose, onAdmin, onDev, onControllerTest, isAdmin, currentUser, onLogout, onOpenSources }: SettingsProps & { onOpenSources: () => void }) {
  return (
    <>
    
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',backdropFilter:'blur(4px)',zIndex:500 }}/>
      <div className="settings-panel" style={{ position:'fixed',right:0,top:0,bottom:0,width:340,background:'hsl(var(--card))',borderLeft:'1px solid hsl(var(--border))',zIndex:501,display:'flex',flexDirection:'column',overflowY:'auto' }}>
        {/* Header */}
        <div style={{ padding:'20px 20px 14px',borderBottom:'1px solid hsl(var(--border))',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',gap:10 }}>
            <div style={{ width:38,height:38,borderRadius:'50%',background:'hsl(var(--muted))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.1rem' }}>👤</div>
            <div>
              <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                <span style={{ fontWeight:700,fontSize:15 }}>{currentUser.username}</span>
                {isAdmin && <span style={{ fontSize:10,fontWeight:700,background:'hsl(var(--primary)/.2)',color:'hsl(var(--primary))',padding:'1px 7px',borderRadius:20,border:'1px solid hsl(var(--primary)/.3)' }}>ADMIN</span>}
              </div>
              <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))' }}>{currentUser.email}</div>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon"><Icon name="x" size={18}/></button>
        </div>

        <div style={{ padding:'20px',display:'flex',flexDirection:'column',gap:24 }}>
          {/* Theme */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="palette" size={16}/>
              <span style={{ fontWeight:600,fontSize:14 }}>Tema de color</span>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
              {THEMES.map(t => (
                <button key={t.id} onClick={()=>onTheme(t.id)}
                  style={{ border:`2px solid ${theme===t.id ? t.color : 'hsl(var(--border))'}`,background:theme===t.id?`${t.color}18`:'hsl(var(--muted))',borderRadius:'.75rem',padding:'10px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,transition:'all .15s',color:'hsl(var(--foreground))' }}>
                  <div style={{ width:14,height:14,borderRadius:'50%',background:t.color,flexShrink:0 }}/>
                  <span style={{ fontSize:13,fontWeight:500 }}>{t.label}</span>
                  {theme===t.id&&<Icon name="check" size={13}/>}
                </button>
              ))}
            </div>
          </section>

          {/* Language */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="globe" size={16}/>
              <span style={{ fontWeight:600,fontSize:14 }}>Idioma / Language</span>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              {([['es','🇪🇸 Español'],['en','🇺🇸 English']] as [Language,string][]).map(([id,label]) => (
                <button key={id} onClick={()=>onLang(id)}
                  style={{ flex:1,border:`2px solid ${lang===id?'hsl(var(--primary))':'hsl(var(--border))'}`,background:lang===id?'hsl(var(--primary)/.15)':'hsl(var(--muted))',borderRadius:'.75rem',padding:'10px 12px',cursor:'pointer',fontSize:13,fontWeight:500,color:'hsl(var(--foreground))',transition:'all .15s' }}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Fuentes de datos */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="link" size={16}/>
              <span style={{ fontWeight:700,fontSize:15,letterSpacing:'.01em' }}>Fuentes de contenido</span>
            </div>
            <button onClick={onOpenSources}
              style={{ width:'100%',background:'linear-gradient(135deg, rgba(232,105,42,.15), rgba(255,160,60,.12))',border:'1px solid rgba(232,105,42,.35)',borderRadius:'1rem',padding:'14px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:14,color:'hsl(var(--foreground))',fontFamily:'inherit',fontWeight:700,boxShadow:'0 10px 30px rgba(0,0,0,.14)',transition:'transform .17s, box-shadow .17s' }}
              onMouseEnter={e=>{ const t=e.currentTarget; t.style.transform='translateY(-1px)'; t.style.boxShadow='0 14px 36px rgba(0,0,0,.24)'; }}
              onMouseLeave={e=>{ const t=e.currentTarget; t.style.transform=''; t.style.boxShadow='0 10px 30px rgba(0,0,0,.14)'; }}>
              <div style={{ width:42,height:42,borderRadius:'12px',background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 }}>🔗</div>
              <div style={{ textAlign:'left' }}>
                <div style={{ fontWeight:900,fontSize:15 }}>Gestionar fuentes</div>
                <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))',marginTop:2 }}>GitHub, JSONs remotos y catálogos</div>
              </div>
              <span style={{ marginLeft:'auto',color:'rgba(232,105,42,.8)',fontSize:16 }}>→</span>
            </button>
          </section>

          {/* App info */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="shield" size={16}/>
              <span style={{ fontWeight:600,fontSize:14 }}>Acerca del programa</span>
            </div>
            <div style={{ background:'hsl(var(--muted))',borderRadius:'.875rem',padding:'14px 16px',display:'flex',flexDirection:'column',gap:8,fontSize:13 }}>
              {[['Versión','2.0.0'],['Autor','Unknown Solaez'],['Licencia','A lo prestado jsjsj'],['Motor','React 19 + Vite 6']].map(([k,v])=>(
                <div key={k} style={{ display:'flex',justifyContent:'space-between' }}>
                  <span style={{ color:'hsl(var(--muted-foreground))' }}>{k}</span>
                  <span style={{ fontWeight:500 }}>{v}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="gamepad" size={16}/>
              <span style={{ fontWeight:700,fontSize:15,letterSpacing:'.01em' }}>Test de mando</span>
            </div>
            <button onClick={onControllerTest}
              style={{ width:'100%',background:'linear-gradient(135deg, rgba(60,118,255,.18), rgba(203,94,255,.15))',border:'1px solid rgba(138,168,255,.45)',borderRadius:'1rem',padding:'14px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:14,color:'hsl(var(--foreground))',fontFamily:'inherit',fontWeight:700,boxShadow:'0 10px 30px rgba(0,0,0,.14)',transition:'transform .17s, box-shadow .17s' }}
              onMouseEnter={e=>{ const t=e.currentTarget; t.style.transform='translateY(-1px)'; t.style.boxShadow='0 14px 36px rgba(0,0,0,.24)'; }}
              onMouseLeave={e=>{ const t=e.currentTarget; t.style.transform=''; t.style.boxShadow='0 10px 30px rgba(0,0,0,.14)'; }}>
              <div style={{ width:42,height:42,borderRadius:'12px',background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 }}>🎮</div>
              <div style={{ textAlign:'left' }}>
                <div style={{ fontWeight:900,fontSize:15 }}>Abrir test de mando</div>
                <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))',marginTop:2 }}>Botones, sticks y vibración en vivo</div>
              </div>
              <span style={{ marginLeft:'auto',color:'rgba(85,95,255,.8)',fontSize:16 }}>→</span>
            </button>
          </section>

          {/* Manage content — admin only */}
{isAdmin && (
<section>
  <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
    <Icon name="folder" size={16}/>
    <span style={{ fontWeight:600,fontSize:14 }}>Administrar contenido</span>
  </div>
  <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
    <button onClick={()=>{ onClose(); onAdmin(); }}
      style={{ width:'100%',background:'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',border:'none',borderRadius:'.875rem',padding:'13px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:12,color:'white',fontFamily:'inherit',transition:'opacity .15s' }}
      onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.opacity='.9'}
      onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.opacity='1'}>
      <div style={{ width:38,height:38,borderRadius:'.75rem',background:'rgba(255,255,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 }}>⚙️</div>
      <div style={{ textAlign:'left' }}>
        <div style={{ fontWeight:700,fontSize:14 }}>Abrir gestor de contenido</div>
        <div style={{ fontSize:12,opacity:.75,marginTop:2 }}>Agrega programas, consolas y ROMs</div>
      </div>
      <span style={{ marginLeft:'auto',opacity:.6,fontSize:18 }}>→</span>
    </button>

    {/* Dev button */}
    <button onClick={()=>{ onClose(); onDev(); }}
      style={{ width:'100%',background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.875rem',padding:'11px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:12,color:'hsl(var(--foreground))',fontFamily:'inherit',transition:'background .15s' }}
      onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,.09)'}
      onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,.04)'}>
      <div style={{ width:38,height:38,borderRadius:'.75rem',background:'rgba(34,197,94,.12)',border:'1px solid rgba(34,197,94,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.1rem',flexShrink:0 }}>🛠️</div>
      <div style={{ textAlign:'left' }}>
        <div style={{ fontWeight:700,fontSize:14,display:'flex',alignItems:'center',gap:7 }}>
          Dev
          <span style={{ fontSize:10,fontWeight:700,background:'rgba(34,197,94,.15)',color:'#22c55e',padding:'1px 7px',borderRadius:20,border:'1px solid rgba(34,197,94,.3)' }}>ADMIN</span>
        </div>
        <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))',marginTop:2 }}>Acceso rápido al panel de administración</div>
      </div>
      <span style={{ marginLeft:'auto',color:'rgba(255,255,255,.25)',fontSize:16 }}>→</span>
    </button>
  </div>
</section>
)}    

          {/* Clear cache */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="zap" size={16}/>
              <span style={{ fontWeight:600,fontSize:14 }}>Mantenimiento</span>
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
              <button className="btn-secondary" style={{ width:'100%',justifyContent:'center' }} onClick={()=>showToast('Caché limpiada','success')}>
                Limpiar caché
              </button>
              <button className="btn-secondary" style={{ width:'100%',justifyContent:'center' }} onClick={()=>showToast('Actualizando...','info')}>
                Buscar actualizaciones
              </button>
            </div>
          </section>

          {/* Logout */}
          <section>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:12 }}>
              <Icon name="folder" size={16}/>
              <span style={{ fontWeight:600,fontSize:14 }}>Carpeta de descargas</span>
            </div>
            <div style={{ background:'hsl(var(--muted))',borderRadius:'.875rem',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10 }}>
              <div style={{ fontSize:11,color:'hsl(var(--muted-foreground))',wordBreak:'break-all',lineHeight:1.4 }}>
                {localStorage.getItem('appstore_download_path') || (os ? path.join(os.homedir(), 'Downloads') : 'No definido')}
              </div>
              <button onClick={async () => {
                if (isElectron) {
                  const { ipcRenderer } = window.require('electron');
                  ipcRenderer.send('select-download-folder');
                  ipcRenderer.once('selected-download-folder', (event: any, folderPath: string) => {
                    if (folderPath) {
                      localStorage.setItem('appstore_download_path', folderPath);
                      showToast('Carpeta actualizada correctamente', 'success');
                      onClose(); // Cerrar para refrescar
                    }
                  });
                }
              }}
              style={{ width:'100%',background:'hsl(var(--primary)/.1)',border:'1px solid hsl(var(--primary)/.3)',borderRadius:'.5rem',padding:'8px 12px',cursor:'pointer',fontSize:12,fontWeight:600,color:'hsl(var(--primary))',fontFamily:'inherit',transition:'background .15s' }}
              onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.background='hsl(var(--primary)/.2)'}
              onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.background='hsl(var(--primary)/.1)'}>
                Cambiar carpeta
              </button>
            </div>
          </section>

          {/* Logout */}
          <section>
            <button onClick={()=>{ onClose(); onLogout(); }}
              style={{ width:'100%',background:'hsl(0 80% 50%/.15)',border:'1px solid hsl(0 80% 50%/.3)',borderRadius:'.875rem',padding:'12px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,color:'#ef4444',fontFamily:'inherit',fontSize:14,fontWeight:600,transition:'background .15s' }}
              onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.background='hsl(0 80% 50%/.25)'}
              onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.background='hsl(0 80% 50%/.15)'}>
              <Icon name="lock" size={16}/>
              Cerrar sesión
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Titlebar ────────────────────────────────────────────────────────────────
function Titlebar({ online, onToggle, search, onSearch, onSettings, downloadCount, activeCount, onOpenDownloads }:
  { online:boolean; onToggle:(v:boolean)=>void; search:string; onSearch:(v:string)=>void; onSettings:()=>void; downloadCount:number; activeCount:number; onOpenDownloads:()=>void }) {
  
  const handleControl = (action: string) => {
    try {
      const { ipcRenderer } = (window as any).require('electron');
      ipcRenderer.send(`window-${action}`);
    } catch (e) {
      console.error("IPC error:", e);
    }
  };

  return (
    <div style={{ background:'hsl(230 28% 9%)',borderBottom:'1px solid hsl(var(--border))',display:'flex',alignItems:'center',height:44,flexShrink:0, padding: '0 8px', WebKitAppRegion: 'drag' } as any}>
      <div className="titlebar-controls" style={{ display:'flex',alignItems:'center',gap:6,padding:'0 6px',flexShrink:0, WebKitAppRegion: 'no-drag' } as any}>
        {['#ff5f57','#febc2e','#28c840'].map((c,i) => (
          <button 
            key={i} 
            onClick={() => handleControl(i === 0 ? 'close' : i === 1 ? 'minimize' : 'maximize')}
            style={{ width:12,height:12,borderRadius:'50%',background:c,border:'none',cursor:'pointer',padding:0 }}
          />
        ))}
      </div>
      
      <div className="titlebar-tabs" style={{ display:'flex',alignItems:'stretch',height:'100%',borderRight:'1px solid hsl(var(--border))',flexShrink:1, overflow:'hidden', WebKitAppRegion: 'no-drag' } as any}>
        {['Online','Biblioteca'].map((tab,i) => (
          <button key={tab} onClick={() => onToggle(i === 0)}
            style={{ border:'none',background:'transparent',cursor:'pointer',padding:'0 12px',fontSize:13,color:(i===0)===online?'hsl(var(--foreground))':'hsl(var(--muted-foreground))',borderBottom:(i===0)===online?'2px solid hsl(var(--primary))':'2px solid transparent',display:'flex',alignItems:'center',gap:4,fontFamily:'inherit', whiteSpace:'nowrap' }}>
            {tab}{(i===0)&&online&&<span style={{ width:5,height:5,borderRadius:'50%',background:'hsl(var(--primary))',display:'inline-block' }}/>}
          </button>
        ))}
      </div>

      <div className="titlebar-search" style={{ position:'relative',flex:'1 1 200px', maxWidth:'300px', margin:'0 10px', WebKitAppRegion: 'no-drag' } as any}>
        <span style={{ position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'hsl(var(--muted-foreground))',pointerEvents:'none' }}><Icon name="search" size={14}/></span>
        <input type="search" value={search} onChange={e=>onSearch(e.target.value)} placeholder="Buscar..."
          style={{ background:'hsl(var(--muted))',border:'1px solid hsl(var(--border))',borderRadius:'.5rem',color:'hsl(var(--foreground))',padding:'5px 10px 5px 34px',width:'100%',outline:'none',fontSize:13,height:28,fontFamily:'inherit' }}/>
      </div>

      <div className="titlebar-version" style={{ flex:1,textAlign:'center',fontSize:11,color:'hsl(var(--muted-foreground))', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>AppStore XD</div>

      <div style={{ display:'flex',alignItems:'center',gap:6,padding:'0 6px', flexShrink:0, WebKitAppRegion: 'no-drag' } as any}>
        <div className="titlebar-clock"><Clock/></div>
        <button className="btn-icon header-download-icon" onClick={onOpenDownloads} style={{ position:'relative' }}>
          <Icon name="download" size={18}/>
          {activeCount > 0 ? (
            <span style={{ position:'absolute',top:-4,right:-4,background:'hsl(var(--primary))',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,zIndex:2 }}>
              {activeCount}
            </span>
          ) : downloadCount > 0 ? (
            <span style={{ position:'absolute',top:-4,right:-4,background:'hsl(var(--muted-foreground))',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700 }}>
              {downloadCount > 99 ? '99+' : downloadCount}
            </span>
          ) : null}
        </button>
        <button className="btn-icon" onClick={()=>showToast('Sin notificaciones','info')}><Icon name="bell" size={18}/></button>
        {/* Profile button → opens settings */}
        <button onClick={onSettings}
          style={{ width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent)))',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'white',fontWeight:700,transition:'box-shadow .15s' }}
          onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.boxShadow='0 0 0 2px hsl(var(--primary)/.5)'}
          onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.boxShadow=''}>
          👤
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
const CAT_ICONS: Record<string,string> = {
  Inicio:'home', Todos:'grid', Descargas:'download', Programas:'monitor', Drivers:'cpu',
  Juegos:'gamepad', Desarrollos:'code', Diseño:'pen', Emuladores:'disc', 'Juegos Roms':'folder', Proyectos:'wrench', Mods:'package',
};
function Sidebar({ active, onSelect }: { active:string; onSelect:(c:string)=>void }) {
  return (
    <div className="sidebar" style={{ width:200,background:'hsl(230 28% 8%)',borderRight:'1px solid hsl(var(--border))',display:'flex',flexDirection:'column',padding:'12px 8px',overflowY:'auto',flexShrink:0, height:'100%' }}>
      {/* Home */}
      <div style={{ marginBottom:8 }}>
        <SideItem cat="Inicio" active={active} onSelect={onSelect} accent/>
      </div>
      <div style={{ height:1,background:'hsl(var(--border))',margin:'2px 4px 10px' }}/>
      <div style={{ fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'.08em',color:'hsl(var(--muted-foreground))',padding:'4px 10px 4px' }}>Apps</div>
      {['Todos','Descargas'].map(cat=><SideItem key={cat} cat={cat} active={active} onSelect={onSelect}/>)}
      <div style={{ fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'.08em',color:'hsl(var(--muted-foreground))',padding:'12px 10px 4px' }}>Categorías</div>
      {['Programas','Drivers','Juegos','Desarrollos','Diseño','Emuladores','Juegos Roms','Proyectos'].map(cat=><SideItem key={cat} cat={cat} active={active} onSelect={onSelect}/>)}
      <div style={{ position:'relative' }}>
        <SideItem cat="Mods" active={active} onSelect={onSelect}/>
        <span style={{ position:'absolute',right:4,top:2,fontSize:8,background:'hsl(var(--primary))',color:'white',padding:'1px 4px',borderRadius:4,fontWeight:800,textTransform:'uppercase',pointerEvents:'none' }}>Pronto</span>
      </div>
    </div>
  );
}
function SideItem({ cat, active, onSelect, accent=false }: { cat:string; active:string; onSelect:(c:string)=>void; accent?:boolean }) {
  const isActive = active===cat;
  
  return (
    <button onClick={()=>onSelect(cat)}
      style={{ border:'none',background:isActive?(accent?'linear-gradient(90deg,hsl(var(--primary)/.25),transparent)':'hsl(var(--primary)/.18)'):'transparent',color:isActive?'hsl(var(--primary))':'hsl(var(--foreground))',cursor:'pointer',display:'flex',alignItems:'center',gap:8,padding:accent?'9px 10px':'7px 10px',width:'100%',textAlign:'left',fontSize:accent?14:13,fontWeight:accent?700:400,borderRadius:'.5rem',transition:'all .15s',fontFamily:'inherit',borderLeft:isActive&&accent?'3px solid hsl(var(--primary))':'3px solid transparent' }}>
      <span style={{ color:isActive?'hsl(var(--primary))':'hsl(var(--muted-foreground))',flexShrink:0 }}>
        <Icon name={CAT_ICONS[cat]||'folder'} size={accent?17:15}/>
      </span>
      {cat}
    </button>
  );
}

// ─── Hero Carousel ────────────────────────────────────────────────────────────
function HeroCarousel({ apps, onSelectApp }: { apps: App[]; onSelectApp: (a:App)=>void }) {
  const heroApps = apps.slice(0, 5);
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const go = useCallback((next: number) => {
    setIdx(next); setKey(k=>k+1);
  }, []);

  useEffect(() => {
    if (!heroApps.length) return;
    timerRef.current = setInterval(() => go((idx+1)%heroApps.length), 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [idx, go, heroApps.length]);

  if (!heroApps.length) return null;
  const app = heroApps[idx];
  const total = heroApps.length;

  return (
    <div className="hero-carousel" style={{ position:'relative',height:420,borderRadius:'2rem',overflow:'hidden',flexShrink:0,boxShadow:'0 25px 60px rgba(0,0,0,.4)',border:'1px solid rgba(255,255,255,.05)' }}>
      {/* Background with multiple layers */}
      <div key={key} className="hero-slide" style={{ position:'absolute',inset:0 }}>
        {/* Main image background */}
        <div style={{ position:'absolute',inset:0 }}>
          {app.screenshots && app.screenshots.length > 0 ? (
            <img src={app.screenshots[0]} alt="bg" style={{ width:'100%',height:'100%',objectFit:'cover',filter:'brightness(0.4) blur(1px)' }}/>
          ) : (
            <div style={{ width:'100%',height:'100%',background:`linear-gradient(135deg, ${app.color}cc, #0a0a1a)` }}/>
          )}
          <div style={{ position:'absolute',inset:0,background:`linear-gradient(to right, #0a0a1acc 0%, #0a0a1a66 40%, transparent 100%), linear-gradient(to top, #0a0a1a 0%, transparent 40%)` }}/>
        </div>
      </div>

      <div style={{ position:'absolute',inset:0,backgroundImage:'radial-gradient(circle, rgba(255,255,255,.03) 1px, transparent 1px)',backgroundSize:'40px 40px',pointerEvents:'none' }}/>
      
      {/* Content */}
      <div key={`c${key}`} className="hero-content" style={{ position:'relative',zIndex:1,height:'100%',display:'flex',alignItems:'center',padding:'0 5%' }}>
        <div className="hero-text-content" style={{ flex:1.2,maxWidth:600 }}>
          <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:20, flexWrap:'wrap' }}>
            {app.isNew && <span className="hero-badge" style={{ background:'hsl(var(--primary))',color:'white',fontSize:11,fontWeight:800,padding:'5px 14px',borderRadius:20,textTransform:'uppercase',letterSpacing:'.1em',boxShadow:`0 4px 15px hsl(var(--primary)/.5)` }}>✦ RECOMENDADO</span>}
            <span className="hero-badge" style={{ background:'rgba(255,255,255,.1)',backdropFilter:'blur(8px)',color:'white',fontSize:11,fontWeight:700,padding:'5px 14px',borderRadius:20,textTransform:'uppercase',letterSpacing:'.1em',border:'1px solid rgba(255,255,255,.15)' }}>{app.category}</span>
            <div className="hero-badge" style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(245,158,11,.15)',color:'#f59e0b',fontSize:11,fontWeight:800,padding:'5px 12px',borderRadius:20,border:'1px solid rgba(245,158,11,.2)' }}>
              <Icon name="star" size={12}/> {app.rating.toFixed(1)}
            </div>
          </div>
          <h2 className="hero-title" style={{ margin:'0 0 16px',fontSize:'clamp(2rem, 5vw, 3.5rem)',fontWeight:950,color:'white',textShadow:'0 4px 30px rgba(0,0,0,.6)',lineHeight:1.05,letterSpacing:'-0.02em' }}>{app.name}</h2>
          <p className="hero-desc" style={{ margin:'0 0 32px',fontSize:16,color:'rgba(255,255,255,.8)',lineHeight:1.6,textShadow:'0 2px 8px rgba(0,0,0,.4)',maxWidth:500 }}>{app.description.slice(0,180)}...</p>
          <div className="hero-actions" style={{ display:'flex',gap:16, flexWrap:'wrap' }}>
            <button onClick={()=>onSelectApp(app)} className="btn-hero-main"
              style={{ background:'white',color:'#0a0a1a',border:'none',borderRadius:'1rem',padding:'14px 36px',fontSize:16,fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',gap:12,transition:'all .25s',fontFamily:'inherit',boxShadow:'0 10px 25px rgba(255,255,255,.2)' }}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px)';e.currentTarget.style.boxShadow='0 15px 30px rgba(255,255,255,.3)';}}
              onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 10px 25px rgba(255,255,255,.2)';}}>
              <Icon name="download" size={20}/> Obtener gratis
            </button>
            <button onClick={()=>onSelectApp(app)} className="btn-hero-sec"
              style={{ background:'rgba(255,255,255,.05)',color:'white',border:'1px solid rgba(255,255,255,.2)',borderRadius:'1rem',padding:'14px 32px',fontSize:16,fontWeight:700,cursor:'pointer',backdropFilter:'blur(16px)',fontFamily:'inherit',transition:'all .25s' }}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'}>
              Detalles
            </button>
          </div>
        </div>

        {/* Floating App Preview - OCULTAR EN MÓVIL */}
        <div className="hero-preview-container" style={{ flex:1,display:'flex',justifyContent:'flex-end',perspective:1200 }}>
           <div className="hero-floating-preview" style={{ width:280,height:360,borderRadius:'1.5rem',background:`rgba(20,20,35,0.4)`,backdropFilter:'blur(24px)',border:'1px solid rgba(255,255,255,.15)',boxShadow:'0 40px 80px rgba(0,0,0,.6)',display:'flex',flexDirection:'column',overflow:'hidden',transform:'rotateY(-20deg) rotateX(10deg) translateZ(50px)',transition:'all .6s ease-out' }}>
              <div style={{ flex:1,width:'100%',position:'relative',overflow:'hidden' }}>
                {app.coverUrl ? (
                  <img src={app.coverUrl} alt="cover" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
                ) : app.screenshots && app.screenshots.length > 0 ? (
                  <img src={app.screenshots[0]} alt="cover" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>
                ) : (
                  <div style={{ width:'100%',height:'100%',background:`linear-gradient(135deg, ${app.color}, #0a0a1a)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'6rem' }}>{app.icon}</div>
                )}
                <div style={{ position:'absolute',bottom:0,left:0,right:0,height:'60%',background:'linear-gradient(to top, rgba(10,10,26,1), transparent)' }}/>
                <div style={{ position:'absolute',bottom:12,left:12,display:'flex',alignItems:'center',gap:8 }}>
                   <div style={{ width:44,height:44,borderRadius:10,background:'rgba(255,255,255,.1)',backdropFilter:'blur(10px)',border:'1px solid rgba(255,255,255,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.8rem' }}>{app.icon}</div>
                   <div>
                     <div style={{ color:'white',fontWeight:800,fontSize:15,lineHeight:1.2 }}>{app.name}</div>
                     <div style={{ color:'rgba(255,255,255,.6)',fontSize:11 }}>Versión {app.version || '1.0'}</div>
                   </div>
                </div>
              </div>
           </div>
        </div>
      </div>

      {/* Navigation arrows */}
      <button onClick={()=>go((idx-1+total)%total)}
        style={{ position:'absolute',left:16,top:'50%',transform:'translateY(-50%)',width:44,height:44,borderRadius:'50%',background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,.1)',color:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(10px)',zIndex:10,transition:'all .2s' }}
        onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,0.5)'}
        onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,0.3)'}>
        <Icon name="arrowLeft" size={20}/>
      </button>
      <button onClick={()=>go((idx+1)%total)}
        style={{ position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',width:44,height:44,borderRadius:'50%',background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,.1)',color:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(10px)',zIndex:10,transition:'all .2s' }}
        onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,0.5)'}
        onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,0.3)'}>
        <Icon name="arrowRight" size={20}/>
      </button>

      {/* Thumbnail strip - Centered at the bottom with better spacing */}
      <div style={{ position:'absolute',bottom:24,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8,zIndex:10 }}>
        {heroApps.map((a,i)=>(
          <button key={i} onClick={()=>go(i)}
            style={{ width:i===idx?32:10,height:10,borderRadius:5,background:i===idx?'white':'rgba(255,255,255,0.3)',border:'none',cursor:'pointer',transition:'all .3s',padding:0,boxShadow:i===idx?'0 0 10px rgba(255,255,255,0.5)':'none' }}
            title={a.name}/>
        ))}
      </div>
    </div>
  );
}

// ─── Horizontal App Card ──────────────────────────────────────────────────────
function HAppCard({ app, onClick }: { app:App; onClick:()=>void }) {
  return (
    <div onClick={onClick} className="h-app-card glass-card" 
      style={{ transition:'all .4s cubic-bezier(0.175, 0.885, 0.32, 1.275)', cursor:'pointer', position:'relative', overflow:'hidden', borderRadius:'1.25rem' }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-8px) scale(1.02)';
        e.currentTarget.style.boxShadow = `0 20px 40px rgba(0,0,0,0.4), 0 0 20px ${app.color}33`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '';
      }}>
      <div style={{ height:140, background:`linear-gradient(135deg,${app.color}cc,${app.color}44 70%,#0a0a1a)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'3.5rem', position:'relative', overflow:'hidden' }}>
        {app.screenshots && app.screenshots.length > 0 ? (
          <img src={app.screenshots[0]} alt="preview" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',opacity:0.5,transition:'transform .5s' }} className="card-img"/>
        ) : (
          <div style={{ position:'absolute',inset:0,background:`linear-gradient(135deg, ${app.color}, #0a0a1a)`, opacity:0.2 }}/>
        )}
        <div style={{ position:'absolute',inset:0,background:'linear-gradient(to top, rgba(10,10,26,0.8), transparent)' }}/>
        <span style={{ position:'relative',zIndex:1,filter:'drop-shadow(0 8px 20px rgba(0,0,0,.6))' }}>{app.icon}</span>
        
        {/* Rating badge on card */}
        <div style={{ position:'absolute', top:10, right:10, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)', borderRadius:12, padding:'3px 8px', display:'flex', alignItems:'center', gap:4, border:'1px solid rgba(255,255,255,0.1)', fontSize:11, fontWeight:800, color:'#f59e0b' }}>
          <Icon name="star" size={10}/> {app.rating.toFixed(1)}
        </div>
      </div>
      <div style={{ padding:'14px' }}>
        <div style={{ fontWeight:800, fontSize:15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:4, color:'white' }}>{app.name}</div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', fontWeight:600 }}>{app.category}</div>
          {app.isNew && <span style={{ fontSize:10, background:'hsl(var(--primary))', color:'white', fontWeight:900, padding:'2px 8px', borderRadius:8, textTransform:'uppercase', letterSpacing:'.05em' }}>Nuevo</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Category Tile ────────────────────────────────────────────────────────────
const CAT_DEFS = [
  { cat:'Programas',  emoji:'🖥️',  color:'#2980b9', desc:'Utilidades y software' },
  { cat:'Drivers',    emoji:'🔌',  color:'#c0392b', desc:'Controladores' },
  { cat:'Juegos',     emoji:'🕹️',  color:'#27ae60', desc:'Entretenimiento' },
  { cat:'Desarrollos',emoji:'💻',  color:'#8e44ad', desc:'Dev tools & IDEs' },
  { cat:'Diseño',     emoji:'🎨',  color:'#e67e22', desc:'Creatividad visual' },
  { cat:'Emuladores', emoji:'🎮',  color:'#2c3e50', desc:'Consolas clásicas' },
  { cat:'Juegos Roms',emoji:'📀',  color:'#e52d6a', desc:'ROMs & emulación' },
  { cat:'Proyectos',  emoji:'🔧',  color:'#16a085', desc:'Mis proyectos' },
];

// ─── Feature Cards ────────────────────────────────────────────────────────────
const FEATURES = [
  { icon:'zap',     color:'#f59e0b', title:'Descarga rápida',      desc:'Descarga apps directamente desde las fuentes oficiales con un solo clic.' },
  { icon:'shield',  color:'#22c55e', title:'Software verificado',  desc:'Todos los programas son verificados y provienen de fuentes confiables.' },
  { icon:'sparkles',color:'#8b5cf6', title:'Siempre actualizado',  desc:'Notificaciones automáticas cuando hay nuevas versiones disponibles.' },
  { icon:'gamepad', color:'#e8692a', title:'ROMs & emuladores',    desc:'Catálogo de juegos clásicos con soporte para múltiples consolas.' },
  { icon:'palette', color:'#ec4899', title:'Temas personalizables',desc:'Personaliza la apariencia con múltiples temas de color incluidos.' },
];

// ─── Home Section ─────────────────────────────────────────────────────────────
function HomeSection({ apps, onSelectApp, onSelectCat, onOpenSettings }: { apps:App[]; onSelectApp:(a:App)=>void; onSelectCat:(c:string)=>void; onOpenSettings:()=>void }) {
  if (apps.length === 0) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:40, textAlign:'center', gap:24, color:'white' }}>
        <div style={{ position:'relative' }}>
          <div style={{ fontSize:'6rem', filter:'drop-shadow(0 0 20px hsl(var(--primary)/.3))' }}>📦</div>
          <div style={{ position:'absolute', bottom:0, right:-10, fontSize:'2.5rem' }}>❓</div>
        </div>
        <div>
          <h2 style={{ fontSize:'2rem', fontWeight:900, marginBottom:12 }}>Catálogo vacío</h2>
          <p style={{ color:'rgba(255,255,255,.5)', fontSize:15, maxWidth:400, margin:'0 auto', lineHeight:1.6 }}>
            No hemos encontrado aplicaciones ni juegos. Agrega una fuente JSON en los ajustes para empezar a explorar.
          </p>
        </div>
        <button 
          onClick={onOpenSettings}
          className="btn-primary" 
          style={{ padding:'14px 32px', fontSize:15, fontWeight:800, borderRadius:'1rem', display:'flex', alignItems:'center', gap:10 }}
        >
          <Icon name="settings" size={18}/>
          Configurar fuentes ahora
        </button>
      </div>
    );
  }

  const topApps = [...apps].sort((a,b)=>b.rating-a.rating).slice(0,12);
  const newApps = apps.filter(a=>a.isNew);
  const allHighRated = apps.filter(a=>a.rating>=9.0);

  return (
    <div style={{ flex:1,overflowY:'auto',padding:'clamp(16px, 4vw, 40px)',display:'flex',flexDirection:'column',gap:'clamp(24px, 5vw, 48px)',background:'linear-gradient(to bottom, transparent, rgba(10,10,26,0.3))' }}>
      {/* Hero */}
      <HeroCarousel apps={apps} onSelectApp={onSelectApp}/>

      {/* Stats & Quick Info - Responsive Grid */}
      <div className="stats-grid" style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))',gap:20,marginTop:-20 }}>
        {[
          { label:'Apps', value:apps.length, icon:'grid', color:'hsl(var(--primary))' },
          { label:'Categorías', value:CAT_DEFS.length, icon:'package', color:'#8b5cf6' },
          { label:'Novedades', value:newApps.length, icon:'sparkles', color:'#f59e0b' },
          { label:'Clasificadas', value:allHighRated.length, icon:'star', color:'#22c55e' }
        ].map(s=>(
          <div key={s.label} className="glass-card" style={{ padding:'16px 20px', borderRadius:'1.25rem', display:'flex', alignItems:'center', gap:16, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ width:40, height:44, borderRadius:12, background:`${s.color}15`, color:s.color, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Icon name={s.icon as any} size={20}/>
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:18, fontWeight:900, color:'white', lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:600, marginTop:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Top rated */}
      <section>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24, flexWrap:'wrap', gap:12 }}>
          <div>
            <div className="section-title" style={{ margin:0, fontSize:20, fontWeight:900 }}>
              <span style={{ color:'#f59e0b' }}><Icon name="star" size={20}/></span>
              Lo más destacado
            </div>
          </div>
          <button style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'white', padding:'8px 20px', borderRadius:99, fontSize:12, fontWeight:700, cursor:'pointer', transition:'all .2s' }} onClick={()=>onSelectCat('Todos')}>Ver todo</button>
        </div>
        <div className="h-scroll" style={{ paddingBottom:15, gap:20 }}>
          {topApps.map(a=><HAppCard key={a.id} app={a} onClick={()=>onSelectApp(a)}/>)}
        </div>
      </section>

      {/* Categories Grid - MODERNIZED */}
      <section>
        <div style={{ marginBottom:24 }}>
          <div className="section-title" style={{ margin:0, fontSize:22, fontWeight:900 }}>
            <span style={{ color:'hsl(var(--primary))' }}><Icon name="grid" size={22}/></span>
            Explorar por categorías
          </div>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:16 }}>
          {CAT_DEFS.map(c=>(
            <div key={c.cat} onClick={()=>onSelectCat(c.cat)} className="cat-tile glass-card"
              style={{ background:`linear-gradient(145deg,${c.color}25,${c.color}08)`,padding:'20px',borderRadius:'1.5rem',cursor:'pointer',transition:'all .3s cubic-bezier(0.4, 0, 0.2, 1)',display:'flex',flexDirection:'column',alignItems:'center',gap:14,border:'1px solid rgba(255,255,255,.08)',position:'relative',overflow:'hidden' }}
              onMouseEnter={e=>{
                e.currentTarget.style.transform='translateY(-6px)';
                e.currentTarget.style.background=`linear-gradient(145deg,${c.color}40,${c.color}15)`;
                e.currentTarget.style.borderColor = `${c.color}66`;
              }}
              onMouseLeave={e=>{
                e.currentTarget.style.transform='';
                e.currentTarget.style.background=`linear-gradient(145deg,${c.color}25,${c.color}08)`;
                e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)';
              }}>
              <div style={{ position:'absolute',top:-10,right:-10,fontSize:'5rem',opacity:0.1,transform:'rotate(15deg)',pointerEvents:'none' }}>{c.emoji}</div>
              <div style={{ width:60, height:60, borderRadius:20, background:`${c.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2.5rem', filter:`drop-shadow(0 8px 16px ${c.color}44)` }}>{c.emoji}</div>
              <div style={{ textAlign:'center', zIndex:1 }}>
                <div style={{ fontWeight:800,fontSize:16,color:'white' }}>{c.cat}</div>
                <div style={{ fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:4, fontWeight:500 }}>{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* New & Trending grid */}
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:28 }}>
        {newApps.length>0&&(
          <section>
            <div className="section-title">
              <span style={{ color:'hsl(var(--primary))' }}><Icon name="sparkles" size={18}/></span>
              Novedades
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
              {newApps.slice(0,3).map(a=>(
                <div key={a.id} onClick={()=>onSelectApp(a)} className="glass-card" style={{ display:'flex',alignItems:'center',gap:14,padding:12,borderRadius:'.75rem',cursor:'pointer',transition:'all .2s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='hsl(var(--primary)/.05)'}
                  onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <div style={{ width:50,height:50,borderRadius:'.5rem',background:`linear-gradient(135deg,${a.color}88,${a.color}44)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.8rem',flexShrink:0 }}>{a.icon}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:700,fontSize:14,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{a.name}</div>
                    <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))' }}>{a.category}</div>
                  </div>
                  <div style={{ fontSize:12,fontWeight:700,color:'hsl(var(--primary))' }}>GRATIS</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="section-title">
            <span style={{ color:'#8b5cf6' }}><Icon name="zap" size={18}/></span>
            Tendencias
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {allHighRated.slice(0,3).map((a, i)=>(
              <div key={a.id} onClick={()=>onSelectApp(a)} className="glass-card" style={{ display:'flex',alignItems:'center',gap:14,padding:12,borderRadius:'.75rem',cursor:'pointer',transition:'all .2s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(139, 92, 246, 0.05)'}
                onMouseLeave={e=>e.currentTarget.style.background=''}>
                <div style={{ fontSize:18,fontWeight:900,color:'rgba(255,255,255,.1)',width:24,textAlign:'center' }}>{i+1}</div>
                <div style={{ width:50,height:50,borderRadius:'.5rem',background:`linear-gradient(135deg,${a.color}88,${a.color}44)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.8rem',flexShrink:0 }}>{a.icon}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:700,fontSize:14,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{a.name}</div>
                  <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))' }}>{a.category}</div>
                </div>
                <div style={{ display:'flex',alignItems:'center',gap:4,color:'#f59e0b',fontSize:12,fontWeight:700 }}>
                  <Icon name="star" size={12}/> {a.rating.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Features - Simplified & Better UI */}
      <section style={{ background:'hsl(var(--primary)/.03)',margin:'0 -28px',padding:'40px 28px',borderTop:'1px solid hsl(var(--border))',borderBottom:'1px solid hsl(var(--border))' }}>
        <div style={{ textAlign:'center',marginBottom:32 }}>
          <h2 style={{ fontSize:'1.8rem',fontWeight:800,marginBottom:8 }}>¿Por qué AppStore XD?</h2>
          <p style={{ color:'hsl(var(--muted-foreground))' }}>La plataforma definitiva para gestionar tu software y juegos</p>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:24 }}>
          {FEATURES.map(f=>(
            <div key={f.title} style={{ display:'flex',gap:16 }}>
              <div style={{ width:48,height:48,borderRadius:'.75rem',background:`${f.color}15`,color:f.color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                <Icon name={f.icon as any} size={24}/>
              </div>
              <div>
                <div style={{ fontWeight:700,fontSize:15,marginBottom:4 }}>{f.title}</div>
                <div style={{ fontSize:13,color:'hsl(var(--muted-foreground))',lineHeight:1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {/* Footer */}
      <div style={{ borderTop:'1px solid hsl(var(--border))',padding:'32px 0 16px',textAlign:'center',fontSize:12,color:'hsl(var(--muted-foreground))' }}>
        AppStore XD — Calidad de Vida · {new Date().getFullYear()}
      </div>
    </div>
  );
}

// ─── App Card (grid) ──────────────────────────────────────────────────────────
function AppCard({ app, onClick }: { app:App; onClick:()=>void }) {
  return (
    <div onClick={onClick} className="app-card glass-card" style={{ borderRadius:'1rem',overflow:'hidden',cursor:'pointer' }}>
      <div style={{ height:150,background:`linear-gradient(135deg,${app.color}99,${app.color}44 50%,#0d0d1a)`,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden' }}>
        {app.coverUrl
          ? <img src={app.coverUrl} alt={app.name} style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',opacity:.85 }}/>
          : <span style={{ fontSize:'3.5rem' }}>{app.icon}</span>}
        {app.isNew&&<span style={{ position:'absolute',top:10,right:10,background:'hsl(var(--primary))',color:'white',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,textTransform:'uppercase',zIndex:1 }}>new</span>}
      </div>
      <div style={{ padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
        <div>
          <div style={{ fontWeight:600,fontSize:14 }}>{app.name}</div>
          <div style={{ fontSize:12,color:'hsl(var(--muted-foreground))' }}>{app.category.toLowerCase()}</div>
        </div>
        <button className="btn-primary" style={{ display:'none', padding:'5px 12px',fontSize:12 }}>Detalles</button>
      </div>
    </div>
  );
}

// ─── Gaming Detail Layout ─────────────────────────────────────────────────────
interface MediaItem { type:'cover'|'video'|'screen'; label:string; emoji?:string; videoId?:string; src?:string; videoUrl?:string }
function MetaCard({ label, value }: { label:string; value:string }) {
  return (
    <div style={{ background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.09)',borderRadius:'.875rem',padding:'12px 16px' }}>
      <div style={{ fontSize:11,color:'rgba(255,255,255,.35)',marginBottom:4,fontWeight:500 }}>{label}</div>
      <div style={{ fontSize:13,color:'white',fontWeight:600 }}>{value}</div>
    </div>
  );
}
function DevCard({ label, value, color }: { label:string; value:string; color:string }) {
  return (
    <div style={{ display:'flex',alignItems:'center',gap:10,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.09)',borderRadius:'.875rem',padding:'10px 14px',flex:'1 1 160px',minWidth:0 }}>
      <div style={{ width:34,height:34,borderRadius:'50%',background:`${color}22`,border:`1px solid ${color}44`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
        <div style={{ width:14,height:14,borderRadius:'50%',background:color }}/>
      </div>
      <div><div style={{ fontSize:11,color:'rgba(255,255,255,.35)',marginBottom:2 }}>{label}</div><div style={{ fontSize:13,color:'white',fontWeight:600 }}>{value}</div></div>
    </div>
  );
}
// ─── Skeletons ────────────────────────────────────────────────────────────────
function GamingDetailSkeleton() {
  return (
    <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#0a0a14' }}>
      <div style={{ display:'flex',alignItems:'center',padding:'14px 24px',borderBottom:'1px solid rgba(255,255,255,.06)' }}>
        <div className="skeleton" style={{ width:100,height:32,borderRadius:20 }}/>
      </div>
      <div style={{ display:'flex',flex:1,overflow:'hidden' }}>
        <div style={{ width:400,flexShrink:0,borderRight:'1px solid rgba(255,255,255,.06)',padding:'24px 28px' }}>
          <div className="skeleton" style={{ width:'100%',aspectRatio:'3/4',borderRadius:'.875rem',marginBottom:20 }}/>
          <div className="skeleton" style={{ width:80,height:12,marginBottom:12,marginLeft:'auto',marginRight:'auto' }}/>
          <div className="skeleton" style={{ width:'100%',aspectRatio:'16/9',borderRadius:'.75rem',marginBottom:20 }}/>
          <div style={{ display:'flex',justifyContent:'space-between',marginBottom:10 }}>
            <div className="skeleton" style={{ width:28,height:28,borderRadius:'50%' }}/>
            <div className="skeleton" style={{ width:60,height:6,borderRadius:3,marginTop:11 }}/>
            <div className="skeleton" style={{ width:28,height:28,borderRadius:'50%' }}/>
          </div>
          <div style={{ display:'flex',gap:8 }}>
            {[1,2,3,4,5].map(i=><div key={i} className="skeleton" style={{ width:64,height:44,borderRadius:'.375rem' }}/>)}
          </div>
        </div>
        <div style={{ flex:1,padding:'28px 48px',display:'flex',flexDirection:'column',gap:24 }}>
          <div>
            <div style={{ display:'flex',gap:8,marginBottom:12 }}><div className="skeleton" style={{ width:80,height:20,borderRadius:20 }}/><div className="skeleton" style={{ width:80,height:20,borderRadius:20 }}/></div>
            <div className="skeleton" style={{ width:'60%',height:40,marginBottom:16 }}/>
            <div className="skeleton" style={{ width:'90%',height:16,marginBottom:8 }}/>
            <div className="skeleton" style={{ width:'85%',height:16,marginBottom:8 }}/>
            <div className="skeleton" style={{ width:'40%',height:16 }}/>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12 }}>
            {[1,2,3,4].map(i=><div key={i} className="skeleton" style={{ height:60,borderRadius:'.875rem' }}/>)}
          </div>
          <div style={{ display:'flex',gap:14 }}>
            <div className="skeleton" style={{ flex:1,height:54,borderRadius:'.875rem' }}/>
            <div className="skeleton" style={{ flex:1,height:54,borderRadius:'.875rem' }}/>
          </div>
          <div style={{ display:'flex',gap:12 }}>
            <div className="skeleton" style={{ width:180,height:48,borderRadius:40 }}/>
            <div className="skeleton" style={{ width:140,height:48,borderRadius:40 }}/>
          </div>
        </div>
      </div>
    </div>
  );
}
// ─── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ items, startIdx, onClose, accentColor }: { items: MediaItem[]; startIdx: number; onClose: () => void; accentColor: string }) {
  const [idx, setIdx] = useState(startIdx);
  const [closing, setClosing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const total = items.length;
  const item = items[idx];

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % total);
      if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + total) % total);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close, total]);

  useEffect(() => {
    setZoom(1);
  }, [idx]);

  const handleDownload = () => {
    if (item.src) {
      const link = document.createElement('a');
      link.href = item.src;
      link.download = item.label || 'image';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div
      className={closing ? 'lb-backdrop-out' : 'lb-backdrop'}
      style={{ position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,.95)',backdropFilter:'blur(10px)',display:'flex',flexDirection:'column',color:'white',overflow:'hidden' }}>
      
      {/* Top Bar */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 24px',zIndex:10 }}>
        <div style={{ fontSize:14,fontWeight:600,opacity:0.7 }}>{idx + 1} / {total}</div>
        <div style={{ display:'flex',gap:12 }}>
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 3))} className="btn-icon" style={{ opacity:0.7 }} title="Aumentar"><Icon name="zoomIn" size={18}/></button>
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 1))} className="btn-icon" style={{ opacity:0.7 }} title="Disminuir"><Icon name="zoomOut" size={18}/></button>
          <button onClick={handleFullscreen} className="btn-icon" style={{ opacity:0.7 }} title="Pantalla completa"><Icon name="maximize" size={18}/></button>
          {item.type === 'video' && <button className="btn-icon" style={{ opacity:0.7 }} title="Reproducir"><Icon name="play" size={18}/></button>}
          {item.src && <button onClick={handleDownload} className="btn-icon" style={{ opacity:0.7 }} title="Descargar"><Icon name="download" size={18}/></button>}
          <button onClick={close} className="btn-icon" style={{ opacity:0.7 }} title="Cerrar"><Icon name="x" size={18}/></button>
        </div>
      </div>

      {/* Main Area */}
      <div style={{ flex:1,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',minHeight:0 }}>
        {/* Navigation Arrows */}
        {total > 1 && (
          <>
            <button onClick={() => setIdx(i => (i - 1 + total) % total)}
              style={{ position:'absolute',left:20,zIndex:10,background:'rgba(255,255,255,0.05)',border:'none',borderRadius:'50%',width:48,height:48,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'white',transition:'all .2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
              <Icon name="arrowLeft" size={24}/>
            </button>
            <button onClick={() => setIdx(i => (i + 1) % total)}
              style={{ position:'absolute',right:20,zIndex:10,background:'rgba(255,255,255,0.05)',border:'none',borderRadius:'50%',width:48,height:48,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'white',transition:'all .2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
              <Icon name="arrowRight" size={24}/>
            </button>
          </>
        )}

        {/* Content */}
        <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',transition:'transform 0.3s cubic-bezier(0.2, 0, 0, 1)',transform:`scale(${zoom})` }}>
          {item.type === 'video' && item.videoId
            ? <iframe
                key={item.videoId}
                src={`https://www.youtube.com/embed/${item.videoId}?rel=0&modestbranding=1&autoplay=1`}
                title="video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width:'min(1000px,90vw)',height:'min(562px,50vw)',border:'none',borderRadius:12,boxShadow:'0 30px 100px rgba(0,0,0,0.8)' }}/>
            : item.type === 'screen' && item.src
              ? <img src={item.src} alt={item.label} style={{ maxWidth:'90vw',maxHeight:'85vh',objectFit:'contain',borderRadius:4,boxShadow:'0 30px 100px rgba(0,0,0,0.8)' }}/>
              : <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:20,opacity:0.5 }}>
                  <span style={{ fontSize:'6rem' }}>{item.emoji||'🎬'}</span>
                  <span style={{ fontSize:18,fontWeight:600 }}>{item.label}</span>
                </div>}
        </div>
      </div>

      {/* Footer Area */}
      <div style={{ padding:'20px 0 40px',display:'flex',flexDirection:'column',alignItems:'center',gap:20,background:'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
        <div style={{ fontSize:14,fontWeight:500,opacity:0.8 }}>{item.label}</div>
        
        {total > 1 && (
          <div style={{ display:'flex',gap:10,maxWidth:'90vw',overflowX:'auto',padding:'10px',maskImage:'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}>
            <div style={{ width:40,height:40,borderRadius:8,background:'rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}>
              <Icon name="grid" size={18}/>
            </div>
            {items.map((m, i) => (
              <div 
                key={i} 
                onClick={() => setIdx(i)}
                style={{ 
                  width:80,height:50,borderRadius:6,overflow:'hidden',cursor:'pointer',flexShrink:0,
                  border:i===idx ? `2px solid ${accentColor}` : '2px solid transparent',
                  opacity:i===idx ? 1 : 0.4,
                  transition:'all .2s'
                }}>
                {m.type === 'video' ? <div style={{ width:'100%',height:'100%',background:'#111',display:'flex',alignItems:'center',justifyContent:'center' }}><Icon name="video" size={16}/></div> :
                 m.src ? <img src={m.src} style={{ width:'100%',height:'100%',objectFit:'cover' }}/> :
                 <div style={{ width:'100%',height:'100%',background:'#111',display:'flex',alignItems:'center',justifyContent:'center' }}>{m.emoji||'🎬'}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GamingDetailLayout({ onBack, backLabel, coverEmoji, coverBg, coverUrl, title, genres, description, platform, ratingNum, reviews, language, releaseDate, size, developer, publisher, accentColor, actionLabel, actionIcon, onAction, actionPending, actionProgress, secondaryLabel, secondaryIcon, onSecondary, extraPanel, mediaItems, extraActions, onSettings }:
  { onBack:()=>void; backLabel:string; coverEmoji:string; coverBg:string; coverUrl?:string; title:string; genres:string[]; description:string; platform:string; ratingNum:number; reviews:number; language:string; releaseDate:string; size:string; developer:string; publisher:string; accentColor:string; actionLabel:string; actionIcon:string; onAction:()=>void; actionPending:boolean; actionProgress:number; secondaryLabel?:string; secondaryIcon?:string; onSecondary?:()=>void; extraPanel?:React.ReactNode; mediaItems:MediaItem[]; extraActions?:React.ReactNode; onSettings?:()=>void; }) {
  const [mediaIdx, setMediaIdx] = useState(0);
  const [lightboxState, setLightboxState] = useState<{ items: MediaItem[]; idx: number } | null>(null);
  
  const total = mediaItems.length;
  const active = mediaItems[mediaIdx];

  const handleOpenLightbox = (idx: number, includeCover = false) => {
    if (includeCover) {
      const coverItem: MediaItem = coverUrl 
        ? { type: 'screen', label: 'Portada', src: coverUrl }
        : { type: 'cover', label: 'Portada', emoji: coverEmoji };
      setLightboxState({ items: [coverItem, ...mediaItems], idx: 0 });
    } else {
      setLightboxState({ items: mediaItems, idx });
    }
  };

  return (
    <div style={{ flex:1,display:'flex',flexDirection:'column',overflowY:'auto',background:'linear-gradient(160deg,#151520 0%,#0e0e18 60%,#0a0a14 100%)',position:'relative' }}>
      {lightboxState && (
        <Lightbox 
          items={lightboxState.items} 
          startIdx={lightboxState.idx} 
          onClose={() => setLightboxState(null)} 
          accentColor={accentColor} 
        />
      )}
      <div style={{ position:'absolute',inset:0,backgroundImage:'radial-gradient(circle, rgba(255,255,255,.018) 1px, transparent 1px)',backgroundSize:'28px 28px',pointerEvents:'none',zIndex:0 }}/>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 24px',position:'relative',zIndex:1,borderBottom:'1px solid rgba(255,255,255,.06)',flexShrink:0 }}>
        <button onClick={onBack} style={{ background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'2rem',padding:'6px 16px',color:'rgba(255,255,255,.75)',cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontSize:13,fontFamily:'inherit',backdropFilter:'blur(8px)' }}>
          <Icon name="arrowLeft" size={14}/> {backLabel}
        </button>
      </div>
      <div style={{ display:'flex',flex:1,position:'relative',zIndex:1,minHeight:0,overflow:'hidden' }}>
        {/* Left */}
        <div style={{ width:400,flexShrink:0,display:'flex',flexDirection:'column',borderRight:'1px solid rgba(255,255,255,.06)',padding:'24px 28px' }}>
          <div 
            onClick={() => handleOpenLightbox(0, true)}
            style={{ borderRadius:'.875rem',overflow:'hidden',background:coverBg,aspectRatio:'3/4',display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${accentColor}44`,boxShadow:`0 8px 40px ${accentColor}33`,flexShrink:0,marginBottom:20,position:'relative',cursor:'zoom-in',transition:'transform .2s ease' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {coverUrl
              ? <img src={coverUrl} alt="portada" style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover' }}/>
              : <span style={{ fontSize:'7rem',filter:'drop-shadow(0 4px 12px rgba(0,0,0,.5))' }}>{coverEmoji}</span>}
          </div>
          
          {total > 0 && (
            <>
              <div style={{ fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:'rgba(255,255,255,.4)',marginBottom:10,display:'flex',justifyContent:'center' }}>{mediaIdx+1} / {total}</div>
              <div 
                onClick={() => handleOpenLightbox(mediaIdx)}
                style={{ borderRadius:'.75rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.15)',background:'#0a0a16',position:'relative',aspectRatio:'16/9',flexShrink:0,cursor:'zoom-in',transition:'transform .2s ease',boxShadow:'0 12px 30px rgba(0,0,0,.4)' }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                {active.type==='video'&&active.videoId ? <div style={{ width:'100%',height:'100%',position:'relative' }}>
                  <iframe src={`https://www.youtube.com/embed/${active.videoId}?rel=0&modestbranding=1`} title="preview" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ width:'100%',height:'100%',border:'none',display:'block',pointerEvents:'none' }}/>
                  <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                    <div style={{ width:48,height:48,borderRadius:'50%',background:'rgba(255,255,255,.2)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid rgba(255,255,255,.3)' }}>
                      <Icon name="play" size={20}/>
                    </div>
                  </div>
                </div> :
                 active.type==='screen'&&active.src ? <img src={active.src} alt={active.label} style={{ width:'100%',height:'100%',objectFit:'cover' }}/> :
                 <div style={{ width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,color:'rgba(255,255,255,.3)',fontSize:13 }}><span style={{ fontSize:'2rem' }}>{active.emoji||'🎬'}</span><span>{active.label}</span></div>}
              </div>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10 }}>
                <button onClick={()=>setMediaIdx(i=>(i-1+total)%total)} style={{ width:28,height:28,borderRadius:'50%',border:'1px solid rgba(255,255,255,.15)',background:'rgba(255,255,255,.07)',color:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}><Icon name="arrowLeft" size={13}/></button>
                <div style={{ display:'flex',gap:5 }}>{mediaItems.map((_,i)=><span key={i} onClick={()=>setMediaIdx(i)} style={{ width:i===mediaIdx?18:6,height:6,borderRadius:3,background:i===mediaIdx?accentColor:'rgba(255,255,255,.2)',cursor:'pointer',transition:'all .2s' }}/>)}</div>
                <button onClick={()=>setMediaIdx(i=>(i+1)%total)} style={{ width:28,height:28,borderRadius:'50%',border:'1px solid rgba(255,255,255,.15)',background:'rgba(255,255,255,.07)',color:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}><Icon name="arrowRight" size={13}/></button>
              </div>
              <div style={{ display:'flex',gap:8,marginTop:12,overflowX:'auto',paddingBottom:4 }}>
                {mediaItems.map((m,i)=><div key={i} onClick={()=>setMediaIdx(i)} style={{ width:64,height:44,borderRadius:'.5rem',flexShrink:0,cursor:'pointer',border:`2px solid ${i===mediaIdx?accentColor:'rgba(255,255,255,.1)'}`,background:'#0a0a14',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.3rem',overflow:'hidden',transition:'all .2s',boxShadow:i===mediaIdx?`0 0 15px ${accentColor}44`:'none' }}>{m.type==='video'?<Icon name="video" size={16}/>:m.emoji?<span>{m.emoji}</span>:<Icon name="image" size={16}/>}</div>)}
              </div>
            </>
          )}
        </div>
        {/* Right */}
        <div style={{ flex:1,padding:'28px 48px',overflowY:'auto',display:'flex',flexDirection:'column',gap:24 }}>
          <div>
            <div style={{ display:'flex',gap:6,marginBottom:12,flexWrap:'wrap' }}>{genres.map(g=><span key={g} style={{ fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'.08em',color:accentColor,padding:'2px 10px',border:`1px solid ${accentColor}55`,borderRadius:20,background:`${accentColor}18` }}>{g}</span>)}</div>
            <h1 style={{ margin:'0 0 12px',fontSize:'2.2rem',fontWeight:800,color:'white',lineHeight:1.1 }}>{title}</h1>
            <p style={{ margin:0,fontSize:15,color:'rgba(255,255,255,.6)',lineHeight:1.7,fontStyle:'italic',maxWidth:600 }}>{description}</p>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:12,color:'rgba(255,255,255,.4)',fontWeight:600 }}>Funciona en:</span>
            <div style={{ display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.1)',borderRadius:'.5rem',padding:'4px 12px',fontSize:12,color:'rgba(255,255,255,.8)' }}>
              <Icon name="windows" size={13}/> {platform}
            </div>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12 }}>
            <div style={{ background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.09)',borderRadius:'.875rem',padding:'14px 16px',display:'flex',alignItems:'center',gap:14 }}>
              <div style={{ fontSize:'2.1rem',fontWeight:900,color:accentColor,lineHeight:1 }}>{ratingNum.toFixed(1)}</div>
              <div>
                <div style={{ display:'flex',gap:2,marginBottom:4 }}>{[1,2,3,4,5].map(i=><span key={i} style={{ color:i<=Math.round(ratingNum/2)?'#f59e0b':'rgba(255,255,255,.15)' }}><Icon name={i<=Math.round(ratingNum/2)?'star':'starEmpty'} size={11}/></span>)}</div>
                <div style={{ fontSize:11,color:'rgba(255,255,255,.35)' }}>Reviews · {reviews.toLocaleString()}</div>
              </div>
            </div>
            <MetaCard label="Idioma" value={language}/>
            <MetaCard label="Fecha de lanzamiento" value={releaseDate}/>
            <MetaCard label="Tamaño" value={size}/>
          </div>
          <div style={{ display:'flex',gap:14,flexWrap:'wrap' }}>
            <DevCard label="Desarrollador" value={developer} color={accentColor}/>
            <DevCard label="Editor" value={publisher} color={accentColor}/>
          </div>
          <div style={{ display:'flex',gap:10 }}>
            {['user','download','trophy','lock','settings'].map(ic=>(
              <button key={ic} 
                onClick={ic === 'settings' ? onSettings : undefined}
                style={{ width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.5)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s' }}
                onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,.12)';(e.currentTarget as HTMLButtonElement).style.color='white';}}
                onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,.06)';(e.currentTarget as HTMLButtonElement).style.color='rgba(255,255,255,.5)';}}>
                <Icon name={ic} size={16}/>
              </button>
            ))}
          </div>
          {actionPending ? (
            <div style={{ maxWidth:280 }}>
              <div style={{ fontSize:12,color:'rgba(255,255,255,.4)',marginBottom:8 }}>Descargando... {actionProgress.toFixed(1)}%</div>
              <ProgressBar value={actionProgress} color={accentColor}/>
            </div>
          ) : (
            <div style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
              <button onClick={onAction}
                className="btn-main-action"
                style={{ background:'white',color:'#111',border:'none',borderRadius:'2rem',padding:'11px 32px',fontSize:15,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 20px rgba(255,255,255,.15)',fontFamily:'inherit' }}
                onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.background='#eee'}
                onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.background='white'}>
                <Icon name={actionIcon} size={17}/>{actionLabel}
              </button>
              {extraActions}
              {secondaryLabel&&onSecondary&&(
                <button onClick={onSecondary}
                  style={{ background:'transparent',color:'rgba(255,255,255,.65)',border:'1px solid rgba(255,255,255,.18)',borderRadius:'2rem',padding:'11px 22px',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:7,fontFamily:'inherit' }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,.4)';(e.currentTarget as HTMLButtonElement).style.color='white';}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='rgba(255,255,255,.18)';(e.currentTarget as HTMLButtonElement).style.color='rgba(255,255,255,.65)';}}>
                  <Icon name={secondaryIcon||'fileOpen'} size={15}/>{secondaryLabel}
                </button>
              )}
            </div>
          )}
          {extraPanel}
        </div>
      </div>
    </div>
  );
}

// ─── App Detail ───────────────────────────────────────────────────────────────
// ─── Download Popup ───────────────────────────────────────────────────────────
const DL_TYPE_META: Record<string,{emoji:string;label:string;color:string}> = {
  base:     { emoji:'🎮', label:'Juego Base',     color:'#3b82f6' },
  update:   { emoji:'🔄', label:'Actualización',  color:'#22c55e' },
  dlc:      { emoji:'🎁', label:'DLC',             color:'#a855f7' },
  version:  { emoji:'📦', label:'Versión',         color:'#f59e0b' },
  required: { emoji:'⚙️', label:'Requerido',      color:'#64748b' },
  other:    { emoji:'⬇️', label:'Descarga',       color:'#94a3b8' },
};
function DownloadPopup({ name, entries, accentColor, onClose, onSelect }:{
  name:string; entries:DownloadEntry[]; accentColor:string;
  onClose:()=>void; onSelect:(entry:DownloadEntry)=>void;
}) {
  return (
    <div style={{ position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,.65)',backdropFilter:'blur(6px)',display:'flex',alignItems:'flex-end',justifyContent:'center' }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'hsl(230 28% 10%)',borderRadius:'20px 20px 0 0',padding:'0 0 env(safe-area-inset-bottom,0)',width:'100%',maxWidth:520,boxShadow:'0 -12px 48px rgba(0,0,0,.7)',border:'1px solid rgba(255,255,255,.08)',borderBottom:'none' }}
        onClick={e=>e.stopPropagation()}>
        {/* Handle */}
        <div style={{ display:'flex',justifyContent:'center',padding:'12px 0 4px' }}>
          <div style={{ width:40,height:4,borderRadius:2,background:'rgba(255,255,255,.15)' }}/>
        </div>
        {/* Header */}
        <div style={{ padding:'12px 24px 16px',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:'rgba(255,255,255,.35)',marginBottom:4 }}>Seleccionar descarga</div>
          <div style={{ fontWeight:800,fontSize:'1.05rem',color:'#fff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{name}</div>
        </div>
        {/* Entries */}
        <div style={{ padding:'12px 16px 28px',display:'flex',flexDirection:'column',gap:8,maxHeight:'60vh',overflowY:'auto' }}>
          {entries.map((entry,i)=>{
            const meta = DL_TYPE_META[entry.type||'other']||DL_TYPE_META.other;
            return (
              <button key={i} onClick={()=>onSelect(entry)}
                style={{ display:'flex',alignItems:'center',gap:14,padding:'13px 16px',borderRadius:12,background:'rgba(255,255,255,.05)',border:`1px solid ${meta.color}22`,cursor:'pointer',textAlign:'left',transition:'background .12s',width:'100%' }}
                onMouseEnter={e=>{e.currentTarget.style.background=`${meta.color}18`;}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';}}>
                <div style={{ width:40,height:40,borderRadius:10,background:`${meta.color}22`,border:`1px solid ${meta.color}44`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0 }}>{meta.emoji}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:700,fontSize:14,color:'#fff',marginBottom:2 }}>{entry.label}</div>
                  <div style={{ fontSize:11,color:'rgba(255,255,255,.4)',display:'flex',gap:8,alignItems:'center' }}>
                    <span style={{ background:`${meta.color}22`,border:`1px solid ${meta.color}33`,borderRadius:4,padding:'1px 6px',color:meta.color,fontWeight:600 }}>{meta.label}</span>
                    {entry.size && <span>{entry.size}</span>}
                  </div>
                </div>
                <div style={{ width:32,height:32,borderRadius:'50%',background:`${accentColor}22`,border:`1px solid ${accentColor}44`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  <Icon name="download" size={14} style={{ color:accentColor }}/>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RomConfigModal({ 
  title, 
  filePath, 
  emulatorPath, 
  accentColor, 
  onSelectFile, 
  onSelectEmulator, 
  onClose 
}: { 
  title: string; 
  filePath: string; 
  emulatorPath: string; 
  accentColor: string; 
  onSelectFile: () => void; 
  onSelectEmulator: () => void; 
  onClose: () => void; 
}) {
  return (
    <div style={{ position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,.65)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'hsl(230 28% 10%)',borderRadius:'24px',padding:0,width:'100%',maxWidth:400,boxShadow:'0 20px 60px rgba(0,0,0,.6)',border:'1px solid rgba(255,255,255,.1)',overflow:'hidden' }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid rgba(255,255,255,.05)', background:'rgba(255,255,255,.02)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'rgba(255,255,255,.35)', marginBottom:4 }}>Configuración de Ejecución</div>
            <div style={{ fontWeight:800, fontSize:'1.1rem', color:'#fff' }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,.05)', border:'none', borderRadius:'50%', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'rgba(255,255,255,.5)' }}>
            <Icon name="x" size={16}/>
          </button>
        </div>
        
        <div style={{ padding:'24px' }}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
              <Icon name="fileOpen" size={14}/> Archivo ROM
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={onSelectFile} style={{ width:'100%', background:'rgba(255,255,255,.05)', color:'white', border:'1px solid rgba(255,255,255,.1)', borderRadius:'12px', padding:'12px 16px', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', transition:'all .2s' }}>
                <span>{filePath ? 'Cambiar archivo' : 'Seleccionar archivo'}</span>
                <Icon name="chevronRight" size={14} style={{ opacity:0.5 }}/>
              </button>
              {filePath && (
                <div style={{ fontSize:11, color:accentColor, background:`${accentColor}15`, padding:'6px 12px', borderRadius:8, border:`1px solid ${accentColor}33`, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  ✓ {filePath.split(/[\\/]/).pop()}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
              <Icon name="settings" size={14}/> Emulador
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={onSelectEmulator} style={{ width:'100%', background:'rgba(255,255,255,.05)', color:'white', border:'1px solid rgba(255,255,255,.1)', borderRadius:'12px', padding:'12px 16px', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', transition:'all .2s' }}>
                <span>{emulatorPath ? 'Cambiar emulador' : 'Configurar .exe'}</span>
                <Icon name="chevronRight" size={14} style={{ opacity:0.5 }}/>
              </button>
              {emulatorPath && (
                <div style={{ fontSize:11, color:accentColor, background:`${accentColor}15`, padding:'6px 12px', borderRadius:8, border:`1px solid ${accentColor}33`, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  ✓ {emulatorPath.split(/[\\/]/).pop()}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding:'12px 16px', borderRadius:12, background:'rgba(232,105,42,.05)', border:'1px solid rgba(232,105,42,.1)', fontSize:12, color:'rgba(255,255,255,.4)', lineHeight:1.5, display:'flex', gap:10 }}>
            <span style={{ fontSize:16 }}>💡</span>
            <span>Si no seleccionas un emulador, se usará la aplicación predeterminada del sistema.</span>
          </div>
        </div>
        
        <div style={{ padding:'16px 24px', background:'rgba(255,255,255,.02)', borderTop:'1px solid rgba(255,255,255,.05)', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'hsl(var(--primary))', color:'white', border:'none', borderRadius:'12px', padding:'10px 24px', fontSize:14, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 12px hsl(var(--primary)/.3)' }}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

function ScriptRunnerPanel({ url, filename, scriptType, onClose }: { url: string; filename: string; scriptType: 'bat' | 'sh'; onClose: () => void }) {
  const [output, setOutput] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'running' | 'done' | 'error'>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isElectron) return;
    const { ipcRenderer } = (window as any).require('electron');

    const onStatus = (_: any, data: { status: string; pid?: number; exitCode?: number; error?: string }) => {
      if (data.status === 'downloaded') {
        setStatus('running');
        setOutput(prev => [...prev, `> Script descargado. Ejecutando...\n`]);
      } else if (data.status === 'running') {
        setStatus('running');
        setOutput(prev => [...prev, `> PID: ${data.pid}\n`]);
      } else if (data.status === 'done') {
        setStatus('done');
        setExitCode(data.exitCode ?? 0);
        setOutput(prev => [...prev, `\n> Proceso finalizado con código: ${data.exitCode}`]);
      } else if (data.status === 'error') {
        setStatus('error');
        setOutput(prev => [...prev, `\n! Error: ${data.error}`]);
      }
    };

    const onScriptOutput = (_: any, data: { output: string; type: string }) => {
      setOutput(prev => {
        const prefix = data.type === 'stderr' ? '!' : '';
        return [...prev, prefix + data.output];
      });
    };

    ipcRenderer.on('script-status', onStatus);
    ipcRenderer.on('script-output', onScriptOutput);

    ipcRenderer.send('run-script', { url, filename, scriptType });
    setStatus('downloading');
    setOutput([`Descargando script...\n`]);

    return () => {
      ipcRenderer.removeListener('script-status', onStatus);
      ipcRenderer.removeListener('script-output', onScriptOutput);
    };
  }, [url, filename, scriptType]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleKill = () => {
    if (isElectron) {
      const { ipcRenderer } = (window as any).require('electron');
      ipcRenderer.send('kill-script');
    }
  };

  const statusColors: Record<string, string> = {
    idle: 'rgba(255,255,255,.4)',
    downloading: '#f59e0b',
    running: '#10b981',
    done: '#6366f1',
    error: '#ef4444'
  };

  const statusLabels: Record<string, string> = {
    idle: 'Esperando',
    downloading: 'Descargando script...',
    running: 'Ejecutando',
    done: 'Finalizado',
    error: 'Error'
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }} onClick={onClose}/>
      <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(720px, 96vw)', background: 'linear-gradient(160deg, #0f0f18 0%, #0a0a14 100%)', borderLeft: '1px solid rgba(255,255,255,0.08)', zIndex: 9001, display: 'flex', flexDirection: 'column' }}>
        
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${statusColors[status]}22`, border: `1px solid ${statusColors[status]}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
              {scriptType === 'bat' ? '📋' : '🐧'}
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, color: '#f2f6ff' }}>Terminal — {filename}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[status] }}></div>
                <span style={{ fontSize: 12, color: statusColors[status] }}>{statusLabels[status]}</span>
                {exitCode !== null && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>código {exitCode}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)' }}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div 
          ref={outputRef}
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: 13, lineHeight: 1.6, background: '#0d0d14', margin: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,.06)' }}
        >
          {output.map((line, i) => (
            <div key={i} style={{ color: line.startsWith('!') ? '#ef4444' : line.startsWith('>') ? '#10b981' : 'rgba(255,255,255,.85)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line.startsWith('!') ? line.substring(1) : line}
            </div>
          ))}
          {status === 'running' && (
            <span style={{ color: '#10b981', animation: 'blink 1s infinite' }}>▋</span>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0 }}>
          {status === 'running' && (
            <button onClick={handleKill} style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.15)', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="x" size={14}/> Detener
            </button>
          )}
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 12, background: 'hsl(var(--primary))', border: 'none', color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}>
            Cerrar
          </button>
        </div>
      </div>
    </>
  );
}

function AppDetailView({ app, onBack, onDownloadSaved, onRequireAuth, onDownloadProgress }: { app:App; onBack:()=>void; onDownloadSaved?:()=>void; onRequireAuth?:()=>boolean; onDownloadProgress?: (id: string, name: string, icon: string, progress: number, size?: string) => void }) {
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [showDlPopup, setShowDlPopup] = useState(false);
  const [showScriptPopup, setShowScriptPopup] = useState(false);
  const [scriptRunner, setScriptRunner] = useState<{ url: string; filename: string; scriptType: 'bat' | 'sh' } | null>(null);

  const dlEntries: DownloadEntry[] = app.downloads && app.downloads.length > 0
    ? app.downloads
    : [{ label:'Descargar', url: app.downloadUrl, size: app.size, type:'version' }];

  const scriptEntries = dlEntries.filter(e => e.url.endsWith('.bat') || e.url.endsWith('.sh'));
  const downloadEntries = dlEntries.filter(e => !e.url.endsWith('.bat') && !e.url.endsWith('.sh'));
  const hasScriptEntry = scriptEntries.length > 0;

  function triggerDownload(entry: DownloadEntry) {
    setShowDlPopup(false);
    if (onRequireAuth && !onRequireAuth()) return;

    // --- ANIMACIÓN DE VUELO ---
    const btn = document.querySelector('.btn-main-action');
    const target = document.querySelector('.header-download-icon');
    
    if (btn && target) {
      const btnRect = btn.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      
      const flyer = document.createElement('div');
      flyer.innerHTML = '📥';
      flyer.style.position = 'fixed';
      flyer.style.left = `${btnRect.left + btnRect.width / 2}px`;
      flyer.style.top = `${btnRect.top + btnRect.height / 2}px`;
      flyer.style.fontSize = '24px';
      flyer.style.zIndex = '9999';
      flyer.style.pointerEvents = 'none';
      flyer.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      document.body.appendChild(flyer);
      
      requestAnimationFrame(() => {
        flyer.style.left = `${targetRect.left + targetRect.width / 2}px`;
        flyer.style.top = `${targetRect.top + targetRect.height / 2}px`;
        flyer.style.transform = 'scale(0.3) rotate(360deg)';
        flyer.style.opacity = '0.4';
      });
      
      setTimeout(() => {
        flyer.remove();
        // Animación de salto en el destino
        if (target instanceof HTMLElement) {
          target.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          target.style.transform = 'scale(1.4) translateY(-3px)';
          setTimeout(() => {
            target.style.transform = 'scale(1)';
          }, 200);
        }
      }, 800);
    }
    // -------------------------

    setDownloading(true);
    setProgress(0);
    
    const downloadId = `app-${app.id}-${entry.label}`;
    const displayIcon = app.coverUrl || app.icon;
    onDownloadProgress?.(downloadId, app.name, displayIcon, 0, entry.size || app.size);

    // Extraer nombre de archivo de la URL o generar uno limpio
    let filename = "";
    try {
      const urlObj = new URL(entry.url);
      filename = path.basename(urlObj.pathname);
    } catch(e) {}
    
    if (!filename || filename.length < 3) {
      filename = `${app.name.replace(/[^a-z0-9]/gi, '_')}_${entry.label.replace(/[^a-z0-9]/gi, '_')}`;
    }
    
    downloadFile(entry.url, filename, (p) => {
      setProgress(p);
      onDownloadProgress?.(downloadId, app.name, displayIcon, p, entry.size || app.size);
    }, downloadId)
      .then((filePath) => {
        setDownloading(false);
        setProgress(0);
        onDownloadProgress?.(downloadId, app.name, displayIcon, 100, entry.size || app.size);
        showToast(`${entry.label} descargado con éxito`, 'success');
        if (shell && filePath) shell.showItemInFolder(filePath);
        
        saveDownloadRecord({ 
          id: `app-${app.id}-${Date.now()}`, 
          name: app.name, 
          icon: displayIcon, 
          type: 'app', 
          category: app.category, 
          size: entry.size || app.size, 
          date: new Date().toISOString(),
          filePath: filePath
        });
        onDownloadSaved?.();
      })
      .catch((err) => {
        setDownloading(false);
        setProgress(0);
        onDownloadProgress?.(downloadId, app.name, displayIcon, 100, entry.size || app.size);
        showToast(`Error: ${err.message}`, 'error');
        console.error("Download error:", err);
      });
  }
  function handleDownload() {
    if (onRequireAuth && !onRequireAuth()) return;
    if (downloadEntries.length > 1) { setShowDlPopup(true); return; }
    if (downloadEntries.length === 1) { triggerDownload(downloadEntries[0]); return; }
    // Si no hay descargas normales pero hay scripts, el botón principal no hace nada o muestra info
    showToast('Usa el botón de Ejecutar Script para este programa', 'info');
  }
  const mediaItems: MediaItem[] = [
    ...(app.videoId?[{type:'video' as const,label:'Video',videoId:app.videoId}]:[]),
    ...app.screenshots.map((src,i)=>({type:'screen' as const,label:`Captura ${i+1}`,src})),
  ];
  const extraPanel = (
    <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'18px 20px' }}>
      <div style={{ fontSize:12,fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,.35)',marginBottom:14 }}>Instrucciones de instalación</div>
      <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
        {app.instructions.map((step,i)=>(
          <div key={i} style={{ display:'flex',gap:12,alignItems:'flex-start' }}>
            <div style={{ width:22,height:22,borderRadius:'50%',background:`${app.color}33`,border:`1px solid ${app.color}55`,color:'white',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1 }}>{i+1}</div>
            <span style={{ color:'rgba(255,255,255,.55)',fontSize:13,lineHeight:1.65 }}>{step.replace(/^\d+ - /,'')}</span>
          </div>
        ))}
      </div>
    </div>
  );
  const actionLabel = downloadEntries.length > 1 ? `Descargar (${downloadEntries.length})` : 'Descargar';
  const secondaryLabel = hasScriptEntry ? (scriptEntries.length > 1 ? `Scripts (${scriptEntries.length})` : 'Ejecutar Activador') : undefined;
  const secondaryIcon = hasScriptEntry ? 'terminal' : undefined;

  const handleRunScript = (entry: DownloadEntry) => {
    setShowScriptPopup(false);
    const ext = entry.url.endsWith('.bat') ? 'bat' : 'sh';
    const name = entry.url.split('/').pop() || entry.url.split('\\').pop() || `Activador.${ext}`;
    setScriptRunner({ url: entry.url, filename: name, scriptType: ext });
  };

  const handleScriptAction = () => {
    if (scriptEntries.length > 1) {
      setShowScriptPopup(true);
    } else if (scriptEntries.length === 1) {
      handleRunScript(scriptEntries[0]);
    }
  };

  return (
    <>
      <GamingDetailLayout onBack={onBack} backLabel="Volver" coverEmoji={app.icon} coverBg={`linear-gradient(145deg,${app.color}dd,${app.color}55 60%,#0a0a18)`} coverUrl={app.coverUrl} title={app.name} genres={[app.category,...app.tags.slice(0,2)]} description={app.description} platform={app.platform} ratingNum={app.rating} reviews={app.reviews} language={app.language} releaseDate={app.releaseDate} size={app.size} developer={app.developer} publisher={app.publisher} accentColor={app.color} actionLabel={actionLabel} actionIcon="download" onAction={handleDownload} actionPending={downloading} actionProgress={progress} secondaryLabel={secondaryLabel} secondaryIcon={secondaryIcon} onSecondary={hasScriptEntry ? handleScriptAction : undefined} mediaItems={mediaItems} extraPanel={extraPanel}/>
      {showDlPopup && <DownloadPopup name={app.name} entries={downloadEntries} accentColor={app.color} onClose={()=>setShowDlPopup(false)} onSelect={triggerDownload}/>}
      {showScriptPopup && <ScriptSelectPopup name={app.name} entries={scriptEntries} accentColor={app.color} onClose={()=>setShowScriptPopup(false)} onSelect={handleRunScript}/>}
      {scriptRunner && <ScriptRunnerPanel url={scriptRunner.url} filename={scriptRunner.filename} scriptType={scriptRunner.scriptType} onClose={()=>setScriptRunner(null)}/>}
    </>
  );
}

function ScriptSelectPopup({ name, entries, accentColor, onClose, onSelect }:{
  name:string; entries:DownloadEntry[]; accentColor:string;
  onClose:()=>void; onSelect:(entry:DownloadEntry)=>void;
}) {
  return (
    <div style={{ position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,.65)',backdropFilter:'blur(6px)',display:'flex',alignItems:'flex-end',justifyContent:'center' }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'hsl(230 28% 10%)',borderRadius:'20px 20px 0 0',padding:'0 0 env(safe-area-inset-bottom,0)',width:'100%',maxWidth:520,boxShadow:'0 -12px 48px rgba(0,0,0,.7)',border:'1px solid rgba(255,255,255,.08)',borderBottom:'none' }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex',justifyContent:'center',padding:'12px 0 4px' }}>
          <div style={{ width:40,height:4,borderRadius:2,background:'rgba(255,255,255,.15)' }}/>
        </div>
        <div style={{ padding:'12px 24px 16px',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:'rgba(255,255,255,.35)',marginBottom:4 }}>Seleccionar Script</div>
          <div style={{ fontWeight:800,fontSize:'1.05rem',color:'#fff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{name}</div>
        </div>
        <div style={{ padding:'12px 16px 28px',display:'flex',flexDirection:'column',gap:8,maxHeight:'60vh',overflowY:'auto' }}>
          {entries.map((entry,i)=>{
            const isBat = entry.url.endsWith('.bat');
            const color = isBat ? '#6366f1' : '#10b981';
            const icon = isBat ? '📋' : '🐧';
            return (
              <button key={i} onClick={()=>onSelect(entry)}
                style={{ display:'flex',alignItems:'center',gap:14,padding:'13px 16px',borderRadius:12,background:'rgba(255,255,255,.05)',border:`1px solid ${color}22`,cursor:'pointer',textAlign:'left',transition:'background .12s',width:'100%' }}
                onMouseEnter={e=>{e.currentTarget.style.background=`${color}18`;}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';}}>
                <div style={{ width:40,height:40,borderRadius:10,background:`${color}22`,border:`1px solid ${color}44`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0 }}>{icon}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:700,fontSize:14,color:'#fff',marginBottom:2 }}>{entry.label}</div>
                  <div style={{ fontSize:11,color:'rgba(255,255,255,.4)',display:'flex',gap:8,alignItems:'center' }}>
                    <span style={{ background:`${color}22`,border:`1px solid ${color}33`,borderRadius:4,padding:'1px 6px',color:color,fontWeight:600 }}>{isBat ? 'Windows BAT' : 'Linux SH'}</span>
                    {entry.size && <span>{entry.size}</span>}
                  </div>
                </div>
                <div style={{ width:32,height:32,borderRadius:'50%',background:`${accentColor}22`,border:`1px solid ${accentColor}44`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  <Icon name="terminal" size={14} style={{ color:accentColor }}/>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ROM Detail ───────────────────────────────────────────────────────────────
function RomDetailView({ rom, console: c, onBack, onDownloadSaved, onRequireAuth, onDownloadProgress }: { rom:Rom; console:Console; onBack:()=>void; onDownloadSaved?:()=>void; onRequireAuth?:()=>boolean; onDownloadProgress?: (id: string, name: string, icon: string, progress: number, size?: string) => void }) {
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [filePath, setFilePath] = useState(getRomPath(rom.id));
  const [emulatorPath, setEmulatorPath] = useState(getEmulatorPath(c.name));
  const [showDlPopup, setShowDlPopup] = useState(false);
  const [igdbData, setIgdbData] = useState<any>(null);
  const [igdbLoading, setIgdbLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [cachedCover, setCachedCover] = useState<string | undefined>(undefined);
  const [showConfig, setShowConfig] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const accentColor = '#e8692a';

  useEffect(() => {
    // Actualizar rutas si cambian globalmente
    setEmulatorPath(getEmulatorPath(c.name));
    setFilePath(getRomPath(rom.id));
  }, [rom.id, c.name]);

  useEffect(() => {
    const lib = loadLibrary();
    const item = lib.find(i => i.rom.id === rom.id);
    setIsFavorite(!!item);
    if (item?.cachedCover) setCachedCover(item.cachedCover);
  }, [rom.id]);

  const toggleFavorite = async () => {
    if (isFavorite) {
      removeFromLibrary(rom.id);
      setCachedCover(undefined);
      showToast('Eliminado de la biblioteca', 'info');
    } else {
      showToast('Guardando en biblioteca...', 'info');
      const coverUrl = igdbData?.details?.cover_url || rom.coverUrl;
      const base64 = await imageUrlToBase64(coverUrl);
      
      saveToLibrary({ rom, console: c, cachedCover: base64 || undefined });
      if (base64) setCachedCover(base64);
      showToast('Guardado en la biblioteca', 'success');
    }
    setIsFavorite(!isFavorite);
  };

  useEffect(() => {
    let active = true;
    async function loadIgdb() {
      setIgdbLoading(true);
      const data = await fetchIgdbData(rom.title, c.name);
      if (active) {
        if (data) setIgdbData(data);
        setIgdbLoading(false);
      }
    }
    loadIgdb();
    return () => { active = false; };
  }, [rom.title, c.name]);

  const dlEntries: DownloadEntry[] = rom.downloads && rom.downloads.length > 0
    ? rom.downloads
    : [{ label: rom.title, url: rom.downloadUrl, size: rom.size, type: 'base' }];

  function triggerRomDownload(entry: DownloadEntry) {
    setShowDlPopup(false);
    if (onRequireAuth && !onRequireAuth()) return;

    // --- ANIMACIÓN DE VUELO ---
    const btn = document.querySelector('.btn-main-action');
    const target = document.querySelector('.header-download-icon');
    
    if (btn && target) {
      const btnRect = btn.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      
      const flyer = document.createElement('div');
      flyer.innerHTML = '🎮';
      flyer.style.position = 'fixed';
      flyer.style.left = `${btnRect.left + btnRect.width / 2}px`;
      flyer.style.top = `${btnRect.top + btnRect.height / 2}px`;
      flyer.style.fontSize = '24px';
      flyer.style.zIndex = '9999';
      flyer.style.pointerEvents = 'none';
      flyer.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      document.body.appendChild(flyer);
      
      requestAnimationFrame(() => {
        flyer.style.left = `${targetRect.left + targetRect.width / 2}px`;
        flyer.style.top = `${targetRect.top + targetRect.height / 2}px`;
        flyer.style.transform = 'scale(0.3) rotate(360deg)';
        flyer.style.opacity = '0.4';
      });
      
      setTimeout(() => {
        flyer.remove();
        if (target instanceof HTMLElement) {
          target.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          target.style.transform = 'scale(1.4) translateY(-3px)';
          setTimeout(() => {
            target.style.transform = 'scale(1)';
          }, 200);
        }
      }, 800);
    }
    // -------------------------

    setDownloading(true);
    setProgress(0);
    
    const downloadId = `rom-${rom.id}-${entry.label}`;
    const displayIcon = igdbData?.details?.cover_url || rom.coverUrl || '🎮';
    
    // Iniciamos el tracker de progreso local.
    onDownloadProgress?.(downloadId, rom.title, displayIcon, 0, entry.size || rom.size);

    // Extraer nombre de archivo de la URL o generar uno limpio
    let filename = "";
    try {
      const urlObj = new URL(entry.url);
      filename = path.basename(urlObj.pathname);
    } catch(e) {}
    
    if (!filename || filename.length < 3) {
      filename = `${rom.title.replace(/[^a-z0-9]/gi, '_')}_${entry.label.replace(/[^a-z0-9]/gi, '_')}`;
    }
    
    downloadFile(entry.url, filename, (p) => {
      setProgress(p);
      onDownloadProgress?.(downloadId, rom.title, displayIcon, p, entry.size || rom.size);
    }, downloadId)
      .then((filePath) => {
        if (filePath === '__NATIVE__') {
          setDownloading(false);
          setProgress(0);
          return;
        }
        setDownloading(false);
        setProgress(0);
        setDownloaded(true);
        setFilePath(filePath);
        saveRomPath(rom.id, filePath); // Guardar ruta del ROM descargado
        onDownloadProgress?.(downloadId, rom.title, displayIcon, 100, entry.size || rom.size);
        showToast(`${entry.label} descargado con éxito`, 'success');
        if (shell && filePath) shell.showItemInFolder(filePath);
        
        saveDownloadRecord({ 
          id: `rom-${rom.id}-${Date.now()}`, 
          name: rom.title, 
          icon: displayIcon, 
          type: 'rom', 
          category: c.name, 
          size: entry.size || rom.size, 
          date: new Date().toISOString(),
          filePath: filePath
        });
        onDownloadSaved?.();
      })
      .catch((err) => {
        if (err.message === 'Descarga cancelada') {
          setDownloading(false);
          setProgress(0);
          return;
        }
        setDownloading(false);
        setProgress(0);
        onDownloadProgress?.(downloadId, rom.title, displayIcon, 100, entry.size || rom.size);
        showToast(`Error: ${err.message}`, 'error');
        console.error("ROM download error:", err);
      });
  }
  function handleDownload() {
    if (onRequireAuth && !onRequireAuth()) return;
    if (rom.downloads && rom.downloads.length > 0) { setShowDlPopup(true); return; }
    triggerRomDownload({ label: rom.title, url: rom.downloadUrl, size: rom.size, type: 'base' });
  }
  function handleSelectFile() {
    const inp=document.createElement('input'); inp.type='file'; inp.accept=c.fileExtensions.join(',');
    inp.onchange=(e:Event)=>{ 
      const f=(e.target as HTMLInputElement).files?.[0]; 
      if(f){ 
        const path = f.path || f.name;
        setFilePath(path);
        setDownloaded(true); 
        saveRomPath(rom.id, path); // Guardar ruta del ROM seleccionado
        showToast(`ROM seleccionado y guardado`,'success'); 
      } 
    }; 
    inp.click();
  }
  function handleSelectEmulator() {
    const inp=document.createElement('input'); inp.type='file';
    inp.onchange=(e:Event)=>{ 
      const f=(e.target as HTMLInputElement).files?.[0]; 
      if(f){ 
        const path = f.path || f.name;
        setEmulatorPath(path);
        saveEmulatorPath(c.name, path); // Guardar emulador para toda la consola
        showToast(`Emulador guardado para ${c.name}`,'success'); 
      } 
    }; 
    inp.click();
  }
  function handleExecute() { 
    if (!filePath) {
      showToast('No hay un archivo ROM seleccionado.', 'error');
      return;
    }
    
    showToast(`Iniciando ${rom.title}...`,'success'); 
    if (ipcRenderer) {
      ipcRenderer.send("launch-emulator", { 
        filePath: filePath, 
        romTitle: rom.title, 
        emulatorPath: emulatorPath 
      });
    } else {
      console.warn("IPC not available to launch emulator");
    }
  }
  
  const mediaItems: MediaItem[] = [
    ...(igdbData?.trailers?.map((t:any) => ({
      type: 'video' as const,
      label: t.name || 'Trailer',
      videoId: t.videoId
    })) || []),

    ...(rom.videoId?[{type:'video' as const,label:'Gameplay',videoId:rom.videoId}]:[]),
    
    ...(igdbData?.screenshots?.map((s:any, i:number) => ({
      type: 'screen' as const,
      label: `Captura IGDB ${i+1}`,
      src: s.image
    })) || []),

    ...rom.screenshots.map((src,i)=>({type:'screen' as const,label:`Captura ${i+1}`,src})),
  ];

  const displayRating = igdbData?.details?.rating ? Math.round(igdbData.details.rating / 2) : rom.rating;
  const displayReviews = igdbData?.details?.ratings_count || Math.floor(rom.rating * 680);
  const displayDescription = igdbData?.details?.description_raw || rom.description;
  const displayReleaseDate = igdbData?.details?.released || rom.year.toString();
  const displayDeveloper = igdbData?.details?.developers?.[0]?.name || rom.developer;
  const displayPublisher = igdbData?.details?.publishers?.[0]?.name || c.name;

  const extraPanel = (
    <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
      <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'16px 20px' }}>
        <div style={{ fontSize:12,fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em',color:'rgba(255,255,255,.35)',marginBottom:12 }}>Instrucciones</div>
        {rom.instructions.map((step,i)=><div key={i} style={{ display:'flex',gap:10,alignItems:'flex-start',marginBottom:9 }}><div style={{ width:20,height:20,borderRadius:'50%',background:`${accentColor}33`,border:`1px solid ${accentColor}55`,color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1 }}>{i+1}</div><span style={{ color:'rgba(255,255,255,.5)',fontSize:13,lineHeight:1.6 }}>{step}</span></div>)}
      </div>
    </div>
  );
  const romActionLabel = rom.downloads && rom.downloads.length > 0
    ? (downloaded ? `Descargar de nuevo (${rom.downloads.length})` : `Descargar ROM (${rom.downloads.length})`)
    : (downloaded ? 'Descargar de nuevo' : 'Descargar ROM');

  const extraActions = (
    <button onClick={toggleFavorite}
      style={{ width:44, height:44, borderRadius:'50%', border:'1px solid rgba(255,255,255,.15)', background:isFavorite?'rgba(232,105,42,.2)':'rgba(255,255,255,.07)', color:isFavorite?'#e8692a':'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s' }}
      title={isFavorite ? 'Quitar de biblioteca' : 'Guardar en biblioteca'}>
      <Icon name={isFavorite ? 'heart' : 'heart'} size={20} style={{ fill: isFavorite ? 'currentColor' : 'none' }}/>
    </button>
  );

  if (igdbLoading) {
    return <GamingDetailSkeleton />;
  }

  return (
    <>
      <GamingDetailLayout onBack={onBack} backLabel="Volver" coverEmoji="🎮" coverBg={`${c.gradient}, #0a0a18`} coverUrl={cachedCover || igdbData?.details?.cover_url || rom.coverUrl} title={rom.title} genres={[c.name,rom.genre]} description={displayDescription} platform={`${c.name} · ${c.emulator}`} ratingNum={displayRating} reviews={displayReviews} language={`${rom.region} · ${rom.players}P`} releaseDate={displayReleaseDate} size={rom.size} developer={displayDeveloper} publisher={displayPublisher} accentColor={accentColor} actionLabel={romActionLabel} actionIcon="download" onAction={handleDownload} actionPending={downloading} actionProgress={progress} secondaryLabel={(downloaded || !!filePath)?'Ejecutar':undefined} secondaryIcon="run" onSecondary={(downloaded || !!filePath)?handleExecute:undefined} mediaItems={mediaItems} extraPanel={extraPanel} extraActions={extraActions} onSettings={() => setShowConfigModal(true)}/>
      {showDlPopup && <DownloadPopup name={rom.title} entries={dlEntries} accentColor={accentColor} onClose={()=>setShowDlPopup(false)} onSelect={triggerRomDownload}/>}
      {showConfigModal && <RomConfigModal title={rom.title} filePath={filePath} emulatorPath={emulatorPath} accentColor={accentColor} onSelectFile={handleSelectFile} onSelectEmulator={handleSelectEmulator} onClose={() => setShowConfigModal(false)} />}
    </>
  );
}

// ─── Console Banner ───────────────────────────────────────────────────────────
function ConsoleBanner({ console: c, onClick }: { console:Console; onClick:()=>void }) {
  return (
    <div onClick={onClick} style={{ background:c.gradient,borderRadius:'1rem',padding:'22px 28px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',position:'relative',overflow:'hidden',minHeight:110,transition:'transform .2s,box-shadow .2s' }}
      onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(-2px)';(e.currentTarget as HTMLDivElement).style.boxShadow='0 12px 40px rgba(0,0,0,.35)';}}
      onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform='';(e.currentTarget as HTMLDivElement).style.boxShadow='';}}>
      <div style={{ position:'absolute',inset:0,opacity:.08,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 24px,rgba(255,255,255,.3) 24px,rgba(255,255,255,.3) 25px),repeating-linear-gradient(90deg,transparent,transparent 24px,rgba(255,255,255,.3) 24px,rgba(255,255,255,.3) 25px)',pointerEvents:'none' }}/>
      <div style={{ zIndex:1 }}>
        <h2 style={{ margin:'0 0 8px',fontSize:'1.25rem',fontWeight:800,color:'white',textShadow:'0 2px 8px rgba(0,0,0,.3)' }}>{c.name}</h2>
        <p style={{ margin:'0 0 14px',fontSize:13,color:'rgba(255,255,255,.8)',maxWidth:340,lineHeight:1.5 }}>{c.description}</p>
        <button onClick={e=>{e.stopPropagation();onClick();}} style={{ background:'hsl(var(--primary))',color:'white',border:'none',borderRadius:20,padding:'7px 18px',fontSize:13,fontWeight:600,cursor:'pointer' }}>Ver roms</button>
      </div>
      <div style={{ zIndex:1,textAlign:'right',flexShrink:0 }}>
        <div style={{ fontSize:c.shortName.length>6?'1.5rem':'2.5rem',fontWeight:900,color:'rgba(255,255,255,.25)',letterSpacing:'.05em',textTransform:'uppercase',lineHeight:1,fontStyle:'italic' }}>{c.logoText}</div>
        <div style={{ fontSize:12,color:'rgba(255,255,255,.5)',marginTop:4 }}>{c.romCount} juegos</div>
      </div>
    </div>
  );
}

// ─── Download Item Components ────────────────────────────────────────────────
function DownloadIcon({ name, category, initialIcon, type }: { name: string; category: string; initialIcon: string; type: 'app' | 'rom' | 'mod' }) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(type === 'rom');

  useEffect(() => {
    if (type !== 'rom') return;
    let active = true;
    async function loadIcon() {
      const data = await fetchIgdbData(name, category);
      if (active && data?.details?.cover_url) {
        setIconUrl(data.details.cover_url);
      }
      if (active) setLoading(false);
    }
    loadIcon();
    return () => { active = false; };
  }, [name, category, type]);

  if (type === 'app' && initialIcon.length > 4) { // Es una URL
    return <img src={initialIcon} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  
  if (initialIcon.startsWith('http')) { // Es una URL (portada)
    return <img src={initialIcon} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      {loading ? (
        <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />
      ) : iconUrl ? (
        <img src={iconUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span>{initialIcon}</span>
      )}
    </div>
  );
}

// ─── Library Card ─────────────────────────────────────────────────────────────
function LibraryCard({ item, onSelect, onRemove }: { item: LibraryItem; onSelect: (r: Rom) => void; onRemove: () => void }) {
  const { rom, console: c, cachedCover } = item;
  return (
    <div onClick={() => onSelect(rom)} 
      style={{ 
        borderRadius:'1rem', 
        overflow:'hidden', 
        cursor:'pointer', 
        position:'relative', 
        transition:'all .3s cubic-bezier(0.4, 0, 0.2, 1)', 
        background:'hsl(var(--card))', 
        border:'1px solid hsl(var(--border))',
        display:'flex',
        flexDirection:'column'
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-5px)';
        e.currentTarget.style.borderColor = 'hsl(var(--primary)/.3)';
        e.currentTarget.style.boxShadow = '0 10px 30px -10px rgba(0,0,0,0.5)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.boxShadow = '';
      }}>
      
      <div style={{ aspectRatio:'16/10', position:'relative', overflow:'hidden', background:'linear-gradient(135deg,hsl(var(--muted)),hsl(var(--border)))' }}>
        {cachedCover ? (
          <img src={cachedCover} alt={rom.title} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        ) : (
          <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'3rem', opacity:0.5 }}>🎮</div>
        )}
        
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'50%', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', color:'white', cursor:'pointer', zIndex:10, transition:'all .2s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
          title="Eliminar de biblioteca"
        >
          <Icon name="x" size={14} />
        </button>

        <div style={{ position:'absolute', bottom:8, left:8, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', padding:'2px 8px', borderRadius:20, fontSize:10, color:'white', border:'1px solid rgba(255,255,255,0.1)' }}>
          {c.name}
        </div>
      </div>
      
      <div style={{ padding:'12px 14px', background:'linear-gradient(to bottom, transparent, rgba(0,0,0,0.2))' }}>
        <div style={{ fontWeight:600, fontSize:14, color:'hsl(var(--foreground))', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{rom.title}</div>
      </div>
    </div>
  );
}

// ─── ROM List Item ────────────────────────────────────────────────────────────
function RomListItem({ rom, console: c, onSelect, cachedCover }: { rom: Rom; console: Console; onSelect: (r: Rom) => void; cachedCover?: string }) {
  const [igdbData, setIgdbData] = useState<any>(null);
  const [loading, setLoading] = useState(!cachedCover);

  useEffect(() => {
    if (cachedCover) return;
    let active = true;
    async function loadData() {
      setLoading(true);
      const data = await fetchIgdbData(rom.title, c.name);
      if (active) {
        setIgdbData(data);
        setLoading(false);
      }
    }
    loadData();
    return () => { active = false; };
  }, [rom.title, c.name, cachedCover]);

  const displayIcon = cachedCover || igdbData?.details?.cover_url || rom.coverUrl;
  const displayRating = igdbData?.details?.rating ? Math.round(igdbData.details.rating / 2) : rom.rating;

  return (
    <div onClick={() => onSelect(rom)}
      style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '.875rem', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', transition: 'border-color .15s,transform .15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'hsl(var(--primary)/.4)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = ''; (e.currentTarget as HTMLDivElement).style.transform = ''; }}>
      
      <div style={{ width: 64, height: 64, borderRadius: '.5rem', background: 'linear-gradient(135deg,hsl(var(--muted)),hsl(var(--border)))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.8rem', overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />
        ) : displayIcon ? (
          <img src={displayIcon} alt={rom.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          '🎮'
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{rom.title}</span>
          <span style={{ fontSize: 11, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', padding: '1px 7px', borderRadius: 20 }}>{rom.region}</span>
          <span style={{ color: '#f59e0b', display: 'flex', gap: 2 }}>
            {[1, 2, 3, 4, 5].map(i => <Icon key={i} name={i <= displayRating ? 'star' : 'starEmpty'} size={12} />)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}><span>{rom.genre}</span><span>{rom.players}P</span><span>{rom.year}</span><span>{rom.size}</span></div>
      </div>
      <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }} onClick={e => { e.stopPropagation(); onSelect(rom); }}>Ver detalles</button>
    </div>
  );
}

// ─── ROM List ─────────────────────────────────────────────────────────────────
function RomListView({ console: c, onSelectRom, onBack }: { console: Console; onSelectRom: (r: Rom) => void; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const filtered = c.roms.filter(r => 
    r.title.toLowerCase().includes(search.toLowerCase()) || 
    r.genre.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / pageSize);
  const currentRoms = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Reset page when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  const handlePrev = () => setPage(p => Math.max(1, p - 1));
  const handleNext = () => setPage(p => Math.min(totalPages, p + 1));

  return (
    <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap', flexShrink: 0 }}>
        <button className="btn-icon" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'hsl(var(--muted-foreground))', border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="arrowLeft" size={18} /> Volver</button>
        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>{c.name}</h2>
        <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted))', padding: '2px 10px', borderRadius: 20, border: '1px solid hsl(var(--border))' }}>{filtered.length} juegos</span>
        
        {/* Paginación Superior */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'hsl(var(--muted)/.5)', padding: '4px 8px', borderRadius: 12, border: '1px solid hsl(var(--border))', marginLeft: 'auto' }}>
            <button 
              onClick={handlePrev} 
              disabled={page === 1}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: page === 1 ? 'transparent' : 'hsl(var(--primary)/.15)', color: page === 1 ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))', cursor: page === 1 ? 'default' : 'pointer', transition: 'all 0.2s' }}
            >
              <Icon name="arrowLeft" size={14} />
            </button>
            
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = page;
                if (totalPages <= 5) pageNum = i + 1;
                else if (page <= 3) pageNum = i + 1;
                else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = page - 2 + i;

                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      border: 'none',
                      background: page === pageNum ? 'hsl(var(--primary))' : 'transparent',
                      color: page === pageNum ? 'white' : 'hsl(var(--foreground))',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={handleNext} 
              disabled={page === totalPages}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: page === totalPages ? 'transparent' : 'hsl(var(--primary)/.15)', color: page === totalPages ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))', cursor: page === totalPages ? 'default' : 'pointer', transition: 'all 0.2s' }}
            >
              <Icon name="arrowRight" size={14} />
            </button>
          </div>
        )}

        <div style={{ marginLeft: totalPages > 1 ? 0 : 'auto', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))', pointerEvents: 'none' }}><Icon name="search" size={14} /></span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ROM..." style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', borderRadius: '.5rem', color: 'hsl(var(--foreground))', padding: '6px 10px 6px 32px', outline: 'none', fontSize: 13, width: 180, fontFamily: 'inherit' }} />
        </div>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {currentRoms.map(rom => (
          <RomListItem key={rom.id} rom={rom} console={c} onSelect={onSelectRom} />
        ))}
        {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'hsl(var(--muted-foreground))', padding: 40 }}>No se encontraron ROMs</div>}
      </div>
    </div>
  );
}

// ─── Mods Section ─────────────────────────────────────────────────────────────
const NEXUS_API = 'https://api.nexusmods.com/v1';
const NEXUS_KEY_STORAGE = 'nexus_api_key';
const NEXUS_GAMES_LIST = [
  { domain:'skyrimspecialedition', name:'Skyrim SE',        emoji:'⚔️',  color:'#3a506b' },
  { domain:'cyberpunk2077',        name:'Cyberpunk 2077',   emoji:'🌆', color:'#e4b343' },
  { domain:'witcher3',             name:'The Witcher 3',    emoji:'🐺', color:'#c0392b' },
  { domain:'fallout4',             name:'Fallout 4',        emoji:'☢️', color:'#e67e22' },
  { domain:'baldursgate3',         name:"Baldur's Gate 3",  emoji:'🧙', color:'#6c3483' },
  { domain:'stalker2',             name:'STALKER 2',        emoji:'🔫', color:'#2e4053' },
  { domain:'darksouls3',           name:'Dark Souls 3',     emoji:'🔥', color:'#922b21' },
  { domain:'minecraft',            name:'Minecraft',        emoji:'⛏️', color:'#1e8449' },
  { domain:'stardewvalley',        name:'Stardew Valley',   emoji:'🌾', color:'#2d6a4f' },
  { domain:'dragonsdogma2',        name:"Dragon's Dogma 2", emoji:'🐉', color:'#784212' },
  { domain:'eldenring',            name:'Elden Ring',       emoji:'🪐', color:'#6e2f1a' },
  { domain:'gtav',                 name:'GTA V',            emoji:'🚗', color:'#1f618d' },
];

interface NexusMod { mod_id:number; name:string; summary:string; picture_url:string; author:string; endorsement_count:number; download_count:number; game_id:number; updated_timestamp:number; }
interface NexusModDetail extends NexusMod { description:string; }
interface NexusFile { file_id:number; name:string; file_name:string; version:string; description:string; size_kb:number; category_name:string; }

// ─── Nexus Mods WebView ───────────────────────────────────────────────────────
function NexusModsWebView({ isAdmin, onDownloadProgress, onDownloadSaved }: { isAdmin: boolean; onDownloadProgress?: (id: string, name: string, icon: string, progress: number, size?: string) => void; onDownloadSaved?: () => void }) {
  const providers = {
    nexus: {
      name: 'NexusMods',
      initial: 'https://www.nexusmods.com/mods?sort=endorsements',
      accent: '#da8e35',
      icon: 'wrench',
      searchUrl: (q: string) => `https://www.nexusmods.com/mods?keyword=${encodeURIComponent(q)}&sort=endorsements`,
      gameSearchUrl: (q: string) => `https://www.nexusmods.com/search?keyword=${encodeURIComponent(q)}`,
      links: [
        { label: 'Inicio', url: 'https://www.nexusmods.com/mods?sort=endorsements', icon: 'home' },
        { label: 'Juegos', url: 'https://www.nexusmods.com/games', icon: 'gamepad' },
        { label: 'Mods', url: 'https://www.nexusmods.com/mods?sort=endorsements', icon: 'tag' },
        { label: 'Cuenta', url: 'https://www.nexusmods.com/users/myaccount', icon: 'user' },
      ]
    },
    gamebanana: {
      name: 'GameBanana',
      initial: 'https://gamebanana.com/',
      accent: '#facc15',
      icon: 'package',
      searchUrl: (q: string) => `https://gamebanana.com/mods/search?_sSearchString=${encodeURIComponent(q)}`,
      gameSearchUrl: (q: string) => `https://gamebanana.com/search?_sModelName=Game&_sOrder=best_match&_sSearchString=${encodeURIComponent(q)}`,
      links: [
        { label: 'Inicio', url: 'https://gamebanana.com/', icon: 'home' },
        { label: 'Juegos', url: 'https://gamebanana.com/games', icon: 'gamepad' },
        { label: 'Mods', url: 'https://gamebanana.com/mods', icon: 'tag' },
        { label: 'Mi Perfil', url: 'https://gamebanana.com/members/me', icon: 'user' },
      ]
    }
  };

  const [providerKey, setProviderKey] = useState<'nexus' | 'gamebanana'>('nexus');
  const provider = providers[providerKey];
  
  const [currentUrl, setCurrentUrl] = useState(provider.initial);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const [query, setQuery] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [cleanMode, setCleanMode] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const navIdRef = useRef(0);

  const load = (url: string) => {
    if (!isAdmin) return;
    if (isElectron) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('nexus-view-navigate', url);
      setCurrentUrl(url);
    }
  };

  const reload = () => {
    if (isElectron) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('nexus-view-navigate', currentUrl);
    }
  };

  const goBack = () => {
    // WebContentsView requiere manejo de historial en el main o trackeo aquí
  };

  const goForward = () => {
    // WebContentsView requiere manejo de historial en el main o trackeo aquí
  };

  const syncNav = () => {
    // Sincronización básica de URL si fuera necesario
  };

  const applyCleanMode = (id: number) => {
    // El modo clean (CSS inyectado) requiere executeJavaScript en el view
  };

  const openExternal = () => {
    const url = currentUrl || provider.initial;
    if (isElectron) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('open-external', url);
    } else {
      window.open(url, '_blank');
    }
  };

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    load(provider.searchUrl(q));
  };

  const runGameSearch = () => {
    const q = gameQuery.trim();
    if (!q) return;
    load(provider.gameSearchUrl(q));
  };

  const switchProvider = (key: 'nexus' | 'gamebanana') => {
    setProviderKey(key);
    const newProvider = providers[key];
    load(newProvider.initial);
  };

  const openDevTools = () => {
    if (isElectron) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('open-devtools');
      ipcRenderer.send('nexus-view-devtools'); 
    }
  };

  useEffect(() => {
    if (!isElectron || !isAdmin) return;
    const { ipcRenderer } = window.require('electron');

    const updateBounds = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        ipcRenderer.send('nexus-view-toggle', {
          show: true,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      }
    };

    updateBounds();
    window.addEventListener('resize', updateBounds);

    return () => {
      window.removeEventListener('resize', updateBounds);
      ipcRenderer.send('nexus-view-toggle', { show: false });
    };
  }, [isAdmin]);

  const loading = false;

  if (!isAdmin) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,20,.95)', textAlign: 'center', padding: 40, position: 'relative' }}>
        <div style={{ position:'absolute',inset:0,backgroundImage:'radial-gradient(circle, rgba(255,255,255,.018) 1px, transparent 1px)',backgroundSize:'28px 28px',pointerEvents:'none',zIndex:0 }}/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '4rem', marginBottom: 20, animation: 'pulse 2s infinite' }}>🛠️</div>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 900, color: 'white', marginBottom: 12 }}>Sección en Desarrollo</h2>
          <p style={{ color: 'rgba(255,255,255,.6)', maxWidth: 400, lineHeight: 1.6, fontSize: 15 }}>Estamos trabajando para integrar NexusMods directamente en la aplicación. Muy pronto podrás descargar y gestionar tus mods favoritos desde aquí.</p>
          <div style={{ marginTop: 24, padding: '8px 20px', borderRadius: 20, background: 'hsl(var(--primary)/.15)', border: '1px solid hsl(var(--primary)/.3)', color: 'hsl(var(--primary))', fontSize: 13, fontWeight: 700 }}>PRÓXIMAMENTE v2.1</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'linear-gradient(160deg,#151520 0%,#0e0e18 60%,#0a0a14 100%)', position: 'relative' }}>
      <div style={{ position:'absolute',inset:0,backgroundImage:'radial-gradient(circle, rgba(255,255,255,.018) 1px, transparent 1px)',backgroundSize:'28px 28px',pointerEvents:'none',zIndex:0 }}/>

      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 24px',position:'relative',zIndex:1,borderBottom:'1px solid rgba(255,255,255,.06)',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',gap:16 }}>
          <div style={{ display:'flex',alignItems:'center',gap:12 }}>
            <div style={{ width:40,height:40,borderRadius:12,background:`linear-gradient(135deg,${provider.accent},#c1651a)`,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:`0 10px 30px ${provider.accent}33` }}>
              <Icon name={provider.icon} size={18}/>
            </div>
            <div>
              <div style={{ fontWeight:900,fontSize:15,letterSpacing:'-.01em' }}>{provider.name}</div>
              <div style={{ fontSize:12,color:'rgba(255,255,255,.45)' }}>Tienda de mods integrada</div>
            </div>
          </div>

          <div style={{ height:24, width:1, background:'rgba(255,255,255,.1)' }} />

          <div style={{ display:'flex', background:'rgba(255,255,255,.05)', padding:4, borderRadius:12, border:'1px solid rgba(255,255,255,.08)' }}>
            {(['nexus', 'gamebanana'] as const).map(k => (
              <button
                key={k}
                onClick={() => switchProvider(k)}
                style={{ 
                  padding:'6px 14px', 
                  borderRadius:8, 
                  border:'none', 
                  fontSize:11, 
                  fontWeight:800, 
                  cursor:'pointer', 
                  fontFamily:'inherit',
                  transition:'all .2s',
                  background: providerKey === k ? 'white' : 'transparent',
                  color: providerKey === k ? '#0a0a1a' : 'rgba(255,255,255,.5)'
                }}
              >
                {providers[k].name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <button className="btn-secondary" style={{ fontSize:12,padding:'6px 14px' }} onClick={openExternal}>
            <Icon name="share" size={14}/> Abrir fuera
          </button>
        </div>
      </div>

      <div style={{ display:'flex',flex:1,minHeight:0,position:'relative',zIndex:1,overflow:'hidden' }}>
        <div style={{ width:360,flexShrink:0,borderRight:'1px solid rgba(255,255,255,.06)',padding:'20px 20px',display:'flex',flexDirection:'column',gap:14 }}>
          <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'14px 14px',backdropFilter:'blur(10px)' }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
              <div style={{ width:34,height:34,borderRadius:12,background:`${provider.accent}22`,border:`1px solid ${provider.accent}44`,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="gamepad" size={16}/>
              </div>
              <div style={{ fontWeight:800,fontSize:13 }}>Buscar juego</div>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <div style={{ flex:1,position:'relative' }}>
                <input
                  value={gameQuery}
                  onChange={e => setGameQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runGameSearch(); }}
                  placeholder="Ej: Skyrim, Sonic..."
                  style={{ width:'100%',boxSizing:'border-box',padding:'9px 10px 9px 34px',borderRadius:12,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.08)',color:'rgba(255,255,255,.9)',outline:'none',fontFamily:'inherit',fontSize:13 }}
                />
                <span style={{ position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,.45)' }}>
                  <Icon name="search" size={14}/>
                </span>
              </div>
              <button onClick={runGameSearch} style={{ padding:'9px 12px',borderRadius:12,border:`1px solid ${provider.accent}55`,background:`${provider.accent}22`,color:provider.accent,cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:800,whiteSpace:'nowrap' }}>
                Ir
              </button>
            </div>
          </div>

          <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'14px 14px',backdropFilter:'blur(10px)' }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
              <div style={{ width:34,height:34,borderRadius:12,background:`${provider.accent}22`,border:`1px solid ${provider.accent}44`,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="globe" size={16}/>
              </div>
              <div style={{ fontWeight:800,fontSize:13 }}>Navegación</div>
            </div>
            <div style={{ display:'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display:'flex', gap: 8 }}>
                {provider.links.slice(0, 2).map(link => (
                  <button key={link.label} onClick={() => load(link.url)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'8px 10px',borderRadius:12,border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.05)',color:'rgba(255,255,255,.85)',cursor:'pointer',fontFamily:'inherit',fontSize:12 }}>
                    <Icon name={link.icon as any} size={14}/> {link.label}
                  </button>
                ))}
              </div>
              <div style={{ display:'flex', gap: 8 }}>
                {provider.links.slice(2, 4).map(link => (
                  <button key={link.label} onClick={() => load(link.url)} style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'8px 10px',borderRadius:12,border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.05)',color:'rgba(255,255,255,.85)',cursor:'pointer',fontFamily:'inherit',fontSize:12 }}>
                    <Icon name={link.icon as any} size={14}/> {link.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'14px 14px',backdropFilter:'blur(10px)' }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
              <div style={{ width:34,height:34,borderRadius:12,background:`${provider.accent}22`,border:`1px solid ${provider.accent}44`,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="search" size={16}/>
              </div>
              <div style={{ fontWeight:800,fontSize:13 }}>Buscar mods</div>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <div style={{ flex:1,position:'relative' }}>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  placeholder={providerKey === 'nexus' ? "Ej: Skyrim UI" : "Ej: Sonic mods"}
                  style={{ width:'100%',boxSizing:'border-box',padding:'9px 10px 9px 34px',borderRadius:12,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.08)',color:'rgba(255,255,255,.9)',outline:'none',fontFamily:'inherit',fontSize:13 }}
                />
                <span style={{ position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,.45)' }}>
                  <Icon name="search" size={14}/>
                </span>
              </div>
              <button onClick={runSearch} style={{ padding:'9px 12px',borderRadius:12,border:`1px solid ${provider.accent}55`,background:`${provider.accent}22`,color:provider.accent,cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:800,whiteSpace:'nowrap' }}>
                Buscar
              </button>
            </div>
          </div>

          <div style={{ background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'1rem',padding:'14px 14px',backdropFilter:'blur(10px)' }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
              <div style={{ width:34,height:34,borderRadius:12,background:`${provider.accent}22`,border:`1px solid ${provider.accent}44`,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="monitor" size={16}/>
              </div>
              <div style={{ fontWeight:800,fontSize:13 }}>Vista</div>
            </div>
            <button
              onClick={() => setCleanMode(v => !v)}
              style={{ width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderRadius:12,border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.05)',color:'rgba(255,255,255,.85)',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:800 }}
            >
              <span style={{ display:'flex',alignItems:'center',gap:8 }}>
                <Icon name="grid" size={14}/> Tema app
              </span>
              <span style={{ color: cleanMode ? provider.accent : 'rgba(255,255,255,.35)' }}>{cleanMode ? 'ON' : 'OFF'}</span>
            </button>
            <div style={{ marginTop:8,fontSize:11,color:'rgba(255,255,255,.45)',lineHeight:1.5 }}>
              Aplica estilo oscuro y reduce elementos para enfocarse en el listado de mods.
            </div>
          </div>

          <div style={{ background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.07)',borderRadius:'1rem',padding:'12px 14px',color:'rgba(255,255,255,.55)',fontSize:12,lineHeight:1.5 }}>
            <div style={{ fontWeight:800,color:'rgba(255,255,255,.75)',marginBottom:6,display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                <Icon name="shield" size={14}/> Consejo
              </div>
              {isAdmin && (
                <button 
                  onClick={openDevTools}
                  style={{ background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', color:provider.accent, fontSize:10, padding:'2px 6px', borderRadius:4, cursor:'pointer', fontWeight:800 }}
                >
                  DEV
                </button>
              )}
            </div>
            Para iniciar sesión o descargar, es posible que NexusMods abra ventanas emergentes. Si algo falla, usa “Abrir fuera”.
          </div>
        </div>

        <div style={{ flex:1,minWidth:0,display:'flex',flexDirection:'column',padding:'20px 24px',gap:12 }}>
          <div className="glass-card" style={{ borderRadius:'1rem',overflow:'hidden',border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.03)',display:'flex',flexDirection:'column',flex:1,minHeight:0 }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:'1px solid rgba(255,255,255,.06)' }}>
              <button onClick={goBack} disabled={!canBack} style={{ width:32,height:32,borderRadius:'50%',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.85)',cursor:canBack?'pointer':'not-allowed',opacity:canBack?1:.35,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="arrowLeft" size={14}/>
              </button>
              <button onClick={goForward} disabled={!canForward} style={{ width:32,height:32,borderRadius:'50%',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.85)',cursor:canForward?'pointer':'not-allowed',opacity:canForward?1:.35,display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="arrowRight" size={14}/>
              </button>
              <button onClick={reload} style={{ width:32,height:32,borderRadius:'50%',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.85)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>
                <Icon name="refresh" size={14}/>
              </button>
              <div style={{ flex:1,minWidth:0,display:'flex',alignItems:'center',gap:8,padding:'0 10px',height:32,borderRadius:'999px',border:'1px solid rgba(255,255,255,.08)',background:'rgba(0,0,0,.2)',color:'rgba(255,255,255,.55)',fontSize:12,overflow:'hidden' }}>
                <Icon name="globe" size={13}/>
                <span style={{ whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{currentUrl}</span>
              </div>
              <button onClick={openExternal} style={{ padding:'6px 10px',borderRadius:'999px',border:'1px solid rgba(255,255,255,.10)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.85)',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:6 }}>
                <Icon name="share" size={14}/> Abrir
              </button>
            </div>

            <div ref={containerRef} style={{ position:'relative',flex:1,minHeight:0,background:'#000' }}>
              {/* El WebContentsView se renderiza sobre este contenedor desde el proceso principal */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Juegos Roms Section ──────────────────────────────────────────────────────
type RomView = { type:'list' }|{ type:'roms'; consoleId:string };
function JuegosRomsSection({ baseConsoles, customConsoles, romOverrides, extraRoms, hiddenRomIds, onDownloadSaved, onRequireAuth, onDownloadProgress }: { baseConsoles:Console[]|null; customConsoles:Console[]; romOverrides:RomOverrides; extraRoms:ExtraRoms; hiddenRomIds:string[]; onDownloadSaved?:()=>void; onRequireAuth?:()=>boolean; onDownloadProgress?: (id: string, name: string, icon: string, progress: number, size?: string) => void }) {
  const [view, setView] = useState<RomView>({ type:'list' });
  const [selectedRom, setSelectedRom] = useState<{rom:Rom; console:Console}|null>(null);

  const allConsoles: Console[] = baseConsoles
    ? [
        ...baseConsoles.map(c => ({
          ...c,
          roms: (() => {
            const merged = [
              ...c.roms
                .filter(r => !hiddenRomIds.includes(r.id))
                .map(r => romOverrides[r.id] ? { ...r, ...romOverrides[r.id] } : r),
              ...(extraRoms[c.id] || []),
            ];
            const seen = new Set<string>();
            return merged.filter(r => {
              if (seen.has(r.id)) return false;
              seen.add(r.id);
              return true;
            });
          })(),
        })),
        ...customConsoles,
      ]
    : [...customConsoles];

  const customCount = customConsoles.length;

  const currentConsole = view.type==='roms' ? allConsoles.find(c => c.id === view.consoleId) ?? null : null;

  return (
    <div style={{ position:'relative', flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
      {currentConsole ? (
        <RomListView console={currentConsole} onSelectRom={rom=>setSelectedRom({rom, console:currentConsole})} onBack={()=>setView({type:'list'})}/>
      ) : (
        <div style={{ padding:24,flex:1,overflowY:'auto' }}>
          <div style={{ marginBottom:20 }}>
            <h2 style={{ margin:'0 0 4px',fontSize:'1.3rem',fontWeight:700 }}>Juegos Roms</h2>
            <p style={{ color:'hsl(var(--muted-foreground))',fontSize:14,margin:0 }}>Selecciona una consola para ver sus juegos disponibles</p>
            {customCount>0&&<span style={{ fontSize:12,color:'hsl(var(--primary))',marginTop:4,display:'inline-block' }}>+ {customCount} consola(s) personalizada(s)</span>}
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
            {allConsoles.map(c=><ConsoleBanner key={c.id} console={c} onClick={()=>setView({type:'roms', consoleId:c.id})}/>)}
          </div>
        </div>
      )}

      {/* ROM Detail — modal overlay (igual que el detalle de programas, sin abrir aparte) */}
      {selectedRom && (
        <div style={{ position:'absolute',inset:0,zIndex:200,display:'flex',flexDirection:'column',overflow:'hidden',background:'hsl(var(--background))' }}>
          <RomDetailView rom={selectedRom.rom} console={selectedRom.console} onBack={()=>setSelectedRom(null)} onDownloadSaved={onDownloadSaved} onRequireAuth={onRequireAuth} onDownloadProgress={onDownloadProgress}/>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [splash, setSplash] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(loadUserSession);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [baseApps, setBaseApps] = useState<App[]>([]);
  const [customApps, setCustomApps] = useState<App[]>(loadCustomApps);
  const [customConsoles, setCustomConsoles] = useState<Console[]>(loadCustomConsoles);
  const [baseConsoles, setBaseConsoles] = useState<Console[]|null>(null);
  const [romOverrides, setRomOverrides] = useState<RomOverrides>(loadRomOverrides);
  const [extraRoms, setExtraRoms] = useState<ExtraRoms>(loadExtraRoms);
  const [hiddenRomIds, setHiddenRomIds] = useState<string[]>(loadHiddenRomIds);
  const [appsLoading, setAppsLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Inicio');
  const [selectedApp, setSelectedApp] = useState<App|null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showControllerTest, setShowControllerTest] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [theme, setTheme] = useState<Theme>('default');
  const [lang, setLang] = useState<Language>('es');
  const [downloadHistory, setDownloadHistory] = useState<DownloadRecord[]>(loadDownloadHistory);
  const [hiddenAppIds, setHiddenAppIds] = useState<number[]>(loadHiddenAppIds);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [selectedRom, setSelectedRom] = useState<{rom:Rom, console:Console} | null>(null);

  const [appSources, setAppSources] = useState<string[]>(() => {
    const saved = localStorage.getItem('appstore-app-sources');
    return saved ? JSON.parse(saved) : [];
  });
  const [romSources, setRomSources] = useState<string[]>(() => {
    const saved = localStorage.getItem('appstore-rom-sources');
    return saved ? JSON.parse(saved) : [];
  });

  const refreshAllSources = useCallback(async () => {
    setAppsLoading(true);
    let allApps: App[] = [];
    let allConsoles: Console[] = [];

    // Load local first
    try {
      const r = await fetch('./apps.json');
      const data = await r.json();
      if (data && data.apps) allApps = [...data.apps];
    } catch(e) { console.error("Error local apps", e); }

    try {
      const r = await fetch('./roms.json');
      const data = await r.json();
      if (data && data.consoles) allConsoles = [...data.consoles];
    } catch(e) { console.error("Error local roms", e); }

    // Load remote app sources
    for (const url of appSources) {
      try {
        const data = await nodeFetch(url);
        if (data && data.apps) {
          allApps = [...allApps, ...data.apps];
        }
      } catch(e) { 
        showToast(`Error cargando fuente: ${url}`, 'error');
      }
    }

    // Load remote rom sources
    for (const url of romSources) {
      try {
        const data = await nodeFetch(url);
        if (data && data.consoles) {
          // Merge consoles by ID
          for (const newConsole of data.consoles) {
            const existingIdx = allConsoles.findIndex(c => c.id === newConsole.id);
            if (existingIdx !== -1) {
              const existing = allConsoles[existingIdx];
              // Merge ROMs and avoid duplicates by ID
              const existingRomIds = new Set((existing.roms || []).map(r => r.id));
              const uniqueNewRoms = (newConsole.roms || []).filter(r => !existingRomIds.has(r.id));
              existing.roms = [...(existing.roms || []), ...uniqueNewRoms];
              existing.romCount = (existing.roms || []).length;
            } else {
              allConsoles.push(newConsole);
            }
          }
        }
      } catch(e) {
        showToast(`Error cargando fuente: ${url}`, 'error');
      }
    }

    setBaseApps(allApps);
    setBaseConsoles(allConsoles);
    setAppsLoading(false);
  }, [appSources, romSources]);

  function togglePauseDownload(id: string) {
    const controller = downloadControllers[id];
    if (controller) {
      if (controller.isPaused) {
        controller.resume();
        showToast('Descarga reanudada', 'success');
      } else {
        controller.pause();
        showToast('Descarga pausada', 'info');
      }
      setActiveDownloads(prev => prev.map(d => d.id === id ? { ...d, isPaused: controller.isPaused, speedBps: controller.isPaused ? 0 : d.speedBps, etaSec: controller.isPaused ? undefined : d.etaSec } : d));
    }
  }

  function cancelDownload(id: string) {
    const controller = downloadControllers[id];
    if (controller) {
      controller.abort();
      setActiveDownloads(prev => prev.filter(d => d.id !== id));
      showToast('Descarga cancelada', 'error');
    }
  }

  const isAdmin = currentUser?.role === 'admin';

  function handleSplashDone() {
    setSplash(false);
    if (!loadUserSession()) setShowAuthModal(true);
  }

  function handleLogin(session: UserSession) {
    setCurrentUser(session);
    setShowAuthModal(false);
    showToast(`¡Bienvenido, ${session.username}! ${session.role === 'admin' ? '(Administrador)' : ''}`, 'success');
  }

  function handleLogout() {
    clearUserSession();
    setCurrentUser(null);
    setShowSettings(false);
    setShowAuthModal(true);
    showToast('Sesión cerrada', 'info');
  }

  function requireAuth() {
    if (!currentUser) { setShowAuthModal(true); return false; }
    return true;
  }

  function refreshHistory() { setDownloadHistory(loadDownloadHistory()); }

  // Sources management
  const addAppSource = (url: string) => {
    if (appSources.includes(url)) return;
    const next = [...appSources, url];
    setAppSources(next);
    localStorage.setItem('appstore-app-sources', JSON.stringify(next));
    showToast('Fuente de aplicaciones añadida', 'success');
  };
  const removeAppSource = (url: string) => {
    const next = appSources.filter(u => u !== url);
    setAppSources(next);
    localStorage.setItem('appstore-app-sources', JSON.stringify(next));
    showToast('Fuente eliminada', 'info');
  };
  const addRomSource = (url: string) => {
    if (romSources.includes(url)) return;
    const next = [...romSources, url];
    setRomSources(next);
    localStorage.setItem('appstore-rom-sources', JSON.stringify(next));
    showToast('Fuente de ROMs añadida', 'success');
  };
  const removeRomSource = (url: string) => {
    const next = romSources.filter(u => u !== url);
    setRomSources(next);
    localStorage.setItem('appstore-rom-sources', JSON.stringify(next));
    showToast('Fuente eliminada', 'info');
  };

  function updateDownloadProgress(id: string, name: string, icon: string, progress: number, size?: string) {
    setActiveDownloads(prev => {
      if (progress < 0) return prev.filter(d => d.id !== id);
      if (progress >= 100) return prev.filter(d => d.id !== id);
      const exists = prev.find(d => d.id === id);
      if (exists) {
        const now = Date.now();
        const isPaused = downloadControllers[id]?.isPaused || false;
        const totalBytes = exists._totalBytes || parseSizeToBytes(size || exists.size || '');
        const lastTs = exists._lastTs || now;
        const lastProg = typeof exists._lastProgress === 'number' ? exists._lastProgress : progress;
        const dt = Math.max(1, now - lastTs);
        const dp = Math.max(0, progress - lastProg);
        let speedBps = exists.speedBps || 0;
        let etaSec = exists.etaSec;
        let spark = Array.isArray(exists.spark) ? exists.spark : [];

        if (!isPaused && totalBytes && dp > 0) {
          const deltaBytes = totalBytes * (dp / 100);
          speedBps = (deltaBytes / dt) * 1000;
          const remainingBytes = totalBytes * ((100 - progress) / 100);
          etaSec = speedBps > 0 ? remainingBytes / speedBps : undefined;
          const level = Math.max(0, Math.min(1, speedBps / (8 * 1024 * 1024)));
          const v = Math.round(6 + level * 22);
          spark = [...spark.slice(-44), v];
        } else if (isPaused) {
          speedBps = 0;
          etaSec = undefined;
        }

        return prev.map(d => d.id === id ? { ...d, progress, size, isPaused, speedBps, etaSec, spark, _lastTs: now, _lastProgress: progress, _totalBytes: totalBytes || undefined } : d);
      }
      const totalBytes = parseSizeToBytes(size || '');
      return [...prev, { id, name, icon, progress, size, isPaused: false, speedBps: 0, spark: [], _lastTs: Date.now(), _lastProgress: progress, _totalBytes: totalBytes || undefined }];
    });
  }

  // All apps = visible base JSON apps + user-created
  const visibleBaseApps = baseApps.filter(a => !hiddenAppIds.includes(a.id));
  const mergedApps = [...visibleBaseApps, ...customApps];

  // Deduplicate by app id to evitar que la lista crezca con duplicados al cambiar categorías
  const apps = Array.from(
    new Map(mergedApps.map(app => [app.id, app])).values()
  );

  // Load base apps and base consoles from sources
  useEffect(() => {
    refreshAllSources();
  }, [refreshAllSources]);

  useEffect(() => {
    if (!isElectron || !(window as any).require) return;
    const { ipcRenderer } = (window as any).require('electron');

    const onStart = (event: any, payload: any) => {
      const id = payload?.id;
      if (!id) return;
      const filename = payload?.filename || 'mod.zip';
      const totalBytes = payload?.totalBytes || 0;
      const savePath = payload?.savePath;
      const sizeStr = totalBytes ? formatBytes(totalBytes) : '';

      downloadControllers[id] = {
        abort: () => ipcRenderer.send('native-download-control', { id, action: 'cancel' }),
        pause: () => { ipcRenderer.send('native-download-control', { id, action: 'pause' }); downloadControllers[id].isPaused = true; },
        resume: () => { ipcRenderer.send('native-download-control', { id, action: 'resume' }); downloadControllers[id].isPaused = false; },
        isPaused: false
      };

      updateDownloadProgress(id, filename, '🔧', 0, sizeStr);
    };

    const onProgress = (event: any, payload: any) => {
      const id = payload?.id;
      if (!id) return;
      const receivedBytes = payload?.receivedBytes || 0;
      const totalBytes = payload?.totalBytes || 0;
      const isPaused = !!payload?.isPaused;
      const filename = payload?.filename || 'mod.zip';
      const progress = totalBytes ? Math.round((receivedBytes / totalBytes) * 1000) / 10 : 0;
      const sizeStr = totalBytes ? formatBytes(totalBytes) : '';

      if (downloadControllers[id]) downloadControllers[id].isPaused = isPaused;
      updateDownloadProgress(id, filename, '🔧', progress, sizeStr);
    };

    const onDone = (event: any, payload: any) => {
      const id = payload?.id;
      if (!id) return;
      const state = payload?.state;
      const filename = payload?.filename || 'mod.zip';
      const totalBytes = payload?.totalBytes || 0;
      const sizeStr = totalBytes ? formatBytes(totalBytes) : '';
      const savePath = payload?.savePath;

      if (state === 'completed') {
        updateDownloadProgress(id, filename, '🔧', 100, sizeStr);
        const rec: DownloadRecord = {
          id,
          name: filename,
          icon: '🔧',
          type: 'mod',
          category: 'Mods',
          size: sizeStr,
          date: new Date().toISOString(),
          filePath: savePath
        };
        saveDownloadRecord(rec);
        refreshHistory();
        showToast('Mod descargado', 'success');
      } else if (state === 'cancelled') {
        updateDownloadProgress(id, filename, '🔧', -1, sizeStr);
        showToast('Descarga cancelada', 'info');
      } else {
        updateDownloadProgress(id, filename, '🔧', -1, sizeStr);
        showToast('Error en descarga de mod', 'error');
      }

      try { delete downloadControllers[id]; } catch {}
    };

    ipcRenderer.on('native-download-start', onStart);
    ipcRenderer.on('native-download-progress', onProgress);
    ipcRenderer.on('native-download-done', onDone);

    return () => {
      ipcRenderer.removeListener('native-download-start', onStart);
      ipcRenderer.removeListener('native-download-progress', onProgress);
      ipcRenderer.removeListener('native-download-done', onDone);
    };
  }, []);

  // Apply theme class to html element
  useEffect(() => {
    const el = document.documentElement;
    el.className = theme==='default'?'':(`theme-${theme}`);
  }, [theme]);

  const filteredApps = apps.filter(app => {
    const ms = search===''||app.name.toLowerCase().includes(search.toLowerCase())||app.description.toLowerCase().includes(search.toLowerCase());
    const mc = activeCategory==='Todos'||activeCategory==='Descargas'||app.category===activeCategory;
    return ms&&mc&&online;
  });

  function selectCat(cat:string){ 
    setActiveCategory(cat); 
    setSelectedApp(null); 
    setSelectedRom(null); // Limpiar ROM seleccionada al cambiar categoría
    setOnline(true);      // Volver a Online al pulsar categorías o apps
    setSearch(''); 
    if(cat==='Descargas') refreshHistory(); 
  }
  function selectApp(app:App){ setSelectedApp(app); if(activeCategory==='Inicio') setActiveCategory('Todos'); }

  function deleteDownloadRecord(id: string) {
    const history = loadDownloadHistory();
    const updated = history.filter(r => r.id !== id);
    localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(updated));
    refreshHistory();
    showToast('Registro eliminado', 'info');
  }

  function openDownloadedFile(filePath?: string) {
    if (!filePath || !shell) {
      showToast('Archivo no disponible', 'error');
      return;
    }
    if (!fs.existsSync(filePath)) {
      showToast('El archivo ya no existe en el disco', 'error');
      return;
    }
    shell.openPath(filePath);
  }

  function showFileLocation(filePath?: string) {
    if (!filePath || !shell) {
      showToast('Ubicación no disponible', 'error');
      return;
    }
    if (!fs.existsSync(filePath)) {
      showToast('El archivo ya no existe en el disco', 'error');
      return;
    }
    shell.showItemInFolder(filePath);
  }

  return (
    <>
      <GlobalStyles />
      {splash && <SplashScreen onDone={handleSplashDone}/>}

      <div style={{ display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',fontFamily:'Inter,system-ui,sans-serif',background:'hsl(var(--background))',color:'hsl(var(--foreground))' }}>
        <Titlebar online={online} onToggle={(isOnline)=>{setOnline(isOnline);setSelectedApp(null);setSelectedRom(null);}} search={search} onSearch={setSearch} onSettings={()=>{ if(currentUser) setShowSettings(true); else setShowAuthModal(true); }} downloadCount={downloadHistory.length} activeCount={activeDownloads.length} onOpenDownloads={()=>{ setActiveCategory('Descargas'); setSelectedApp(null); setSelectedRom(null); refreshHistory(); }}/>
        
        {/* Sub-nav Responsive */}
        <div style={{ background:'hsl(230 28% 9%)',borderBottom:'1px solid hsl(var(--border))',display:'flex',alignItems:'center',height:36,padding:'0 12px',gap:4,flexShrink:0, overflowX:'auto' }}>
          <button className="btn-icon" style={{ fontSize:13, whiteSpace:'nowrap' }} onClick={()=>{setSelectedApp(null);setSelectedRom(null);}}>← Volver</button>
          <div style={{ flex:1 }}/>
          <span style={{ fontSize:12,color:'hsl(var(--muted-foreground))',padding:'0 8px', whiteSpace:'nowrap' }}>{selectedRom?selectedRom.rom.title:selectedApp?selectedApp.name:activeCategory}</span>
        </div>

        <div style={{ display:'flex',flex:1,overflow:'hidden', position:'relative' }}>
          {/* Sidebar con soporte responsive (clase CSS para ocultar en móvil) */}
          <div className="sidebar-container">
            <Sidebar active={activeCategory} onSelect={selectCat}/>
          </div>
          
          <main style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column', width: '100%' }}>
            {appsLoading ? (
              <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'70%',gap:14,color:'hsl(var(--muted-foreground))' }}>
                <span style={{ fontSize:'2.5rem',opacity:.5 }}>📦</span>
                <p style={{ margin:0,fontSize:15 }}>Cargando aplicaciones...</p>
              </div>
            ) : !online ? (
              <div style={{ flex:1,overflowY:'auto',padding:selectedRom?0:24 }}>
                {!selectedRom && (
                  <div style={{ marginBottom:20 }}>
                    <h2 style={{ margin:'0 0 4px',fontSize:'1.3rem',fontWeight:700 }}>Biblioteca</h2>
                    <p style={{ margin:0,fontSize:13,color:'hsl(var(--muted-foreground))' }}>Juegos guardados para acceso rápido</p>
                  </div>
                )}
                
                {selectedRom ? (
                  <RomDetailView 
                    rom={selectedRom.rom} 
                    console={selectedRom.console} 
                    onBack={() => setSelectedRom(null)} 
                    onDownloadSaved={refreshHistory} 
                    onRequireAuth={requireAuth} 
                    onDownloadProgress={updateDownloadProgress}
                  />
                ) : loadLibrary().length === 0 ? (
                  <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'60%',gap:14,color:'hsl(var(--muted-foreground))' }}>
                    <span style={{ fontSize:'3.5rem',opacity:.4 }}>📚</span>
                    <p style={{ margin:0,fontSize:16 }}>Tu biblioteca está vacía</p>
                    <button className="btn-primary" onClick={()=>setOnline(true)}><Icon name="wifi" size={15}/> Ir a Online</button>
                  </div>
                ) : (
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:20 }}>
                    {loadLibrary().map(item => (
                      <LibraryCard 
                        key={item.rom.id} 
                        item={item} 
                        onSelect={(r) => setSelectedRom({rom:r, console:item.console})} 
                        onRemove={() => { removeFromLibrary(item.rom.id); showToast('Eliminado de biblioteca','info'); setOnline(false); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : activeCategory==='Inicio' && !selectedApp ? (
              <HomeSection apps={apps} onSelectApp={selectApp} onSelectCat={selectCat} onOpenSettings={() => setShowSettings(true)}/>
            ) : activeCategory==='Mods' && !selectedApp ? (
              <NexusModsWebView isAdmin={isAdmin} onDownloadProgress={updateDownloadProgress} onDownloadSaved={refreshHistory}/>
            ) : activeCategory==='Juegos Roms' && !selectedApp ? (
              <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}><JuegosRomsSection baseConsoles={baseConsoles} customConsoles={customConsoles} romOverrides={romOverrides} extraRoms={extraRoms} hiddenRomIds={hiddenRomIds} onDownloadSaved={refreshHistory} onRequireAuth={requireAuth} onDownloadProgress={updateDownloadProgress}/></div>
            ) : activeCategory==='Descargas' && !selectedApp ? (
              <div style={{ flex:1,overflowY:'auto',padding:24 }}>
                <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20 }}>
                  <div>
                    <h2 style={{ margin:'0 0 4px',fontSize:'1.3rem',fontWeight:700 }}>Historial de Descargas</h2>
                    <p style={{ margin:0,fontSize:13,color:'hsl(var(--muted-foreground))' }}>{downloadHistory.length} descarga{downloadHistory.length!==1?'s':''} registrada{downloadHistory.length!==1?'s':''}</p>
                  </div>
                  {downloadHistory.length>0&&<button className="btn-primary" style={{ fontSize:12,padding:'6px 14px' }} onClick={()=>{ localStorage.removeItem(DOWNLOAD_HISTORY_KEY); refreshHistory(); showToast('Historial borrado','info'); }}>Limpiar historial</button>}
                </div>

                {/* Active Downloads */}
                {activeDownloads.length > 0 && (
                  (() => {
                    const current = activeDownloads[0];
                    const queue = activeDownloads.slice(1);
                    const totalBytes = parseSizeToBytes(current.size || '') || current._totalBytes || 0;
                    const downloadedBytes = totalBytes ? Math.round(totalBytes * (current.progress / 100)) : 0;
                    const downloadedStr = totalBytes ? `${(downloadedBytes / (1024 ** 3)).toFixed(2)} GB` : '—';
                    const totalStr = totalBytes ? `${(totalBytes / (1024 ** 3)).toFixed(2)} GB` : (current.size || '—');
                    const spark = Array.isArray(current.spark) && current.spark.length > 0 ? current.spark : new Array(36).fill(8);

                    return (
                      <div style={{ marginBottom:28 }}>
                        <div style={{ borderRadius:'1.25rem', overflow:'hidden', border:'1px solid rgba(255,255,255,.10)', background:'linear-gradient(145deg, rgba(255,255,255,.06), rgba(255,255,255,.02))', boxShadow:'0 20px 60px rgba(0,0,0,.35)' }}>
                          <div style={{ padding:'18px 18px 14px', position:'relative' }}>
                            <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 20% 10%, hsl(var(--primary)/.25), transparent 55%), radial-gradient(circle at 70% 0%, rgba(232,105,42,.18), transparent 50%)', pointerEvents:'none' }}/>
                            <div style={{ display:'flex', alignItems:'center', gap:16, position:'relative' }}>
                              <div style={{ width:86, height:86, borderRadius:'1.1rem', overflow:'hidden', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                              <DownloadIcon name={current.name} category={''} initialIcon={current.icon} type={current.id.startsWith('rom-') ? 'rom' : current.id.startsWith('mod-') ? 'mod' : 'app'} />
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontWeight:900, fontSize:18, letterSpacing:'-.01em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{current.name}</div>
                                <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:6, color:'rgba(255,255,255,.55)', fontSize:12 }}>
                                  <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:'999px', border:'1px solid rgba(255,255,255,.10)', background:'rgba(0,0,0,.18)' }}>
                                    <Icon name="download" size={13}/> {downloadedStr} / {totalStr}
                                  </span>
                                  <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:'999px', border:'1px solid rgba(255,255,255,.10)', background:'rgba(0,0,0,.18)' }}>
                                    <Icon name="wifi" size={13}/> {current.isPaused ? 'Pausado' : formatSpeed(current.speedBps)}
                                  </span>
                                  <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:'999px', border:'1px solid rgba(255,255,255,.10)', background:'rgba(0,0,0,.18)' }}>
                                    <Icon name="clock" size={13}/> {current.isPaused ? '—' : formatEta(current.etaSec)}
                                  </span>
                                </div>
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <div style={{ textAlign:'right', paddingRight:10, borderRight:'1px solid rgba(255,255,255,.10)' }}>
                                  <div style={{ fontWeight:950, fontSize:22, color:'hsl(var(--primary))' }}>{current.progress.toFixed(1)}%</div>
                                  <div style={{ fontSize:11, color:'rgba(255,255,255,.45)' }}>Descargando</div>
                                </div>
                                <button onClick={() => togglePauseDownload(current.id)} style={{ padding:'10px 14px', borderRadius:'999px', border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.9)', cursor:'pointer', display:'flex', alignItems:'center', gap:8, fontFamily:'inherit', fontWeight:800, fontSize:12 }}>
                                  <Icon name={current.isPaused ? 'play' : 'refresh'} size={14}/> {current.isPaused ? 'Reanudar' : 'Pausar'}
                                </button>
                                <button onClick={() => cancelDownload(current.id)} style={{ padding:'10px 14px', borderRadius:'999px', border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.10)', color:'#ef4444', cursor:'pointer', display:'flex', alignItems:'center', gap:8, fontFamily:'inherit', fontWeight:800, fontSize:12 }}>
                                  <Icon name="x" size={14}/> Cancelar
                                </button>
                              </div>
                            </div>
                            <div style={{ marginTop:14, display:'flex', alignItems:'center', gap:14, position:'relative' }}>
                              <div style={{ flex:1 }}>
                                <ProgressBar value={current.progress} color={current.isPaused ? 'rgba(255,255,255,.25)' : 'hsl(var(--primary))'} />
                              </div>
                            </div>
                          </div>

                          <div style={{ padding:'10px 18px 16px', borderTop:'1px solid rgba(255,255,255,.06)', background:'rgba(0,0,0,.12)' }}>
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                              <div style={{ fontSize:12, fontWeight:800, color:'rgba(255,255,255,.7)', letterSpacing:'.06em', textTransform:'uppercase' }}>Actividad</div>
                              <div style={{ fontSize:12, color:'rgba(255,255,255,.45)' }}>{current.isPaused ? 'En pausa' : 'Red'}</div>
                            </div>
                            <div style={{ height:54, borderRadius:12, border:'1px solid rgba(255,255,255,.08)', background:'rgba(255,255,255,.03)', display:'flex', alignItems:'flex-end', gap:3, padding:'8px 10px', overflow:'hidden' }}>
                              {spark.slice(-46).map((h, i) => (
                                <div key={i} style={{ width:3, height:h, borderRadius:3, background:i===spark.length-1 ? 'hsl(var(--primary))' : 'rgba(255,255,255,.22)' }} />
                              ))}
                            </div>
                          </div>
                        </div>

                        {queue.length > 0 && (
                          <div style={{ marginTop:18 }}>
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                              <div style={{ fontSize:12, fontWeight:800, color:'rgba(255,255,255,.55)', letterSpacing:'.06em', textTransform:'uppercase' }}>Descargas en cola</div>
                              <div style={{ fontSize:12, color:'rgba(255,255,255,.45)' }}>{queue.length} en cola</div>
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                              {queue.map(dl => (
                                <div key={dl.id} style={{ background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.08)', borderRadius:'1rem', padding:'12px 14px', display:'flex', alignItems:'center', gap:12 }}>
                                  <div style={{ width:48, height:48, borderRadius:14, overflow:'hidden', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.10)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    <DownloadIcon name={dl.name} category={''} initialIcon={dl.icon} type={dl.id.startsWith('rom-') ? 'rom' : dl.id.startsWith('mod-') ? 'mod' : 'app'} />
                                  </div>
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontWeight:800, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dl.name}</div>
                                    <div style={{ marginTop:6 }}>
                                      <ProgressBar value={dl.progress} color={dl.isPaused ? 'rgba(255,255,255,.25)' : 'hsl(var(--primary))'} />
                                    </div>
                                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:12, color:'rgba(255,255,255,.45)' }}>
                                      <span>{dl.size || '—'} {dl.isPaused ? '(Pausado)' : ''}</span>
                                      <span style={{ fontWeight:900, color:'rgba(255,255,255,.7)' }}>{dl.progress.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                  <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                                    <button onClick={() => togglePauseDownload(dl.id)} style={{ width:34, height:34, borderRadius:'50%', border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.85)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }} title={dl.isPaused ? 'Reanudar' : 'Pausar'}>
                                      <Icon name={dl.isPaused ? 'play' : 'refresh'} size={14}/>
                                    </button>
                                    <button onClick={() => cancelDownload(dl.id)} style={{ width:34, height:34, borderRadius:'50%', border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.10)', color:'#ef4444', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }} title="Cancelar">
                                      <Icon name="x" size={14}/>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}

                {downloadHistory.length===0 && activeDownloads.length===0 ? (
                  <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:240,color:'hsl(var(--muted-foreground))',gap:12 }}>
                    <span style={{ fontSize:'3.5rem',opacity:.4 }}>📥</span>
                    <p style={{ margin:0,fontSize:15 }}>No hay descargas aún</p>
                    <p style={{ margin:0,fontSize:13,opacity:.6 }}>Las descargas que hagas aparecerán aquí</p>
                  </div>
                ) : (
                  <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                    {downloadHistory.map((rec,i)=>{
                      const dt = new Date(rec.date);
                      const dateStr = dt.toLocaleDateString('es-ES',{ day:'2-digit',month:'short',year:'numeric' });
                      const timeStr = dt.toLocaleTimeString('es-ES',{ hour:'2-digit',minute:'2-digit' });
                      return (
                        <div key={`${rec.id}-${i}`} style={{ background:'hsl(var(--card))',border:'1px solid hsl(var(--border))',borderRadius:'1rem',padding:'14px 18px',display:'flex',alignItems:'center',gap:16 }}>
                          <div style={{ width:52,height:52,borderRadius:'.75rem',background:'hsl(var(--muted))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',flexShrink:0,overflow:'hidden' }}>
                            <DownloadIcon name={rec.name} category={rec.category} initialIcon={rec.icon} type={rec.type} />
                          </div>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontWeight:600,fontSize:15,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{rec.name}</div>
                            <div style={{ display:'flex',gap:10,fontSize:12,color:'hsl(var(--muted-foreground))' }}>
                                      <span style={{ background:'hsl(var(--muted))',padding:'1px 8px',borderRadius:20 }}>{rec.type==='rom'?'ROM':rec.type==='mod'?'MOD':'App'}</span>
                              <span>{rec.category}</span>
                              <span>{rec.size}</span>
                            </div>
                            <div style={{ display:'flex', gap:8, marginTop:10 }}>
                              <button 
                                className="btn-primary" 
                                style={{ fontSize:11, padding:'4px 12px', height:28, opacity: (rec.filePath && fs && fs.existsSync(rec.filePath)) ? 1 : 0.5 }} 
                                onClick={() => openDownloadedFile(rec.filePath)}
                              >
                                <Icon name="play" size={12}/> Abrir
                              </button>
                              <button 
                                className="btn-secondary" 
                                style={{ fontSize:11, padding:'4px 12px', height:28, opacity: (rec.filePath && fs && fs.existsSync(rec.filePath)) ? 1 : 0.5 }} 
                                onClick={() => showFileLocation(rec.filePath)}
                              >
                                <Icon name="folder" size={12}/> Ubicación
                              </button>
                              <button 
                                className="btn-secondary" 
                                style={{ fontSize:11, padding:'4px 12px', height:28, color:'#ef4444', borderColor:'#ef444433' }} 
                                onClick={() => deleteDownloadRecord(rec.id)}
                              >
                                <Icon name="x" size={12}/> Borrar
                              </button>
                            </div>
                          </div>
                          <div style={{ textAlign:'right',flexShrink:0,color:'hsl(var(--muted-foreground))',fontSize:12 }}>
                            <div style={{ fontWeight:500,marginBottom:2 }}>{dateStr}</div>
                            <div style={{ opacity:.7 }}>{timeStr}</div>
                          </div>
                          <div style={{ color:'#22c55e',flexShrink:0 }}><Icon name="check" size={18}/></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : selectedApp ? (
              <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}><AppDetailView app={selectedApp} onBack={()=>setSelectedApp(null)} onDownloadSaved={refreshHistory} onRequireAuth={requireAuth} onDownloadProgress={updateDownloadProgress}/></div>
            ) : (
              <div style={{ flex:1,overflowY:'auto',padding:24 }}>
                <div className="apps-grid">
                  {filteredApps.length===0 ? (
                    <div style={{ gridColumn:'1/-1',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:200,color:'hsl(var(--muted-foreground))',gap:10 }}>
                      <span style={{ fontSize:'3rem' }}>🔍</span><p style={{ margin:0 }}>No se encontraron aplicaciones</p>
                    </div>
                  ) : filteredApps.map(app=><AppCard key={app.id} app={app} onClick={()=>setSelectedApp(app)}/>)}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

{showSettings && currentUser && <SettingsPanel
  theme={theme}
  onTheme={t=>{ setTheme(t); showToast(`Tema cambiado a ${THEMES.find(x=>x.id===t)?.label||t}`,'success'); }}
  lang={lang}
  onLang={l=>{ setLang(l); showToast(`Idioma: ${l==='es'?'Español':'English'}`,'success'); }}
  onClose={()=>setShowSettings(false)}
  onAdmin={()=>{ setShowSettings(false); setShowAdmin(true); }}
  onDev={()=>{ 
  setShowSettings(false);
  const { ipcRenderer } = (window as any).require('electron');
  ipcRenderer.send('open-devtools');
}}
  onControllerTest={() => { setShowSettings(false); setShowControllerTest(true); }}
  isAdmin={isAdmin}
  currentUser={currentUser}
  onLogout={handleLogout}
  onOpenSources={() => { setShowSettings(false); setShowSources(true); }}
/>}      {showAdmin && <AdminPanel baseApps={baseApps} customApps={customApps} hiddenAppIds={hiddenAppIds} customConsoles={customConsoles} baseConsoles={baseConsoles||[]} extraRoms={extraRoms} hiddenRomIds={hiddenRomIds} onUpdateApps={updated=>{setCustomApps(updated);}} onUpdateHiddenApps={ids=>{setHiddenAppIds(ids);}} onUpdateConsoles={updated=>{setCustomConsoles(updated);}} onUpdateRomOverrides={overrides=>{setRomOverrides(overrides);}} onUpdateExtraRoms={updated=>{setExtraRoms(updated);}} onUpdateHiddenRoms={ids=>{setHiddenRomIds(ids);}} onClose={()=>setShowAdmin(false)}/>}
      {showControllerTest && <ControllerTestModal onClose={() => setShowControllerTest(false)} />}
      {showSources && <SourcesPanel 
        appSources={appSources} 
        romSources={romSources} 
        onAddAppSource={addAppSource} 
        onRemoveAppSource={removeAppSource} 
        onAddRomSource={addRomSource} 
        onRemoveRomSource={removeRomSource} 
        onRefresh={refreshAllSources} 
        onClose={() => setShowSources(false)} 
      />}
      {showAuthModal && <AuthPanel onLogin={handleLogin} onClose={()=>setShowAuthModal(false)}/>}
      <ToastContainer/>
    </>
  );
}
