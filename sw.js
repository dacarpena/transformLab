/* eslint-env serviceworker */

/**
 * Service worker de TransformLab (M6-1), escrito a mano.
 *
 * Reglas que lo gobiernan:
 *
 * 1. **Nunca toca datos del usuario.** Aquí solo entran los estáticos de la
 *    aplicación. Los check-ins viven en localStorage y las fotos en IndexedDB;
 *    ninguna de las dos cosas pasa por aquí ni por la red.
 * 2. **Nunca recarga solo.** Un SW nuevo se queda esperando; la página avisa
 *    («hay una versión nueva») y recarga el usuario. Recargar por sorpresa a
 *    alguien que está escribiendo un check-in es perder su trabajo.
 * 3. **Cache-first para lo propio.** Todo está precacheado, así que la app
 *    abre entera sin red desde la segunda visita. Al cambiar CACHE_VERSION se
 *    descarta el caché anterior completo: nada de mezclar versiones de
 *    módulos, que es como se producen los estados imposibles.
 *
 * Al tocar cualquier fichero de PRECACHE hay que subir CACHE_VERSION.
 */

const CACHE_VERSION = 'tl-v5-0002';

/**
 * Todo lo que la aplicación necesita para arrancar. Sin bundler, cada módulo
 * es una petición propia: si falta uno, la app no arranca offline. La lista
 * se comprueba en `test/pwa.test.js` contra el árbol real.
 */
const PRECACHE = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/tokens.css',
    'css/app.css',
    'vendor/chart.umd.min.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'src/main.js',
    'src/core/achievements.js',
    'src/core/constants.js',
    'src/core/data/aesthetic-catalog.json',
    'src/core/engine.js',
    'src/core/generator.js',
    'src/core/milestones.js',
    'src/core/nutrition.js',
    'src/core/ranges.js',
    'src/core/rng.js',
    'src/core/silhouette.js',
    'src/core/tracking.js',
    'src/core/training.js',
    'src/data/backup.js',
    'src/data/checkins.js',
    'src/data/migrate.js',
    'src/data/photos-db.js',
    'src/data/profiles.js',
    'src/data/schema.js',
    'src/data/storage.js',
    'src/i18n/en.js',
    'src/i18n/es.js',
    'src/i18n/i18n.js',
    'src/ui/chart.js',
    'src/ui/dom.js',
    'src/ui/plan-state.js',
    'src/ui/pwa.js',
    'src/ui/reminder.js',
    'src/ui/recalibrate.js',
    'src/ui/router.js',
    'src/ui/components/modal.js',
    'src/ui/components/state.js',
    'src/ui/components/toast.js',
    'src/ui/views/achievements.js',
    'src/ui/views/body.js',
    'src/ui/views/checkin.js',
    'src/ui/views/dashboard.js',
    'src/ui/views/milestones.js',
    'src/ui/views/nutrition.js',
    'src/ui/views/onboarding.js',
    'src/ui/views/photos.js',
    'src/ui/views/progress.js',
    'src/ui/views/settings.js',
    'src/ui/views/training.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // `reload` evita precachear lo que el caché HTTP ya tenía viejo.
        await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
        // NO se llama a skipWaiting: el SW nuevo espera a que el usuario
        // recargue. Lo activa `SKIP_WAITING`, que manda la página tras avisar.
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith('tl-') && name !== CACHE_VERSION)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

/** Mensajes desde la página: solo uno, y solo tras decisión del usuario. */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Solo se sirve lo del propio origen. Cualquier otra cosa se deja pasar
    // sin tocarla: este SW no es un proxy de nada ajeno.
    if (url.origin !== self.location.origin) return;

    // Navegación: se responde con el shell cacheado. Es una SPA, así que
    // cualquier ruta se resuelve en el mismo documento.
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const cached = await caches.match('index.html');
            if (cached) return cached;
            try {
                return await fetch(request);
            } catch {
                // Sin red y sin caché: es la primera visita y no hay nada que
                // hacer. Se devuelve una respuesta honesta, no una en blanco.
                return new Response('', { status: 503, statusText: 'offline' });
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        try {
            const response = await fetch(request);
            // Solo se guarda lo que salió bien y es de aquí: cachear un 404 o
            // un error de red deja la app rota hasta el siguiente despliegue.
            if (response.ok && response.type === 'basic') {
                const cache = await caches.open(CACHE_VERSION);
                cache.put(request, response.clone());
            }
            return response;
        } catch (err) {
            return new Response('', { status: 504, statusText: 'offline' });
        }
    })());
});
