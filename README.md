# Pahtlikalli - App de Fichas de Terreno

PWA offline para inspeccionar terrenos de ecoaldea con fotos y GPS.

## Probar en Linux Mint (VSCodium)

1. Abre la carpeta `pahtlikalli-app` en VSCodium.
2. Instala la extensión **Live Server** (Ritwick Dey).
3. Click derecho en `index.html` → **Open with Live Server**.
4. Se abre en `http://127.0.0.1:5500`. Prueba ahí.

> ⚠️ No abras `index.html` con doble clic (file://). El service worker y el fetch del JSON fallan.

## Pasar a la tablet Android

### Opción A — Servidor local rápido (misma red WiFi)
En tu Linux:
```bash
cd pahtlikalli-app
python3 -m http.server 8000