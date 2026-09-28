import { ManualWindow } from "../Color/base-color.class";

/** Ventana predefinida por modalidad. `key` es la clave del texto en src/app/i18n (viewer.preset.<key>). */
export interface WindowPreset extends ManualWindow {
    key: string;
}

/**
 * Ventanas habituales de TC en unidades Hounsfield (centro / anchura), las de cualquier estación de trabajo
 * (Radiopaedia, "Windowing (CT)"). Se ofrecen en el selector de ventana del visor además de las del fichero.
 * Solo tienen sentido en TC: en el resto de modalidades los valores no son absolutos.
 */
const CT_PRESETS: WindowPreset[] = [
    { key: 'brain', center: 40, width: 80 },
    { key: 'softTissue', center: 40, width: 400 },
    { key: 'mediastinum', center: 50, width: 350 },
    { key: 'lung', center: -600, width: 1500 },
    { key: 'bone', center: 400, width: 1800 },
];

export class WindowPresets {
    /** Presets de la modalidad (0008,0060); vacío si no hay. */
    public static forModality(modality: string | undefined | null): WindowPreset[] {
        const m = (modality ?? '').replace(/\0/g, '').trim().toUpperCase();
        return m == 'CT' ? CT_PRESETS : [];
    }
}
