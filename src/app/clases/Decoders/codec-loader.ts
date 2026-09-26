/**
 * Carga bajo demanda de los códecs grandes (src/assets/codecs, ver THIRD_PARTY_NOTICES.md).
 *
 * - Son builds asm.js/wasm2js (JS puro): funcionan con la CSP de producción (script-src 'self', sin
 *   'wasm-unsafe-eval' ni 'unsafe-eval').
 * - Se cargan con un <script src="assets/codecs/..."> del mismo origen la primera vez que un fichero los necesita
 *   (no van en el bundle inicial). No se importan con import(): llevan require("fs") en la rama de Node de
 *   emscripten y webpack intentaría resolverlo.
 * - Cada script define un global con la factoría emscripten (p. ej. OpenJPEGJS). Si el global ya existe
 *   (el harness de Node lo registra antes), no se carga nada.
 * - Los decoders piden el módulo con CodecLoader.require(): si aún no está cargado lanzan CodecRequiredError,
 *   ImageDCM lo carga (asíncrono) y reintenta. Si la carga falla, isUnavailable() lo indica y el decoder usa
 *   su alternativa (si la tiene).
 */
export type CodecName = 'openjpeg' | 'libjpeg-turbo' | 'libjpeg-turbo-12';

interface CodecSpec {
    file: string;
    globalName: string;
}

const CODECS: Record<CodecName, CodecSpec> = {
    'openjpeg': { file: 'openjpegjs_decode.js', globalName: 'OpenJPEGJS' },
    'libjpeg-turbo': { file: 'libjpegturbojs_decode.js', globalName: 'libjpegturbojs_decode' },
    // Build de 12 bits (WITH12BIT): solo decodifica JPEG de 12 bits; el de 8 bits solo los de 8
    'libjpeg-turbo-12': { file: 'libjpegturbo12js.js', globalName: 'libjpegturbo12js' },
};

/** Ruta (relativa al base href) donde se sirven los códecs. */
export const CODECS_BASE_PATH = 'assets/codecs/';

export class CodecRequiredError extends Error {
    constructor(public codec: CodecName) {
        super('Códec no cargado todavía: ' + codec);
        this.name = 'CodecRequiredError';
    }
}

export class CodecLoader {
    private static instances = new Map<CodecName, any>();
    private static loading = new Map<CodecName, Promise<any>>();
    private static failed = new Set<CodecName>();

    /** Instancia del módulo ya inicializado, o lanza CodecRequiredError para que se cargue y se reintente. */
    public static require(name: CodecName): any {
        const instance = CodecLoader.instances.get(name);
        if (instance) {
            return instance;
        }
        throw new CodecRequiredError(name);
    }

    public static isLoaded(name: CodecName): boolean {
        return CodecLoader.instances.has(name);
    }

    /** true si ya se intentó cargar y falló (fichero ausente, red...). */
    public static isUnavailable(name: CodecName): boolean {
        return CodecLoader.failed.has(name);
    }

    public static load(name: CodecName): Promise<any> {
        const existing = CodecLoader.loading.get(name);
        if (existing) {
            return existing;
        }
        const spec = CODECS[name];
        const promise = CodecLoader.factory(spec)
            .then((factory) => factory({ print: () => {}, printErr: () => {} }))
            .then((instance) => {
                CodecLoader.instances.set(name, instance);
                return instance;
            })
            .catch((error) => {
                CodecLoader.failed.add(name);
                console.warn('No se pudo cargar el códec ' + name + ': ' + (error?.message ?? error));
                throw error;
            });
        CodecLoader.loading.set(name, promise);
        return promise;
    }

    private static factory(spec: CodecSpec): Promise<any> {
        const existing = (globalThis as any)[spec.globalName];
        if (typeof existing === 'function') {
            return Promise.resolve(existing);
        }
        if (typeof document === 'undefined') {
            return Promise.reject(new Error('Sin DOM: registra globalThis.' + spec.globalName + ' antes de decodificar'));
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL(CODECS_BASE_PATH + spec.file, document.baseURI).href;
            script.async = true;
            script.onload = () => {
                const loaded = (globalThis as any)[spec.globalName];
                if (typeof loaded === 'function') {
                    resolve(loaded);
                } else {
                    reject(new Error(spec.file + ' no definió ' + spec.globalName));
                }
            };
            script.onerror = () => reject(new Error('No se pudo descargar ' + script.src));
            document.head.appendChild(script);
        });
    }
}
