/*import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
  },
});
*/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: './', // <--- ESTA LÍNEA ES LA QUE HACE QUE RECONOZCA LOS .JSON EN PRODUCCIÓN
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    assetsDir: "assets", // Organiza los archivos JS/CSS en una carpeta
    emptyOutDir: true,   // Limpia la carpeta dist antes de compilar
  },
});
