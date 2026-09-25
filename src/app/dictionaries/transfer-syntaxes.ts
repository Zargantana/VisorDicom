import { Functions } from "../clases/Crosscutting/Functions";

export const ImplicitVR = 'IMPLICIT';
export const ExplicitVR = 'EXPLICIT';
export const LittleEndinaVR = 'BIG_ENDIAN';
export const BigEndianVR = 'LITTLE_ENDIAN';

/**
 * Transfer Syntax UIDs (PS3.5 sec. 10 + Annex A, PS3.6 tabla A-1).
 * IMPORTANTE: el indice de cada fila ES el valor del enum TRANSFER_SYNTAX -> anadir siempre AL FINAL
 * y en el mismo orden en ambos sitios.
 */
export const TX_dictionary = [
    ['1.2.840.10008.1.2','Implicit VR Little Endian'],
    ['1.2.840.10008.1.2.1','Explicit VR Little Endian'],
    ['1.2.840.10008.1.2.1.99','Deflated Explicit VR Little Endian'],
    ['1.2.840.10008.1.2.2','Explicit VR Big Endian (Retired)'],
    ['1.2.840.10008.1.2.4.50','JPEG Baseline (Process 1)'],
    ['1.2.840.10008.1.2.4.51','JPEG Extended (Process 2 & 4)'],
    ['1.2.840.10008.1.2.4.52','JPEG Extended (Process 3 & 5) (Retired)'],
    ['1.2.840.10008.1.2.4.53','JPEG Spectral Selection, Non-Hierarchical (Process 6 & 8) (Retired)'],
    ['1.2.840.10008.1.2.4.54','JPEG Spectral Selection, Non-Hierarchical (Process 7 & 9) (Retired)'],
    ['1.2.840.10008.1.2.4.55','JPEG Full Progression, Non-Hierarchical (Process 10 & 12) (Retired)'],
    ['1.2.840.10008.1.2.4.56','JPEG Full Progression, Non-Hierarchical (Process 11 & 13) (Retired)'],
    ['1.2.840.10008.1.2.4.57','JPEG Lossless, Non-Hierarchical (Process 14)'],
    ['1.2.840.10008.1.2.4.58','JPEG Lossless, Non-Hierarchical (Process 15) (Retired)'],
    ['1.2.840.10008.1.2.4.59','JPEG Extended, Hierarchical (Process 16 & 18) (Retired)'],
    ['1.2.840.10008.1.2.4.60','JPEG Extended, Hierarchical (Process 17 & 19) (Retired)'],
    ['1.2.840.10008.1.2.4.61','JPEG Spectral Selection, Hierarchical (Process 20 & 22) (Retired)'],
    ['1.2.840.10008.1.2.4.62','JPEG Spectral Selection, Hierarchical (Process 21 & 23) (Retired)'],
    ['1.2.840.10008.1.2.4.63','JPEG Full Progression, Hierarchical (Process 24 & 26) (Retired)'],
    ['1.2.840.10008.1.2.4.64','JPEG Full Progression, Hierarchical (Process 25 & 27) (Retired)'],
    ['1.2.840.10008.1.2.4.65','JPEG Lossless, Hierarchical (Process 28) (Retired)'],
    ['1.2.840.10008.1.2.4.66','JPEG Lossless, Hierarchical (Process 29) (Retired)'],
    ['1.2.840.10008.1.2.4.70','JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1])'],
    ['1.2.840.10008.1.2.4.80','JPEG-LS Lossless Image Compression'],
    ['1.2.840.10008.1.2.4.81','JPEG-LS Lossy (Near-Lossless) Image Compression'],
    ['1.2.840.10008.1.2.4.90','JPEG 2000 Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.91','JPEG 2000 Image Compression'],
    ['1.2.840.10008.1.2.4.92','JPEG 2000 Part 2 Multi-component Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.93','JPEG 2000 Part 2 Multi-component Image Compression'],
    ['1.2.840.10008.1.2.4.94','JPIP Referenced'],
    ['1.2.840.10008.1.2.4.95','JPIP Referenced Deflate'],
    ['1.2.840.10008.1.2.5','RLE Lossless'],
    ['1.2.840.10008.1.2.6.1','RFC 2557 MIME encapsulation (Retired)'],
    ['1.2.840.10008.1.2.4.100','MPEG2 Main Profile / Main Level'],
    ['1.2.840.10008.1.2.4.102','MPEG-4 AVC/H.264 High Profile / Level 4.1'],
    ['1.2.840.10008.1.2.4.103','MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1'],
    // --- Anadidas despues (mantener al final: el indice es el enum) ---
    ['1.2.840.10008.1.2.1.98','Encapsulated Uncompressed Explicit VR Little Endian'],
    ['1.2.840.10008.1.2.4.100.1','Fragmentable MPEG2 Main Profile / Main Level'],
    ['1.2.840.10008.1.2.4.101','MPEG2 Main Profile / High Level'],
    ['1.2.840.10008.1.2.4.101.1','Fragmentable MPEG2 Main Profile / High Level'],
    ['1.2.840.10008.1.2.4.102.1','Fragmentable MPEG-4 AVC/H.264 High Profile / Level 4.1'],
    ['1.2.840.10008.1.2.4.103.1','Fragmentable MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1'],
    ['1.2.840.10008.1.2.4.104','MPEG-4 AVC/H.264 High Profile / Level 4.2 For 2D Video'],
    ['1.2.840.10008.1.2.4.104.1','Fragmentable MPEG-4 AVC/H.264 High Profile / Level 4.2 For 2D Video'],
    ['1.2.840.10008.1.2.4.105','MPEG-4 AVC/H.264 High Profile / Level 4.2 For 3D Video'],
    ['1.2.840.10008.1.2.4.105.1','Fragmentable MPEG-4 AVC/H.264 High Profile / Level 4.2 For 3D Video'],
    ['1.2.840.10008.1.2.4.106','MPEG-4 AVC/H.264 Stereo High Profile / Level 4.2'],
    ['1.2.840.10008.1.2.4.106.1','Fragmentable MPEG-4 AVC/H.264 Stereo High Profile / Level 4.2'],
    ['1.2.840.10008.1.2.4.107','HEVC/H.265 Main Profile / Level 5.1'],
    ['1.2.840.10008.1.2.4.108','HEVC/H.265 Main 10 Profile / Level 5.1'],
    ['1.2.840.10008.1.2.4.110','JPEG XL Lossless'],
    ['1.2.840.10008.1.2.4.111','JPEG XL JPEG Recompression'],
    ['1.2.840.10008.1.2.4.112','JPEG XL'],
    ['1.2.840.10008.1.2.4.201','High-Throughput JPEG 2000 Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.202','High-Throughput JPEG 2000 with RPCL Options Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.203','High-Throughput JPEG 2000 Image Compression'],
    ['1.2.840.10008.1.2.4.204','JPIP HTJ2K Referenced'],
    ['1.2.840.10008.1.2.4.205','JPIP HTJ2K Referenced Deflate'],
    ['1.2.840.10008.1.2.6.2','XML Encoding (Retired)'],
    ['1.2.840.10008.1.2.7.1','SMPTE ST 2110-20 Uncompressed Progressive Active Video'],
    ['1.2.840.10008.1.2.7.2','SMPTE ST 2110-20 Uncompressed Interlaced Active Video'],
    ['1.2.840.10008.1.2.7.3','SMPTE ST 2110-30 PCM Digital Audio'],
];

