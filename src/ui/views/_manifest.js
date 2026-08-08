// @ts-check

/**
 * Las vistas del producto, en un solo sitio (M7-3).
 *
 * POR QUÉ EXISTE. Añadir una vista costaba acordarse de siete sitios:
 * registrarla en `main.js`, meterla en `PRECACHE`, subir `CACHE_VERSION`, y
 * añadirla a tres listas de test distintas (`accessibility.spec.js`,
 * `satellites.spec.js`, más las de i18n). Ninguno avisaba si olvidabas los
 * otros; la vista simplemente no salía en la navegación, o salía pero no abría
 * sin red, o abría pero nadie comprobaba su accesibilidad. Con la v2 apuntando
 * a «más funcionalidad, misma app», ese coste se paga muchas veces.
 *
 * Aquí va solo lo DECLARATIVO: qué vistas hay, cómo se llaman, en qué orden
 * salen y cuáles caben en la barra inferior. El cableado que necesita el
 * contexto del arranque (los `setOnX` de cada vista) se queda en `main.js`,
 * porque depende de cosas que este módulo no tiene ni debe tener.
 *
 * Los `load` viven aquí, y no en `main.js`, por una razón concreta: un
 * `import('./checkin.js')` se resuelve relativo al módulo donde está escrito.
 * Poniéndolo en el manifiesto los especificadores siguen siendo literales
 * —analizables, precacheables— y apuntan a esta carpeta, que es la suya.
 *
 * `test/views-manifest.test.js` comprueba que esta lista y el resto del
 * proyecto no se separan.
 */

/**
 * @typedef {Object} ViewManifestEntry
 * @property {string} id identificador estable; es la clave del router y del almacén
 * @property {string} labelKey clave i18n del rótulo de navegación
 * @property {string} icon glifo de la barra; decorativo, siempre acompañado del rótulo
 * @property {boolean} primary ¿pestaña siempre visible en móvil, o plegada tras «más»?
 * @property {string} path ruta del módulo desde la raíz del repositorio (para `PRECACHE`)
 * @property {(() => Promise<*>) | null} load carga diferida; `null` = va en el arranque
 */

/**
 * Orden de registro = orden de la navegación.
 *
 * `primary: true` son las cuatro pestañas fijas de la barra inferior. Son
 * cuatro y no cinco porque a 320 px la quinta deja los objetivos táctiles por
 * debajo de 44 px; el resto se pliega tras «más».
 * @type {ViewManifestEntry[]}
 */
export const VIEWS = [
    // Hoy es la única que NO se difiere: es la pantalla del arranque, y
    // diferirla añadiría un salto de red al primer pintado.
    {
        id: 'today', labelKey: 'nav.today', icon: '◉', primary: true,
        path: 'src/ui/views/dashboard.js', load: null
    },
    // Las demás llegan al visitarlas. Sin bundler cada una es una petición, y
    // cargarlas todas en el arranque metía en el camino crítico seis vistas,
    // media docena de módulos del motor y el catálogo de hitos entero (34 KB)
    // para pintar una pantalla que no usa nada de eso.
    {
        id: 'checkin', labelKey: 'checkin.nav', icon: '＋', primary: true,
        path: 'src/ui/views/checkin.js', load: () => import('./checkin.js')
    },
    {
        id: 'progress', labelKey: 'nav.progress', icon: '◔', primary: true,
        path: 'src/ui/views/progress.js', load: () => import('./progress.js')
    },
    {
        id: 'nutrition', labelKey: 'nav.nutrition', icon: '◈', primary: true,
        path: 'src/ui/views/nutrition.js', load: () => import('./nutrition.js')
    },
    // Proyección es `primary: false` a propósito: promoverla obligaría a
    // degradar una de las cuatro anteriores. Se llega desde Hoy.
    {
        id: 'projection', labelKey: 'nav.projection', icon: '↗', primary: false,
        path: 'src/ui/views/projection.js', load: () => import('./projection.js')
    },
    {
        id: 'analysis', labelKey: 'nav.analysis', icon: '⧉', primary: false,
        path: 'src/ui/views/analysis.js', load: () => import('./analysis.js')
    },
    {
        id: 'expenditure', labelKey: 'nav.expenditure', icon: '⚖', primary: false,
        path: 'src/ui/views/expenditure.js', load: () => import('./expenditure.js')
    },
    {
        id: 'foods', labelKey: 'nav.foods', icon: '🍎', primary: false,
        path: 'src/ui/views/foods.js', load: () => import('./foods.js')
    },
    {
        id: 'shopping', labelKey: 'nav.shopping', icon: '🛒', primary: false,
        path: 'src/ui/views/shopping.js', load: () => import('./shopping.js')
    },
    {
        id: 'supplements', labelKey: 'nav.supplements', icon: '💊', primary: false,
        path: 'src/ui/views/supplements.js', load: () => import('./supplements.js')
    },
    {
        id: 'training', labelKey: 'nav.training', icon: '⬛', primary: false,
        path: 'src/ui/views/training.js', load: () => import('./training.js')
    },
    {
        id: 'body', labelKey: 'nav.body', icon: '◐', primary: false,
        path: 'src/ui/views/body.js', load: () => import('./body.js')
    },
    {
        id: 'milestones', labelKey: 'nav.milestones', icon: '✦', primary: false,
        path: 'src/ui/views/milestones.js', load: () => import('./milestones.js')
    },
    {
        id: 'photos', labelKey: 'nav.photos', icon: '▣', primary: false,
        path: 'src/ui/views/photos.js', load: () => import('./photos.js')
    },
    {
        id: 'achievements', labelKey: 'nav.achievements', icon: '★', primary: false,
        path: 'src/ui/views/achievements.js', load: () => import('./achievements.js')
    },
    {
        id: 'settings', labelKey: 'nav.settings', icon: '⚙', primary: false,
        path: 'src/ui/views/settings.js', load: () => import('./settings.js')
    }
];

/** @type {readonly string[]} ids en orden de navegación */
export const VIEW_IDS = VIEWS.map((view) => view.id);

/**
 * La única vista que NO se difiere: es la del arranque.
 *
 * Está nombrada aquí, y no deducida de «la que no tiene `load`», porque
 * `main.js` se apoyaba en esa deducción y cualquier entrada a la que se le
 * olvidara el `load` acababa montando Hoy en silencio (ataque adversarial M7).
 */
export const EAGER_VIEW_ID = 'today';
