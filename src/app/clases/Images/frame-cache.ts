/** Un frame ya decodificado (muestras, sin ventana aplicada: el RGBA se recalcula al cambiar la ventana VOI). */
export interface DecodedFrame {
    data: any;
    isRGB: boolean;
    bytes: number;
}

/**
 * Caché LRU GLOBAL de frames decodificados, con presupuesto en bytes, compartida por todas las imágenes (visor
 * principal, miniaturas, series). Clave: fichero (DCMFile.id) + frame. Con esto la memoria ya no crece con el tamaño
 * del estudio: lo que pase del presupuesto se descarta (lo más antiguo primero) y, si se vuelve a ver, se relee del
 * fichero y se decodifica otra vez.
 */
export class FrameCache {
    /** Presupuesto en bytes: 256 MB en escritorio, 128 MB en móvil o con poca memoria (navigator.deviceMemory <= 4). */
    public static budget: number = FrameCache.defaultBudget();

    private static frames = new Map<string, DecodedFrame>();
    private static used = 0;

    private static defaultBudget(): number {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        const small = !!nav && (/iPhone|iPad|iPod|Android/i.test(nav.userAgent ?? '') || (nav.deviceMemory && nav.deviceMemory <= 4));
        return (small ? 128 : 256) * 1024 * 1024;
    }

    private static key(fileId: number, frame: number): string {
        return fileId + ':' + frame;
    }

    public static has(fileId: number, frame: number): boolean {
        return FrameCache.frames.has(FrameCache.key(fileId, frame));
    }

    /** El frame (y lo marca como recién usado), o undefined si no está. */
    public static get(fileId: number, frame: number): DecodedFrame | undefined {
        const key = FrameCache.key(fileId, frame);
        const value = FrameCache.frames.get(key);
        if (value) {
            FrameCache.frames.delete(key);
            FrameCache.frames.set(key, value);
        }
        return value;
    }

    public static put(fileId: number, frame: number, data: any, isRGB: boolean): void {
        const key = FrameCache.key(fileId, frame);
        const previous = FrameCache.frames.get(key);
        if (previous) {
            FrameCache.used -= previous.bytes;
            FrameCache.frames.delete(key);
        }
        const bytes = FrameCache.sizeOf(data);
        FrameCache.frames.set(key, { data, isRGB, bytes });
        FrameCache.used += bytes;
        // Lo más antiguo fuera hasta volver al presupuesto (nunca el que se acaba de meter)
        for (const [oldKey, old] of FrameCache.frames) {
            if (FrameCache.used <= FrameCache.budget || oldKey === key) {
                break;
            }
            FrameCache.frames.delete(oldKey);
            FrameCache.used -= old.bytes;
        }
    }

    /** Bytes ocupados ahora mismo. */
    public static get usedBytes(): number {
        return FrameCache.used;
    }

    public static get size(): number {
        return FrameCache.frames.size;
    }

    public static clear(): void {
        FrameCache.frames.clear();
        FrameCache.used = 0;
    }

    private static sizeOf(data: any): number {
        if (data instanceof ArrayBuffer) {
            return data.byteLength;
        }
        if (ArrayBuffer.isView(data)) {
            return data.byteLength;
        }
        if (Array.isArray(data)) {
            return data.length * 8;
        }
        return 0;
    }
}
