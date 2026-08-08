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

const CACHE_VERSION = 'tl-v5-0082';

/**
 * Todo lo que la aplicación necesita para arrancar. Sin bundler, cada módulo
 * es una petición propia: si falta uno, la app no arranca offline. La lista
 * se comprueba en `test/pwa.test.js` contra el árbol real.
 */
const PRECACHE = [
    // OJO: aquí va './' y NO 'index.html'.
    //
    // Cloudflare Pages responde 308 a /index.html y redirige a /. `addAll` es
    // todo-o-nada, así que esa sola entrada hacía fallar el precache ENTERO:
    // en producción el service worker no llegaba a instalarse nunca y la
    // aplicación no tenía offline en absoluto. Se veía como que todo iba bien
    // —la app cargaba de red— y solo el modo avión lo habría delatado.
    // `test/pwa.test.js` no podía verlo porque solo lee este fuente.
    './',
    'manifest.webmanifest',
    'css/tokens.css',
    'css/app.css',
    // Chart.js ya no lo enlaza el HTML (lo pide chart.js bajo demanda), pero
    // se precachea igual: sin él no habría gráfica sin red.
    'vendor/chart.umd.min.js',
    'vendor/data/exercises.json',
    'vendor/data/foods.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'src/main.js',
    'src/core/achievements.js',
    'src/core/constants.js',
    'src/core/data/aesthetic-catalog.json',
    'src/core/data/supplements-catalog.json',
    'src/core/engine.js',
    'src/core/integrated-plan.js',
    'src/core/modules.js',
    'src/core/muscle-groups.js',
    'src/core/muscle-volume.js',
    'src/core/expenditure.js',
    'src/core/generator.js',
    'src/core/milestones.js',
    'src/core/nutrition.js',
    'src/core/ranges.js',
    'src/core/rng.js',
    'src/core/scale.js',
    'src/core/series-catalog.js',
    'src/core/silhouette.js',
    'src/core/foods.js',
    'src/core/menu.js',
    'src/core/recalibration.js',
    'src/core/shopping.js',
    'src/core/steps.js',
    'src/core/supplements.js',
    'src/core/training-plan.js',
    'src/core/timeline.js',
    'src/core/tracking.js',
    'src/core/training.js',
    'src/data/backup.js',
    'src/data/checkins.js',
    'src/data/foods-db.js',
    'src/data/intake-log.js',
    'src/data/exercises-db.js',
    'src/data/preferences.js',
    'src/data/recipes.js',
    'src/data/steps.js',
    'src/data/migrate.js',
    'src/data/migrations.js',
    'src/data/nutrition.js',
    'src/data/photos-db.js',
    'src/data/profiles.js',
    'src/data/schema.js',
    'src/data/settings.js',
    'src/data/storage.js',
    'src/data/version.js',
    'src/data/training.js',
    'src/i18n/en.js',
    'src/i18n/es.js',
    'src/i18n/i18n.js',
    'src/ui/chart.js',
    'src/ui/csv.js',
    'src/ui/dates.js',
    'src/ui/dom.js',
    'src/ui/format.js',
    'src/ui/muscle-grid.js',
    'src/ui/plan-summary.js',
    'src/ui/muscle-units.js',
    'src/ui/plan-chart.js',
    'src/ui/series-style.js',
    'src/ui/plan-state.js',
    'src/ui/pwa.js',
    'src/ui/reminder.js',
    'src/ui/recalibrate.js',
    'src/ui/router.js',
    'src/ui/components/modal.js',
    'src/ui/components/state.js',
    'src/ui/components/toast.js',
    'src/ui/views/_manifest.js',
    'src/ui/views/achievements.js',
    'src/ui/views/analysis.js',
    'src/ui/views/body.js',
    'src/ui/views/checkin.js',
    'src/ui/views/expenditure.js',
    'src/ui/views/foods.js',
    'src/ui/views/shopping.js',
    'src/ui/views/supplements.js',
    'src/ui/views/dashboard.js',
    'src/ui/views/milestones.js',
    'src/ui/views/nutrition.js',
    'src/ui/views/onboarding.js',
    'src/ui/views/photos.js',
    'src/ui/views/progress.js',
    'src/ui/views/projection.js',
    'src/ui/views/settings.js',
    'src/ui/views/training.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
            // `reload` evita precachear lo que el caché HTTP ya tenía viejo.
            await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
        } catch (err) {
            // Todo-o-nada es deliberado (ver §3 de la cabecera), pero silencioso
            // no: sin esto, un precache fallido deja la aplicación sin offline
            // sin que nadie se entere hasta que alguien se mete en el metro.
            console.error('[sw] precache incompleto: la aplicación NO funcionará sin red', err);
            throw err;
        }
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
            // './' y no 'index.html': ver el comentario de PRECACHE. Además,
            // devolver una respuesta REDIRIGIDA a una navegación es un error
            // que el navegador rechaza, y /index.html redirige.
            const cached = await caches.match('./');
            if (cached && !cached.redirected) return cached;
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
