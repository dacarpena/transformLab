// @ts-check

/**
 * Arranque de TransformLab v5 (CLAUDE.md §3): storage → i18n → perfil → router.
 *
 * El orden importa: sin perfil activo no se puede leer nada (el namespace del
 * almacén depende de él), y sin idioma no se puede pintar ni un mensaje de
 * error. Cada paso degrada de forma explícita en vez de dejar la pantalla en
 * blanco.
 */

import * as storage from './data/storage.js';
import * as profiles from './data/profiles.js';
import * as migrate from './data/migrate.js';
import { validateCollection } from './data/schema.js';
import { t, setLocale, getLocale } from './i18n/i18n.js';
import { html, render } from './ui/dom.js';
import * as router from './ui/router.js';
import * as plans from './ui/plan-state.js';
import { isScaleProfile } from './ui/muscle-units.js';
import * as onboarding from './ui/views/onboarding.js';
import * as dashboard from './ui/views/dashboard.js';
import { VIEWS } from './ui/views/_manifest.js';
import * as recalibrate from './ui/recalibrate.js';
import * as pwa from './ui/pwa.js';
import * as reminder from './ui/reminder.js';
import * as toast from './ui/components/toast.js';
import { error as errorState } from './ui/components/state.js';

/**
 * Cablea el botón «Recargar» de los estados de error que pinta ESTE módulo.
 *
 * El router cablea el suyo dentro de `start()`, pero los errores de arranque
 * —índice de perfiles ilegible, plan no reconstruible— se pintan antes de que
 * el router arranque, y su único botón se quedaba inerte: un callejón sin
 * salida, justo lo que un estado de error no puede ser (ficha H-013).
 * @param {HTMLElement} root
 */
function wireReload(root) {
    root.querySelector('[data-action="reload"]')
        ?.addEventListener('click', () => globalThis.location?.reload());
}

/** Pinta el armazón y devuelve sus anclajes. */
function renderShell() {
    const app = document.getElementById('app');
    if (!app) throw new Error('falta #app');
    render(app, html`
        <a class="skip-link" href="#main">${t('app.skipToContent')}</a>
        <div class="app">
            <nav class="app__nav" aria-label="${t('nav.label')}" data-nav hidden></nav>
            <main class="app__main" id="main" tabindex="-1" data-view></main>
        </div>
    `);
    return {
        viewRoot: /** @type {HTMLElement} */ (app.querySelector('[data-view]')),
        navRoot: /** @type {HTMLElement} */ (app.querySelector('[data-nav]'))
    };
}

/** Aplica el idioma guardado en el perfil activo, si lo hay. */
function applyStoredLocale() {
    const stored = storage.get('settings');
    if (stored.ok && stored.value && typeof (/** @type {*} */ (stored.value).locale) === 'string') {
        setLocale(/** @type {*} */ (stored.value).locale);
    }
    document.documentElement.lang = getLocale();
    document.title = t('app.title');
}

/** ¿Hay un perfil de usuario ya completado en el perfil activo? */
function hasCompletedProfile() {
    const stored = storage.get('profile');
    if (!stored.ok || stored.value === null) return false;
    return validateCollection('profile', stored.value).ok;
}

/**
 * Cableado por vista: lo único que NO puede vivir en el manifiesto, porque
 * necesita el contexto del arranque (`roots`, y las funciones de este módulo).
 *
 * Corre en `afterLoad`, o sea cuando el módulo llega de verdad: con carga
 * diferida, cablear antes sería cablear la nada.
 * @param {*} roots
 * @returns {Record<string, (module: *) => void>}
 */
function wiringFor(roots) {
    return {
        checkin: (m) => m.setOnSaved(() => route(roots)),
        progress: (m) => m.setOnGoToCheckin(() => router.navigate('checkin')),
        settings: (m) => {
            m.setOnProfilesChanged(() => route(roots));
            m.setOnEditProfile(() => editProfile(roots));
        }
    };
}