export enum TRANSFER_SYNTAX {
    Implicit_VR_Endian = 0,
    Explicit_VR_Little_Endian = 1,
    Deflated_Explicit_VR_Little_Endian = 2,
    Explicit_VR_Big_Endian = 3,
    JPEG_Baseline_Process_1 = 4,
    JPEG_Baseline_Process_2_4 = 5, // (nombre historico: realmente es JPEG Extended 2 & 4)
    JPEG_Extended_Processes_3_5 = 6,
    JPEG_Spectral_Selection_Nonhierarchical_Processes_6_8 = 7,
    JPEG_Spectral_Selection_Nonhierarchical_Processes_7_9 = 8,
    JPEG_Full_Progression_Nonhierarchical_Processes_10_12 = 9,
    JPEG_Full_Progression_Nonhierarchical_Processes_11_13 = 10,
    JPEG_Lossless_Nonhierarchical_Processes_14 = 11,
    JPEG_Lossless_Nonhierarchical_Processes_15 = 12,
    JPEG_Extended_Hierarchical_Processes_16_18 = 13,
    JPEG_Extended_Hierarchical_Processes_17_19 = 14,
    JPEG_Spectral_Selection_Hierarchical_Processes_20_22 = 15,
    JPEG_Spectral_Selection_Hierarchical_Processes_21_23 = 16,
    JPEG_Full_Progression_Hierarchical_Processes_24_26 = 17,
    JPEG_Full_Progression_Hierarchical_Processes_25_27 = 18,
    JPEG_Lossless_Nonhierarchical_Process_28 = 19,
    JPEG_Lossless_Nonhierarchical_Process_29 = 20,
    JPEG_Lossless_Nonhierarchical_First_Order_Prediction_Processes_14_Selection_Value_1 = 21,
    JPEG_LS_Lossless_Image_Compression = 22,
    JPEG_LS_Lossy_Near_Lossless_Image_Compression = 23,
    JPEG_2000_Image_Compression_Lossless_Only = 24,
    JPEG_2000_Image_Compression = 25,
    JPEG_2000_Part_2_Multicomponent_Image_Compression_Lossless_Only = 26,
    JPEG_2000_Part_2_Multicomponent_Image_Compression = 27,
    JPIP_Referenced = 28,
    JPIP_Referenced_Deflate = 29,
    RLE_Lossless = 30,
    RFC_2557_MIME_Encapsulation = 31,
    MPEG2_Main_Profile_Main_Level = 32,
    MPEG_4_AVC_H_264_High_Profile_Level_4_1 = 33,
    MPEG_4_AVC_H_264_BD_compatible_High_Profile_Level_4_1 = 34,
    Encapsulated_Uncompressed_Explicit_VR_Little_Endian = 35,
    Fragmentable_MPEG2_Main_Profile_Main_Level = 36,
    MPEG2_Main_Profile_High_Level = 37,
    Fragmentable_MPEG2_Main_Profile_High_Level = 38,
    Fragmentable_MPEG_4_AVC_H_264_High_Profile_Level_4_1 = 39,
    Fragmentable_MPEG_4_AVC_H_264_BD_compatible_High_Profile_Level_4_1 = 40,
    MPEG_4_AVC_H_264_High_Profile_Level_4_2_2D = 41,
    Fragmentable_MPEG_4_AVC_H_264_High_Profile_Level_4_2_2D = 42,
    MPEG_4_AVC_H_264_High_Profile_Level_4_2_3D = 43,
    Fragmentable_MPEG_4_AVC_H_264_High_Profile_Level_4_2_3D = 44,
    MPEG_4_AVC_H_264_Stereo_High_Profile_Level_4_2 = 45,
    Fragmentable_MPEG_4_AVC_H_264_Stereo_High_Profile_Level_4_2 = 46,
    HEVC_H_265_Main_Profile_Level_5_1 = 47,
    HEVC_H_265_Main_10_Profile_Level_5_1 = 48,
    JPEG_XL_Lossless = 49,
    JPEG_XL_JPEG_Recompression = 50,
    JPEG_XL = 51,
    HTJ2K_Lossless_Only = 52,
    HTJ2K_RPCL_Lossless_Only = 53,
    HTJ2K = 54,
    JPIP_HTJ2K_Referenced = 55,
    JPIP_HTJ2K_Referenced_Deflate = 56,
    XML_Encoding = 57,
    SMPTE_ST_2110_20_Progressive = 58,
    SMPTE_ST_2110_20_Interlaced = 59,
    SMPTE_ST_2110_30_Audio = 60
};

