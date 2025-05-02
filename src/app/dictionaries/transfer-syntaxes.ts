import { Functions } from "../clases/Crosscutting/Functions";

export const ImplicitVR = 'IMPLICIT';
export const ExplicitVR = 'EXPLICIT';
export const LittleEndinaVR = 'BIG_ENDIAN';
export const BigEndianVR = 'LITTLE_ENDIAN';

export const TX_dictionary = [
    ['1.2.840.10008.1.2','Implicit VR Endian'],
    ['1.2.840.10008.1.2.1','Explicit VR Little Endian'],
    ['1.2.840.10008.1.2.1.99','Deflated Explicit VR Little Endian'],
    ['1.2.840.10008.1.2.2','Explicit VR Big Endian'],
    ['1.2.840.10008.1.2.4.50','JPEG Baseline (Process 1)'],
    ['1.2.840.10008.1.2.4.51','JPEG Baseline (Processes 2 & 4)'],
    ['1.2.840.10008.1.2.4.52','JPEG Extended (Processes 3 & 5)'],
    ['1.2.840.10008.1.2.4.53','JPEG Spectral Selection, Nonhierarchical (Processes 6 & 8)'],
    ['1.2.840.10008.1.2.4.54','JPEG Spectral Selection, Nonhierarchical (Processes 7 & 9)'],
    ['1.2.840.10008.1.2.4.55','JPEG Full Progression, Nonhierarchical (Processes 10 & 12)'],
    ['1.2.840.10008.1.2.4.56','JPEG Full Progression, Nonhierarchical (Processes 11 & 13)'],
    ['1.2.840.10008.1.2.4.57','JPEG Lossless, Nonhierarchical (Processes 14)'],
    ['1.2.840.10008.1.2.4.58','JPEG Lossless, Nonhierarchical (Processes 15)'],
    ['1.2.840.10008.1.2.4.59','JPEG Extended, Hierarchical (Processes 16 & 18)'],
    ['1.2.840.10008.1.2.4.60','JPEG Extended, Hierarchical (Processes 17 & 19)'],
    ['1.2.840.10008.1.2.4.61','JPEG Spectral Selection, Hierarchical (Processes 20 & 22)'],
    ['1.2.840.10008.1.2.4.62','JPEG Spectral Selection, Hierarchical (Processes 21 & 23)'],
    ['1.2.840.10008.1.2.4.63','JPEG Full Progression, Hierarchical (Processes 24 & 26)'],
    ['1.2.840.10008.1.2.4.64','JPEG Full Progression, Hierarchical (Processes 25 & 27)'],
    ['1.2.840.10008.1.2.4.65','JPEG Lossless, Nonhierarchical (Process 28)'],
    ['1.2.840.10008.1.2.4.66','JPEG Lossless, Nonhierarchical (Process 29)'],
    ['1.2.840.10008.1.2.4.70','JPEG Lossless, Nonhierarchical, First- Order Prediction (Processes 14 [Selection Value 1])'],
    ['1.2.840.10008.1.2.4.80','JPEG-LS Lossless Image Compression'],
    ['1.2.840.10008.1.2.4.81','JPEG-LS Lossy (Near- Lossless) Image Compression'],
    ['1.2.840.10008.1.2.4.90','JPEG 2000 Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.91','JPEG 2000 Image Compression'],
    ['1.2.840.10008.1.2.4.92','JPEG 2000 Part 2 Multicomponent Image Compression (Lossless Only)'],
    ['1.2.840.10008.1.2.4.93','JPEG 2000 Part 2 Multicomponent Image Compression'],
    ['1.2.840.10008.1.2.4.94','JPIP Referenced'],
    ['1.2.840.10008.1.2.4.95','JPIP Referenced Deflate'],
    ['1.2.840.10008.1.2.5','RLE Lossless'],
    ['1.2.840.10008.1.2.6.1','RFC 2557 MIME Encapsulation'],
    ['1.2.840.10008.1.2.4.100','MPEG2 Main Profile Main Level'],
    ['1.2.840.10008.1.2.4.102','MPEG-4 AVC/H.264 High Profile / Level 4.1'],
    ['1.2.840.10008.1.2.4.103','MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1']
];

export enum TRANSFER_SYNTAX {
    Implicit_VR_Endian = 0,
    Explicit_VR_Little_Endian = 1,
    Deflated_Explicit_VR_Little_Endian = 2,
    Explicit_VR_Big_Endian = 3,
    JPEG_Baseline_Process_1 = 4,
    JPEG_Baseline_Process_2_4 = 5,
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
    MPEG_4_AVC_H_264_BD_compatible_High_Profile_Level_4_1 = 34
};

//TODO hacer un zingletone
export class TX_Map extends Map<string, TRANSFER_SYNTAX> {
    constructor() {
        super();
        for(let i = 0; i < TX_dictionary.length; i++) {
            let TX: TRANSFER_SYNTAX = i;
            this.set(TX_dictionary[i][0], TX);
        }
    }
}

export class TXTranslator {
    constructor(){
    }

    //Se repasa todos, así queda el más especializado.
    public static getName(identifier:string): string{
        let name = 'Unknown TX';
        for (let i = 0; i < TX_dictionary.length; i++) {
            //console.log('compare: ' + TX_dictionary[i][0] + ' with ' + identifier);
            if (identifier.includes(TX_dictionary[i][0], 0)) {
                name = TX_dictionary[i][1];
            }
        }
        return name;
    }

    public static isVRExplicit(identifier:string): boolean{
        let clean = Functions.clearDCMImpairValue(identifier);
        return !TX_dictionary[0][0].includes(clean, 0);
    }

    public static isVREBigEndian(identifier:string): boolean{
        let clean = Functions.clearDCMImpairValue(identifier);
        return clean.includes(TX_dictionary[3][0], 0);
    }
}