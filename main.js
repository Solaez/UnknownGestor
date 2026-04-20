import { app, BrowserWindow, Menu, ipcMain, shell, WebContentsView, dialog } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { nexusCustomStyles, gamebananaCustomStyles } from "./src/data/mods.js";
import https from "https";
import http from "http";

// Necesario porque usas "type": "module" en package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  Menu.setApplicationMenu(null);

  // DETECTAR SI ESTAMOS EN DESARROLLO O PRODUCCIÓN
  // app.isPackaged es true cuando ejecutas el binario compilado
  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
  } else {
    // En producción cargamos el archivo que generó 'vite build'
    win.loadFile(path.join(__dirname, "dist/index.html"));
  }

  ipcMain.on("open-devtools", () => {
    win.webContents.openDevTools();
  });

  ipcMain.on("window-minimize", () => {
    win.minimize();
  });

  ipcMain.on("window-maximize", () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on("window-close", () => {
    win.close();
  });

  // ─── GESTOR DE NEXUS MODS (WebContentsView) ──────────────────────────────────
  let nexusView = null;

  ipcMain.on("nexus-view-toggle", (event, { show, bounds }) => {
    if (show) {
      if (!nexusView) {
        nexusView = new WebContentsView({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          }
        });
        win.contentView.addChildView(nexusView);
        nexusView.webContents.loadURL('https://www.nexusmods.com/mods?sort=endorsements');
        
        // Bloquear anuncios y pop-ups en el view
        nexusView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        
        // Muted audio
        nexusView.webContents.setAudioMuted(true);

        const injectStyles = () => {
          const url = nexusView.webContents.getURL();
          if (url.includes('nexusmods.com')) {
            nexusView.webContents.insertCSS(nexusCustomStyles);
          } else if (url.includes('gamebanana.com')) {
            nexusView.webContents.insertCSS(gamebananaCustomStyles);
          }
        };

        // Inyectar CSS de forma inmediata al navegar, sin esperar al finish-load
        nexusView.webContents.on('did-navigate', injectStyles);

        // Refuerzo: inyectar también cuando el DOM está listo
        nexusView.webContents.on('dom-ready', injectStyles);

        nexusView.webContents.loadURL('https://www.nexusmods.com/mods?sort=endorsements');
      }
      
      if (bounds) {
        nexusView.setBounds(bounds);
      }
    } else {
      if (nexusView) {
        win.contentView.removeChildView(nexusView);
        nexusView.webContents.destroy();
        nexusView = null;
      }
    }
  });

  ipcMain.on("nexus-view-resize", (event, bounds) => {
    if (nexusView && bounds) {
      nexusView.setBounds(bounds);
    }
  });

  ipcMain.on("nexus-view-navigate", (event, url) => {
    if (nexusView) {
      nexusView.webContents.loadURL(url);
    }
  });

  ipcMain.on("nexus-view-devtools", () => {
    if (nexusView && nexusView.webContents) {
      nexusView.webContents.openDevTools({ mode: 'detach' });
    }
  });

  ipcMain.on("select-download-folder", async (event) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      event.reply("selected-download-folder", result.filePaths[0]);
    }
  });

  ipcMain.on("open-external", (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.on("download-window", (event, url) => {
    const dlWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: "Resolviendo Descarga",
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
        popupBlocking: true,
      },
    });

    dlWin.loadURL(url);
    dlWin.webContents.setAudioMuted(true);

    // Bloquear anuncios y pop-ups (MODO STEALTH)
    dlWin.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
    dlWin.webContents.on('new-window', (e) => e.preventDefault());

    dlWin.webContents.on("will-navigate", (e, targetUrl) => {
      if (targetUrl.includes(".1fichier.com/dl/") || targetUrl.includes("1fichier.com/dl/")) {
        e.preventDefault();
        event.reply("resolved-1fichier", targetUrl);
        dlWin.close();
      }
    });

    dlWin.webContents.session.once("will-download", (e, item) => {
      const downloadUrl = item.getURL();
      e.preventDefault();
      event.reply("resolved-1fichier", downloadUrl);
      dlWin.close();
    });
  });

  ipcMain.on("trigger-native-download", (event, url) => {
    if (!url) return;
    try {
      // Codificar espacios y caracteres especiales para evitar errores en Node/Electron
      const encodedUrl = url.replace(/ /g, '%20');
      win.webContents.downloadURL(encodedUrl);
    } catch (e) {
      console.error("Error al iniciar descarga nativa:", e);
    }
  });

  // ─── GESTOR DE TORRENTS (WEBTORRENT) ────────────────────────────────────────
  let torrentClient = null;
  const activeTorrents = new Map();

  ipcMain.on("start-torrent", async (event, { magnet, downloadId }) => {
    try {
      if (!torrentClient) {
        const WebTorrent = (await import('webtorrent')).default;
        torrentClient = new WebTorrent();
      }

      const downloadsPath = path.join(os.homedir(), 'Downloads');
      if (!fs.existsSync(downloadsPath)) {
        fs.mkdirSync(downloadsPath, { recursive: true });
      }

      torrentClient.add(magnet, { path: downloadsPath }, (torrent) => {
        activeTorrents.set(downloadId, torrent);

        torrent.on('download', () => {
          const progress = Number((torrent.progress * 100).toFixed(1));
          event.reply("torrent-progress", { 
            downloadId, 
            progress, 
            speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + " MB/s",
            name: torrent.name 
          });
        });

        torrent.on('done', () => {
          event.reply("torrent-done", { 
            downloadId, 
            path: path.join(downloadsPath, torrent.name),
            name: torrent.name 
          });
          activeTorrents.delete(downloadId);
        });

        torrent.on('error', (err) => {
          event.reply("torrent-error", { downloadId, error: err.message });
          activeTorrents.delete(downloadId);
        });
      });
    } catch (err) {
      event.reply("torrent-error", { downloadId, error: err.message });
    }
  });

  ipcMain.on("cancel-torrent", (event, { downloadId }) => {
    const torrent = activeTorrents.get(downloadId);
    if (torrent) {
      torrent.destroy();
      activeTorrents.delete(downloadId);
    }
  });


  ipcMain.on("resolve-romsfun", (event, url) => {
    const dlWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: "Resolviendo Descarga - RomsFun",
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
        popupBlocking: true,
      },
    });

    let finished = false;
    const finish = async (resolvedUrl) => {
      if (finished) return;
      finished = true;
      
      let cookiesStr = "";
      const userAgent = dlWin.webContents.getUserAgent();
      try {
        const cookies = await dlWin.webContents.session.cookies.get({ url: resolvedUrl || url });
        cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      } catch (e) {
        console.error("Error capturando cookies:", e);
      }

      event.reply("resolved-romsfun", { 
        url: resolvedUrl || "", 
        cookies: cookiesStr,
        userAgent: userAgent
      });
      dlWin.close();
    };

    const timeout = setTimeout(() => finish(""), 45000);
    dlWin.on("closed", () => clearTimeout(timeout));

    dlWin.loadURL(url);
    dlWin.webContents.setAudioMuted(true);

    // Bloquear anuncios y pop-ups (MODO STEALTH)
    dlWin.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
    dlWin.webContents.on('new-window', (e) => e.preventDefault());

    dlWin.webContents.session.once("will-download", (e, item) => {
      e.preventDefault();
      finish(item.getURL());
    });

    dlWin.webContents.on("will-navigate", (e, targetUrl) => {
      if (targetUrl.includes("sto.romsfast.com") || targetUrl.includes("romsfast.com")) {
        e.preventDefault();
        finish(targetUrl);
      }
    });

    dlWin.webContents.on("did-finish-load", async () => {
      if (finished) return;
      try {
        const href = await dlWin.webContents.executeJavaScript(
          `new Promise((resolve)=>{
            let attempts = 0;
            const maxAttempts = 30; // 30 * 1000ms = 30s max wait
            const checkInterval = setInterval(() => {
              attempts++;
              try {
                const a = document.getElementById('download-link');
                if (a && a.href && (a.href.includes('romsfast') || a.href.includes('sto.romsfast'))) {
                  clearInterval(checkInterval);
                  resolve(a.href);
                  return;
                }
                if (a && attempts > 8) { // Click after 8s even if href not ready
                  try { a.click(); } catch(e) {}
                }
              } catch(e) {}
              
              if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                resolve('');
              }
            }, 1000);
          })`,
          true
        );
        if (href && typeof href === "string") {
          finish(href);
        }
      } catch {
        finish("");
      }
    });
  });

  ipcMain.on("resolve-nswpedia", (event, url) => {
    const dlWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: "Resolviendo Descarga - NswPedia",
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
        popupBlocking: true,
      },
    });

    let finished = false;
    const finish = async (resolvedUrl) => {
      if (finished) return;
      finished = true;
      
      let cookiesStr = "";
      const userAgent = dlWin.webContents.getUserAgent();
      try {
        const cookies = await dlWin.webContents.session.cookies.get({ url: resolvedUrl || url });
        cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      } catch (e) {
        console.error("Error capturando cookies:", e);
      }

      event.reply("resolved-nswpedia", { 
        url: resolvedUrl || "", 
        cookies: cookiesStr,
        userAgent: userAgent
      });
      dlWin.close();
    };

    const timeout = setTimeout(() => finish(""), 45000);
    dlWin.on("closed", () => clearTimeout(timeout));

    dlWin.loadURL(url);
    dlWin.webContents.setAudioMuted(true);

    // Bloquear anuncios y pop-ups (MODO STEALTH)
    dlWin.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
    dlWin.webContents.on('new-window', (e) => e.preventDefault());

    dlWin.webContents.session.once("will-download", (e, item) => {
      e.preventDefault();
      finish(item.getURL());
    });

    dlWin.webContents.on("will-navigate", (e, targetUrl) => {
      if (targetUrl.includes("download.nswpediax.site")) {
        e.preventDefault();
        finish(targetUrl);
      }
    });

    dlWin.webContents.on("did-finish-load", async () => {
      if (finished) return;
      try {
        const href = await dlWin.webContents.executeJavaScript(
          `new Promise((resolve)=>{
            let attempts = 0;
            const maxAttempts = 30; // 30 * 1000ms = 30s max wait
            const checkInterval = setInterval(() => {
              attempts++;
              try {
                const a = document.getElementById('download-link');
                if (a && a.href && a.href.includes('download.nswpediax.site')) {
                  clearInterval(checkInterval);
                  resolve(a.href);
                  return;
                }
                if (a && attempts > 12) { // Click after 12s as requested
                  try { a.click(); } catch(e) {}
                }
              } catch(e) {}
              
              if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                resolve('');
              }
            }, 1000);
          })`,
          true
        );
        if (href && typeof href === "string") {
          finish(href);
        }
      } catch {
        finish("");
      }
    });
  });

  ipcMain.on("resolve-mediafire", (event, url) => {
    const dlWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: "Resolviendo Descarga - MediaFire",
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
        popupBlocking: true,
      },
    });

    let finished = false;
    const finish = (resolvedUrl) => {
      if (finished) return;
      finished = true;
      event.reply("resolved-mediafire", resolvedUrl || "");
      dlWin.close();
    };

    const timeout = setTimeout(() => finish(""), 20000);
    dlWin.on("closed", () => clearTimeout(timeout));

    dlWin.loadURL(url);
    dlWin.webContents.setAudioMuted(true);

    // Bloquear anuncios y pop-ups (MODO STEALTH)
    dlWin.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
    dlWin.webContents.on('new-window', (e) => e.preventDefault());

    dlWin.webContents.session.once("will-download", (e, item) => {
      const downloadUrl = item.getURL();
      e.preventDefault();
      finish(downloadUrl);
    });

    dlWin.webContents.on("did-finish-load", async () => {
      if (finished) return;
      try {
        const href = await dlWin.webContents.executeJavaScript(`
          new Promise((resolve) => {
            setTimeout(() => {
              try {
                const btn = document.getElementById('downloadButton');
                if (btn) {
                  const link = btn.href;
                  btn.click();
                  resolve(link || '');
                } else {
                  resolve('');
                }
              } catch (e) {
                resolve('');
              }
            }, 2000);
          })
        `, true);
        if (href && typeof href === "string" && href.includes('download')) {
          finish(href);
        }
      } catch (e) {
        console.error("Error executing JS in MediaFire:", e);
      }
    });
  });

  ipcMain.on("launch-emulator", (event, { filePath, romTitle, emulatorPath }) => {
    if (!filePath) return;
    
    let fullPath = filePath;
    if (!path.isAbsolute(filePath)) {
      fullPath = path.join(os.homedir(), "Downloads", filePath);
    }

    if (!fs.existsSync(fullPath)) {
      event.reply("launch-error", { message: "El archivo ROM no existe en la ruta especificada." });
      return;
    }

    if (emulatorPath && fs.existsSync(emulatorPath)) {
      // Lanzar con el emulador seleccionado
      const child = spawn(emulatorPath, [fullPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } else {
      // Lanzar con la aplicación predeterminada del sistema
      shell.openPath(fullPath).then((err) => {
        if (err) {
          console.error("Error al abrir ROM:", err);
          event.reply("launch-error", { message: `No se pudo abrir el juego: ${err}` });
        }
      });
    }
  });

  // ─── SCRIPT RUNNER (BAT/SH) ──────────────────────────────────────────────────
  let activeScriptProcess = null;

  ipcMain.on("run-script", (event, { url, filename, scriptType }) => {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }
    const filePath = path.join(downloadsPath, filename);

    // Download the script first
    const httpModule = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filePath);
    
    httpModule.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          event.reply("script-status", { status: 'downloaded', path: filePath });
          
          // Execute the script
          let cmd, args;
          if (process.platform === 'win32') {
            cmd = 'cmd.exe';
            args = ['/c', filePath];
          } else {
            cmd = 'bash';
            args = [filePath];
          }

          if (activeScriptProcess) {
            try { activeScriptProcess.kill(); } catch {}
          }

          activeScriptProcess = spawn(cmd, args, {
            cwd: downloadsPath,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
          });

          event.reply("script-status", { status: 'running', pid: activeScriptProcess.pid });

          activeScriptProcess.stdout.on('data', (data) => {
            event.reply("script-output", { output: data.toString(), type: 'stdout' });
          });

          activeScriptProcess.stderr.on('data', (data) => {
            event.reply("script-output", { output: data.toString(), type: 'stderr' });
          });

          activeScriptProcess.on('close', (code) => {
            event.reply("script-status", { status: 'done', exitCode: code });
            activeScriptProcess = null;
          });

          activeScriptProcess.on('error', (err) => {
            event.reply("script-status", { status: 'error', error: err.message });
            activeScriptProcess = null;
          });

        });
      } else {
        event.reply("script-status", { status: 'error', error: `HTTP ${response.statusCode}` });
      }
    }).on('error', (err) => {
      event.reply("script-status", { status: 'error', error: err.message });
    });
  });

  ipcMain.on("kill-script", () => {
    if (activeScriptProcess) {
      try { activeScriptProcess.kill(); } catch {}
      activeScriptProcess = null;
    }
  });

  const nativeDownloads = new Map();

  ipcMain.on("native-download-control", (event, payload) => {
    const id = payload?.id;
    const action = payload?.action;
    if (!id || !action) return;
    const item = nativeDownloads.get(id);
    if (!item) return;
    try {
      if (action === "pause" && typeof item.pause === "function") item.pause();
      if (action === "resume" && typeof item.resume === "function") item.resume();
      if (action === "cancel" && typeof item.cancel === "function") item.cancel();
    } catch {}
  });

  win.webContents.session.on("will-download", (event, item) => {
    try {
      const filename = typeof item.getFilename === "function" ? item.getFilename() : `download-${Date.now()}`;
      const totalBytes = typeof item.getTotalBytes === "function" ? item.getTotalBytes() : 0;
      const url = typeof item.getURL === "function" ? item.getURL() : "";
      const id = `mod-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const downloadsDir = path.join(os.homedir(), "Downloads");
      try { fs.mkdirSync(downloadsDir, { recursive: true }); } catch {}
      const savePath = path.join(downloadsDir, filename);
      try { if (typeof item.setSavePath === "function") item.setSavePath(savePath); } catch {}

      nativeDownloads.set(id, item);

      try {
        win.webContents.send("native-download-start", { id, filename, totalBytes, url, savePath });
      } catch {}

      const sendProgress = () => {
        try {
          const receivedBytes = typeof item.getReceivedBytes === "function" ? item.getReceivedBytes() : 0;
          const isPaused = typeof item.isPaused === "function" ? item.isPaused() : false;
          win.webContents.send("native-download-progress", { id, receivedBytes, totalBytes, isPaused, filename });
        } catch {}
      };

      try { if (typeof item.on === "function") item.on("updated", sendProgress); } catch {}

      try {
        if (typeof item.once === "function") {
          item.once("done", (e, state) => {
            try {
              nativeDownloads.delete(id);
              win.webContents.send("native-download-done", { id, state, filename, totalBytes, savePath });
            } catch {}
          });
        }
      } catch {}
    } catch {}
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