/** Registra las vistas del producto y arranca el router. */
async function startApp(/** @type {*} */ roots) {
    router.reset();
    const wiring = wiringFor(roots);
    // Qué vistas hay y en qué orden lo dice `_manifest.js`, no este fichero:
    // antes había que acordarse de siete sitios para añadir una (M7-3).
    for (const view of VIEWS) {
        // Hoy es la única sin `load`: va en el arranque y se importa arriba,
        // así que su montaje es directo en vez de diferido.
        const entry = view.load
            ? { load: view.load, afterLoad: wiring[view.id] }
            : { mount: dashboard.mount, unmount: dashboard.unmount };
        router.register({
            id: view.id, labelKey: view.labelKey, icon: view.icon, primary: view.primary,
            ...entry
        });
    }
    await router.start({ viewRoot: roots.viewRoot, navRoot: roots.navRoot, fallbackView: 'today' });

    // Tras montar, se comprueba si procede OFRECER una recalibración (E1a).
    // Nunca se aplica sola: solo se abre el diálogo y el usuario decide.
    const verdict = recalibrate.check();
    if (verdict.offer) recalibrate.offer(verdict, () => route(roots));
}

/** Muestra el asistente como única vista, sin navegación. */
async function startOnboarding(/** @type {*} */ roots, /** @type {*} */ seed = undefined) {
    router.reset();
    onboarding.resetDraft(seed);
    router.register({ id: 'onboarding', labelKey: 'onboarding.title', icon: '', hidden: true, mount: onboarding.mount });
    await router.start({ viewRoot: roots.viewRoot, navRoot: roots.navRoot, fallbackView: 'onboarding' });
}

/**
 * Reabre el asistente con los datos actuales, para editar el perfil.
 *
 * Vive en el módulo (y no dentro de `boot`) porque ahora lo llaman dos sitios
 * que ocurren en momentos distintos: la tarjeta de Hoy y el `afterLoad` de
 * ajustes, que puede pasar minutos después de arrancar.
 * @param {{viewRoot: HTMLElement, navRoot: HTMLElement}} roots
 */
function editProfile(roots) {
    const data = plans.get();
    if (!data) {
        startOnboarding(roots);
        return;
    }
    // El asistente habla en la unidad del usuario, así que hay que devolverle
    // SUS cifras, no las internas: si vino de una báscula, el campo de músculo
    // lleva la de la báscula y el hueso vuelve a su sitio. Sin esto, reeditar
    // el perfil lo degradaba en silencio de «derivado» a «medido» y su músculo
    // se desplomaba de 56,56 a 29,24 delante de él.
    const { initial, target } = data.profile;
    // El MISMO predicado que usan el dashboard, la gráfica y Progreso: si aquí
    // divergiera, un perfil se reeditaría en una unidad y se mostraría en otra.
    const isScale = isScaleProfile(initial);
    // El objetivo viaja CON su unidad. El asistente re-expresa un objetivo
    // cuyo offset no coincide con el vigente, así que sembrar la cifra sin su
    // offset la haría leer como esquelética: los 60 kg de báscula volvían del
    // asistente convertidos en 87,3.
    const targetOffsetKg = isScale ? initial.scaleMuscleKg - initial.muscleKg : 0;
    startOnboarding(roots, {
        name: data.profile.name,
        sex: data.profile.user.sex,
        age: data.profile.user.age,
        heightCm: data.profile.user.heightCm,
        activityLevel: data.profile.user.activityLevel,
        trainingStatus: data.profile.user.trainingStatus,
        weightKg: initial.weightKg,
        fatPct: initial.fatPct,
        muscleKg: isScale ? initial.scaleMuscleKg : initial.muscleKg,
        boneKg: isScale ? initial.boneKg : null,
        targetFatPct: target.fatPct,
        targetMuscleKg: isScale && Number.isFinite(target.scaleMuscleKg)
            ? target.scaleMuscleKg
            : (isScale ? target.muscleKg + targetOffsetKg : target.muscleKg),
        targetMuscleOffsetKg: targetOffsetKg,
        startDateISO: data.profile.startDateISO,
        intensity: data.profile.intensity
    });
}

