import { DCMFileReader } from '../DCM/DCM-file-reader.class';

/**
 * Cine de los multiframe: si se reproducen como vídeo y a qué velocidad.
 *
 * Velocidad, por este orden: Frame Time (0018,1063); la media de Frame Time Vector (0018,1065); Recommended Display
 * Frame Rate (0008,2144); Cine Rate (0018,0040). Si el fichero no trae ninguno, la de su modalidad (MODALITY_FPS) o,
 * si no está en la lista, DEFAULT_FPS. Siempre entre MIN_MS y MAX_MS por frame.
 *
 * Los multiframe de STACK_MODALITIES son cortes o piezas, no un vídeo (TC y RM mejoradas, PET, medicina nuclear,
 * tomosíntesis de mama, OCT oftálmica e intravascular, segmentaciones, planos de dosis de radioterapia y teselas de
 * microscopía): si el fichero no trae tiempos, no se reproducen (sin botón de play) y el clic en la imagen pasa al
 * frame siguiente. Si los trae, el fabricante los quiere en cine.
 */
export class Cine {
    /** Frames por segundo según la modalidad, cuando el fichero no dice nada. */
    public static readonly MODALITY_FPS: { [modality: string]: number } = {
        XA: 15,    // hemodinámica: 15 fps es lo habitual hoy (antes 30); la angiografía de neuro va a 2-6, pero lo trae
        RF: 15,    // radioscopia pulsada: 7,5-15 fps
        US: 30,    // ecografía y ecocardiografía
        IVUS: 30,  // ecografía intravascular
        ES: 30,    // endoscopia (vídeo)
        XC: 30,    // cámara externa (vídeo)
    };
    /** Resto de modalidades con varios frames y sin tiempos (secundarias, OT...). */
    public static readonly DEFAULT_FPS = 10;
    /** Multiframe que se recorren frame a frame, sin cine, si el fichero no trae tiempos. */
    public static readonly STACK_MODALITIES = ['CT', 'MR', 'PT', 'NM', 'MG', 'OPT', 'IVOCT', 'SEG', 'RTDOSE', 'SM'];
    public static readonly MIN_MS = 10;
    public static readonly MAX_MS = 2000;

    public static modality(reader: DCMFileReader): string {
        return (reader.Modality ?? '').replace(/[\0 ]+$/, '').trim().toUpperCase();
    }

    /** Milisegundos por frame que dice el fichero; 0 si no dice nada. */
    public static fileFrameTime(reader: DCMFileReader): number {
        const ms = (v: number) => (isFinite(v) && v > 0) ? v : 0;
        const fps = (v: number) => (isFinite(v) && v > 0) ? 1000 / v : 0;
        return ms(reader.FrameTime) || ms(reader.FrameTimeVector)
            || fps(reader.RecommendedDisplayFrameRate) || fps(reader.CineRate);
    }

    /** Milisegundos entre frame y frame al reproducir. */
    public static frameTime(reader: DCMFileReader): number {
        const ms = Cine.fileFrameTime(reader) || 1000 / (Cine.MODALITY_FPS[Cine.modality(reader)] ?? Cine.DEFAULT_FPS);
        return Math.min(Cine.MAX_MS, Math.max(Cine.MIN_MS, ms));
    }

    /** Varios frames que son cortes, no vídeo: sin play; el clic pasa de frame. */
    public static isStack(reader: DCMFileReader): boolean {
        return reader.Frames > 1 && Cine.STACK_MODALITIES.includes(Cine.modality(reader)) && !Cine.fileFrameTime(reader);
    }

    /** Varios frames que se reproducen como vídeo. */
    public static canPlay(reader: DCMFileReader): boolean {
        return reader.Frames > 1 && !Cine.isStack(reader);
    }
}
