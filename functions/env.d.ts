// Los tipos de la plataforma de Cloudflare que ESTE proyecto usa, y solo ésos.
//
// La alternativa era `@cloudflare/workers-types`, que son ~15 000 líneas y una
// dependencia más. Aquí se escriben a mano las cinco interfaces que se tocan de
// verdad, y eso tiene un beneficio que la dependencia no da: este fichero es el
// inventario auditable de la superficie de plataforma de la que depende el
// servidor. Si algún día hay que migrar fuera de Cloudflare, lo que hay que
// reimplementar está escrito aquí y ocupa una pantalla.
//
// `Request`, `Response`, `Headers`, `URL` y `crypto.subtle` NO están aquí: los
// da la lib `DOM` del tsconfig y el runtime de Workers los implementa según el
// mismo estándar.

interface D1Result<T = Record<string, unknown>> {
    results: T[];
    success: boolean;
    meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number };
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2Object {
    key: string;
    size: number;
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
    put(key: string, value: ArrayBuffer | ReadableStream): Promise<R2Object>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: { prefix?: string; cursor?: string }): Promise<{
        objects: { key: string; size: number }[];
        truncated: boolean;
        cursor?: string;
    }>;
}

/** Los enlaces declarados en `wrangler.toml`. */
interface Env {
    DB: D1Database;
    PHOTOS: R2Bucket;

    /**
     * El cliente OAuth de Google (M10).
     *
     * El ID es PÚBLICO —viaja en la URL a la que se manda el navegador— y vive
     * en `wrangler.toml`. El SECRETO no: se guarda con
     * `wrangler pages secret put GOOGLE_CLIENT_SECRET` y no está en el
     * repositorio. Los dos son opcionales: sin ellos, entrar con Google
     * devuelve 503 y todo lo demás sigue funcionando igual.
     */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
}

/** El contexto que Pages pasa a cada Function. */
interface EventContext<E = Env, D = Record<string, unknown>> {
    request: Request;
    env: E;
    params: Record<string, string | string[]>;
    data: D;
    waitUntil(promise: Promise<unknown>): void;
    next(input?: Request): Promise<Response>;
}
