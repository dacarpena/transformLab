// @ts-check

/**
 * Zoom, paneo y pellizco sobre el lienzo (E13-7), sin dependencias.
 *
 * `chartjs-plugin-zoom` no entra: CLAUDE.md §5 dice «cero dependencias de
 * runtime salvo Chart.js vendorizado», y aquí no hay nada que justifique la
 * excepción — todo lo que hace falta pasa por `setWindow`, que ya existe y ya
 * mueve la ventana sin reconstruir la gráfica.
 *
 * TRES DECISIONES QUE NO SON DE IMPLEMENTACIÓN:
 *
 * **1. La rueda solo hace zoom con `Ctrl`/`⌘`, o con el lienzo enfocado.** Una
 * rueda que siempre llama a `preventDefault` deja la página sin desplazamiento
 * vertical sobre una gráfica de 460 px de alto: el usuario se queda atrapado. Con
 * modificador se respeta el gesto que el navegador YA asocia a «zoom», y sin él
 * la página se desplaza como en cualquier otro sitio.
 *
 * **2. Un movimiento por fotograma.** Un trackpad dispara decenas de eventos por
 * gesto; sin coalescer, cada uno provoca un `update()` de Chart.js y el zoom se
 * vuelve pegajoso justo cuando más fluido debería sentirse.
 *
 * **3. Un arrastre de menos de cuatro píxeles NO es un arrastre.** Es un clic, y
 * el clic sobre un hito abre su ficha. Sin ese umbral, el temblor normal de un
 * dedo convertiría cada toque en un paneo minúsculo y la ficha no se abriría
 * nunca.
 */

/** Por debajo de esto, un arrastre es un clic. */
const DRAG_THRESHOLD_PX = 4;

/** Cuánto acerca o aleja cada golpe de rueda. */
const WHEEL_FACTOR = 1.15;

/** Ventana mínima: por debajo, el eje X deja de tener rótulos distintos. */
const MIN_SPAN_DAYS = 5;

/**
 * @typedef {Object} GestureHooks
 * @property {() => { from: number, to: number }} getWindow la ventana visible ahora
 * @property {() => { from: number, to: number }} getBounds los límites del plan
 * @property {(px: number) => number} dayAtPixel día bajo una coordenada X del lienzo
 * @property {() => number} pixelsPerDay
 * @property {(from: number, to: number) => void} onWindow
 */

/**
 * Acota una ventana a los límites del plan conservando su anchura.
 * @param {number} from @param {number} to @param {{from: number, to: number}} bounds
 * @returns {{ from: number, to: number }}
 */
export function clampWindow(from, to, bounds) {
    const total = bounds.to - bounds.from;
    let span = Math.max(MIN_SPAN_DAYS, Math.min(to - from, total));
    if (span >= total) return { from: bounds.from, to: bounds.to };
    let start = from;
    if (start < bounds.from) start = bounds.from;
    if (start + span > bounds.to) start = bounds.to - span;
    return { from: Math.round(start), to: Math.round(start + span) };
}

/**
 * Calcula la ventana tras un zoom anclado en un día.
 *
 * El ancla es lo que hace que el zoom se sienta natural: el día bajo el cursor
 * se queda donde está y el resto se acerca o se aleja a su alrededor. Sin ancla,
 * hacer zoom sobre un punto concreto lo aparta de la vista.
 *
 * @param {{from: number, to: number}} window
 * @param {number} anchorDay @param {number} factor >1 aleja, <1 acerca
 * @param {{from: number, to: number}} bounds
 * @returns {{ from: number, to: number }}
 */
export function zoomAround(window, anchorDay, factor, bounds) {
    const span = window.to - window.from;
    const nuevo = span * factor;
    // Proporción del ancla dentro de la ventana: se conserva.
    const ratio = span <= 0 ? 0.5 : (anchorDay - window.from) / span;
    const from = anchorDay - nuevo * ratio;
    return clampWindow(from, from + nuevo, bounds);
}