/** UID tal cual viene del fichero (con padding NUL o espacio) -> UID limpio. */
export function cleanUID(identifier: string): string {
    return Functions.clearDCMImpairValue(identifier ?? '').replace(/\0/g, '').trim();
}

//TODO hacer un zingletone
export class TX_Map extends Map<string, TRANSFER_SYNTAX> {
    constructor() {
        super();
        for(let i = 0; i < TX_dictionary.length; i++) {
            let TX: TRANSFER_SYNTAX = i;
            this.set(TX_dictionary[i][0], TX);
        }
    }

    /** Igual que get() pero limpiando el padding del UID. */
    public getClean(identifier: string): TRANSFER_SYNTAX | undefined {
        return this.get(cleanUID(identifier));
    }
}

export class TXTranslator {
    private static readonly map = new TX_Map();

    constructor(){
    }

    /** Nombre por coincidencia EXACTA del UID (antes se usaba includes() y "el ultimo que encaja"). */
    public static getName(identifier:string): string{
        const tx = TXTranslator.map.getClean(identifier);
        return (tx === undefined) ? 'Unknown TX' : TX_dictionary[tx][1];
    }

    /** Solo Implicit VR Little Endian (1.2.840.10008.1.2) es implicita. */
    public static isVRExplicit(identifier:string): boolean{
        return cleanUID(identifier) !== TX_dictionary[0][0];
    }

    public static isVREBigEndian(identifier:string): boolean{
        return cleanUID(identifier) === TX_dictionary[3][0];
    }
}