/**
 * Carga el plan del perfil activo y decide qué mostrar.
 * @param {{viewRoot: HTMLElement, navRoot: HTMLElement}} roots
 */
async function route(roots) {
    applyStoredLocale();

    if (!hasCompletedProfile()) {
        await startOnboarding(roots);
        return;
    }
    const settingsStored = storage.get('settings');
    const fluctuation = settingsStored.ok && settingsStored.value
        ? Boolean(/** @type {*} */ (settingsStored.value).fluctuationVisible)
        : false;

    const loaded = plans.load({ profileId: storage.getActiveProfile(), fluctuation });
    if (!loaded.ok) {
        if (loaded.reason === 'noProfile') {
            await startOnboarding(roots);
            return;
        }
        // El plan guardado ya no se puede construir (p. ej. tras cambiar el
        // motor). Se ofrece rehacer el perfil, NUNCA borrar los datos: la
        // salida a un error jamás es destructiva (ficha H-013).
        render(roots.viewRoot, errorState({
            titleKey: 'error.viewTitle',
            bodyKey: 'error.viewBody',
            actions: [
                { labelKey: 'action.editProfile', action: 'edit-profile', primary: true },
                { labelKey: 'action.reload', action: 'reload' }
            ]
        }));
        roots.viewRoot.querySelector('[data-action="edit-profile"]')
            ?.addEventListener('click', () => startOnboarding(roots));
        wireReload(roots.viewRoot);
        return;
    }
    await startApp(roots);

    // El recordatorio se arma AQUÍ y no en el arranque, porque el horario es
    // de cada perfil: al cambiar de perfil, `route` se vuelve a ejecutar y
    // `start()` desarma el del perfil anterior antes de armar el del nuevo.
    // Colgado del arranque, el aviso del perfil viejo seguía vivo y el del
    // nuevo no llegaba a existir.
    reminder.start();
}

async function boot() {
    /** @type {{viewRoot: HTMLElement, navRoot: HTMLElement}} */
    let roots;
    try {
        roots = renderShell();
    } catch (err) {
        console.error('[main] no se pudo pintar el armazón', err);
        return;
    }

    // 1 · perfiles: el namespace del almacén depende del perfil activo, así
    // que esto va antes de leer cualquier dato.
    const index = profiles.readIndex();
    if (!index.ok) {
        render(roots.viewRoot, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
        wireReload(roots.viewRoot);
        return;
    }

    // 2 · migración v4 → v5, una sola vez y con copia de seguridad previa
    if (migrate.needsMigration()) {
        const result = migrate.migrate({ nowISO: new Date().toISOString() });
        if (!result.ok) {
            console.warn('[main] migración no completada:', result.error);
            toast.error('error.generic');
        }
    }

    // 3 · perfil activo (o el primero, si el índice quedó sin activo)
    profiles.activateStored();
    // Una sola lectura: llamar dos veces a `getActive()` no solo impedía a
    // TypeScript estrechar el tipo, sino que releía el índice de perfiles del
    // almacén en cada arranque.
    const active = profiles.getActive();
    if (active.ok && active.value === '') {
        const list = profiles.list();
        if (list.ok && list.value.length === 0) {
            const created = profiles.create(t('app.title'), { createdAtISO: new Date().toISOString() });
            if (!created.ok) {
                render(roots.viewRoot, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
                wireReload(roots.viewRoot);
                return;
            }
        } else if (list.ok) {
            profiles.setActive(list.value[0].id);
        }
    }

    // 4 · cableado de las vistas que SÍ se cargan en el arranque. El resto lo
    // hace `afterLoad` cuando llega su módulo (ver `startApp`).
    onboarding.setOnComplete(() => route(roots));
    dashboard.setOnGoToCheckin(() => router.navigate('checkin'));
    dashboard.setOnGoToProjection(() => router.navigate('projection'));

    // 5 · a rodar
    await route(roots);

    // 6 · offline, al final y sin bloquear: si el registro falla, la
    // aplicación ya está en pie y el usuario no pierde nada.
    pwa.register();
}

boot();