/**
 * Conecta los gestos a un lienzo.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {GestureHooks} hooks
 * @returns {() => void} función para desconectarlos
 */
export function attachGestures(canvas, hooks) {
    /** @type {number | null} */ let frame = null;
    /** @type {{from: number, to: number} | null} */ let pending = null;

    /** Coalesce a un movimiento por fotograma. */
    const schedule = (/** @type {{from: number, to: number}} */ w) => {
        pending = w;
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            if (pending) hooks.onWindow(pending.from, pending.to);
            pending = null;
        });
    };

    const xEnLienzo = (/** @type {PointerEvent | WheelEvent} */ event) =>
        event.clientX - canvas.getBoundingClientRect().left;

    /** @param {WheelEvent} event */
    const onWheel = (event) => {
        // Sin modificador y sin foco, la rueda es de la PÁGINA. Robársela deja
        // al usuario atrapado en la gráfica.
        const conModificador = event.ctrlKey || event.metaKey;
        if (!conModificador && document.activeElement !== canvas) return;
        event.preventDefault();
        const factor = event.deltaY > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
        schedule(zoomAround(hooks.getWindow(), hooks.dayAtPixel(xEnLienzo(event)), factor, hooks.getBounds()));
    };

    /** @type {Map<number, {x: number, y: number}>} */ const punteros = new Map();
    /** @type {{x: number, window: {from: number, to: number}} | null} */ let arrastre = null;
    /** @type {{distancia: number, centro: number, window: {from: number, to: number}} | null} */ let pellizco = null;
    let movido = 0;

    /** @param {PointerEvent} event */
    const onPointerDown = (event) => {
        punteros.set(event.pointerId, { x: event.clientX, y: event.clientY });
        canvas.setPointerCapture(event.pointerId);
        movido = 0;
        if (punteros.size === 1) {
            arrastre = { x: event.clientX, window: hooks.getWindow() };
            pellizco = null;
        } else if (punteros.size === 2) {
            const [a, b] = [...punteros.values()];
            arrastre = null;
            pellizco = {
                distancia: Math.abs(a.x - b.x) || 1,
                centro: (a.x + b.x) / 2 - canvas.getBoundingClientRect().left,
                window: hooks.getWindow()
            };
        }
    };

    /** @param {PointerEvent} event */
    const onPointerMove = (event) => {
        if (!punteros.has(event.pointerId)) return;
        punteros.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pellizco && punteros.size >= 2) {
            const [a, b] = [...punteros.values()];
            const distancia = Math.abs(a.x - b.x) || 1;
            const factor = pellizco.distancia / distancia;
            schedule(zoomAround(pellizco.window, hooks.dayAtPixel(pellizco.centro), factor, hooks.getBounds()));
            movido = DRAG_THRESHOLD_PX + 1;
            return;
        }
        if (!arrastre) return;

        const deltaPx = event.clientX - arrastre.x;
        movido = Math.max(movido, Math.abs(deltaPx));
        if (movido < DRAG_THRESHOLD_PX) return;   // todavía puede ser un clic
        const porDia = hooks.pixelsPerDay() || 1;
        const deltaDias = -deltaPx / porDia;
        schedule(clampWindow(
            arrastre.window.from + deltaDias,
            arrastre.window.to + deltaDias,
            hooks.getBounds()
        ));
    };

    /** @param {PointerEvent} event */
    const onPointerUp = (event) => {
        punteros.delete(event.pointerId);
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (punteros.size < 2) pellizco = null;
        if (punteros.size === 0) arrastre = null;
    };

    /** Doble toque o doble clic: vuelta al plan entero. */
    const onDoubleClick = () => {
        const bounds = hooks.getBounds();
        schedule({ from: bounds.from, to: bounds.to });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);

    return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('dblclick', onDoubleClick);
    };
}
