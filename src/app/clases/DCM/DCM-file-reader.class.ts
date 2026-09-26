import { DataTranslator } from "../../dictionaries/data-tag-elements";
import { TXTranslator } from "../../dictionaries/transfer-syntaxes";
import { Functions } from "../Crosscutting/Functions";
import { DCMFile } from "./DCM-file.class";
import { DCMTag } from "./DCM-tag.class";

export const VR_OB = "OB";
export const VR_OW = "OW";
export const VR_SQ = "SQ";
export const VR_UN = "UN";

/**
 * VRs que en Explicit VR usan 2 bytes reservados + longitud de 4 bytes (PS3.5 7.1.2, tabla 7.1-1).
 * El resto de VRs usan longitud de 2 bytes.
 */
export const LONG_LENGTH_VRS = ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV'];
export const UNDEFINED_LENGTH = 0xFFFFFFFF;
/** Todas las VR de PS3.5 6.2: sirven para saber si un dataset con TS desconocida es de VR explícita. */
export const ALL_VRS = ['AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FD', 'FL', 'IS', 'LO', 'LT', 'OB', 'OD', 'OF', 'OL',
    'OV', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST', 'SV', 'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV'];

export class DCMFileReader {

    public get rawData(): string {
        return this.file.rawData;
    }
    public get fileName(): string {
        return this.file.file.name;
    }
    public get fileLength(): number {
        return this.file.file.size;
    }
    /** Fichero de origen (File original + rawData). Para subirlo tal cual: DicomObjectCodec.uploadBodyFor(). */
    public get sourceFile(): DCMFile {
        return this.file;
    }

    public uploaded: boolean = false;

    public SamplesPerPixel: number = 1;
    public Frames: number = 1;//If not found, at leas one
    public Rows: number = 0;
    public Columns: number = 0;
    public BitsAllocated: number = 0;
    public BitsStored: number = 0;
    public PixelRepresentation: number = 0;
    public TransferSyntax: string = '1.2.840.10008.1.2';
    public TransferSyntaxName: string = 'Implicit VR Endian';
    
    public isVRExplicit: boolean = true;
    /** Pixel Data en little endian. Igual que isLittleEndian salvo en la TS privada de GE (cabecera LE, píxeles BE). */
    public isPixelDataLittleEndian: boolean = true;
    /** TS privada o desconocida: la VR (explícita o implícita) se decide con el primer elemento del dataset. */
    private detectVR: boolean = false;
    public PlannarConfiguration = 0;
    public PhotometricInterpretation: string = '';
    public Modality: string = '';
    public PatientId: string = '';
    public PatientName: string = '';
    public PatientBDate: string = '19600101';
    public PatientSex: string = '';
    public StudyDate: string = '19780621';
    public SOPClass: string = '';
    public StudyInstanceUID: string = '';
    public StudyDescription: string = '';
    public SeriesInstanceUID: string = '';
    public SOPInstanceUID: string = '';
    public SeriesNumber: number = 0;
    public InstanceNumber: number = 0;
    public FrameTime: number = 0;
    public HighBit: number = 0;

    private forceLittleEndianForHeaderActive: boolean = true;
    private _isLittleEndian: boolean = true;
    public get isLittleEndian(): boolean {
        return this._isLittleEndian || this.forceLittleEndianForHeaderActive;
    }
    public set isLittleEndian(value: boolean) {
        this._isLittleEndian = value;
    }

    private current_position: number = 132;
    /** Profundidad de anidamiento (secuencias / Pixel Data encapsulado de longitud indefinida). 0 = dataset raiz. */
    private depth: number = 0;
    

    public last_readed_tag: DCMTag | undefined;

    public readed_tags: DCMTag[] = [];
    
    
    /** Bytes de un frame NATIVO (sin comprimir). Incluye SamplesPerPixel y el submuestreo de YBR_FULL_422. */
    public get FrameSize(): number {
        const pixels = this.Rows * this.Columns;
        const samples = Functions.clearDCMImpairValue(this.PhotometricInterpretation).trim() === 'YBR_FULL_422'
            ? 2 : this.SamplesPerPixel;
        if (this.BitsAllocated === 1) {
            return Math.ceil(pixels * samples / 8);
        }
        return (this.BitsAllocated >> 3) * pixels * samples;
    }

    constructor(private file: DCMFile) {
        this.readFile();
    }

    private readFile(): void {
        this.isLittleEndian = true;
        while (this.current_position < this.file.length) {
            this.readTag();
            if (this.last_readed_tag && (this.last_readed_tag.TagHigh != 0 || this.last_readed_tag.TagLow != 0)) {
                this.readed_tags.push(this.last_readed_tag);
                if (this.last_readed_tag.depth != 0) {
                    // Atributo anidado (Icon Image Sequence, Referenced..., functional groups...): no debe
                    // sobrescribir Rows/Columns/UIDs del dataset raiz. Queda en readed_tags para el interprete.
                    continue;
                }
                if (this.last_readed_tag.TagHigh == 0x28) {
                    if (this.last_readed_tag.TagLow == 2) {
                        this.SamplesPerPixel = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else if (this.last_readed_tag.TagLow == 6) {
                        this.PlannarConfiguration = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian); // US binario
                    } else if (this.last_readed_tag.TagLow == 4) {
                        this.PhotometricInterpretation = this.last_readed_tag.Value??'';
                    } else if (this.last_readed_tag.TagLow == 8) {                        
                        this.Frames = this.last_readed_tag.getValueAsNumString();
                    } else if (this.last_readed_tag.TagLow == 0x10) {
                        this.Rows = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else if (this.last_readed_tag.TagLow == 0x11) {
                        this.Columns = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else if (this.last_readed_tag.TagLow == 0x100) {
                        this.BitsAllocated = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else  if (this.last_readed_tag.TagLow == 0x101) {
                        this.BitsStored = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else  if (this.last_readed_tag.TagLow == 0x102) {
                        this.HighBit = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else  if (this.last_readed_tag.TagLow == 0x103) {
                        this.PixelRepresentation = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    }
                } else if (this.last_readed_tag.TagHigh == 2) {
                    if(this.last_readed_tag.TagLow == 0x02) {
                        this.SOPClass = Functions.clearDCMImpairValue(this.last_readed_tag.Value??'');
                    } else if(this.last_readed_tag.TagLow == 0x10) {
                        if (this.last_readed_tag.Value) {
                            this.TransferSyntax = this.last_readed_tag.Value;
                            const ts = this.TransferSyntax.trim();
                            this.TransferSyntaxName = TXTranslator.getName(ts);
                            this.isVRExplicit = TXTranslator.isVRExplicit(ts);
                            this.isLittleEndian = !TXTranslator.isVREBigEndian(ts);
                            this.isPixelDataLittleEndian = !TXTranslator.isPixelDataBigEndian(ts);
                            this.detectVR = !TXTranslator.isKnown(ts);
                        }
                    }
                } else if (this.last_readed_tag.TagHigh == 8) {
                    if(this.last_readed_tag.TagLow == 0x18) {
                        if (this.last_readed_tag.Value) {
                            this.SOPInstanceUID = this.last_readed_tag.Value;
                        }
                    } else if(this.last_readed_tag.TagLow == 0x20) {
                        if (this.last_readed_tag.Value) {
                            this.StudyDate = this.last_readed_tag.Value;
                        }
                    } else if(this.last_readed_tag.TagLow == 0x60) {
                      if (this.last_readed_tag.Value) {
                          this.Modality = this.last_readed_tag.Value??'';
                      }
                    } else if(this.last_readed_tag.TagLow == 0x1030) {
                      if (this.last_readed_tag.Value) {
                          this.StudyDescription = Functions.clearDCMImpairValue(this.last_readed_tag.Value??'').trim();
                      }
                    }
                } else if (this.last_readed_tag.TagHigh == 0x10) {
                    if(this.last_readed_tag.TagLow == 0x20) {
                        if (this.last_readed_tag.Value) {
                            this.PatientId = Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim();
                        }                      
                    }
                    if(this.last_readed_tag.TagLow == 0x10) {
                        if (this.last_readed_tag.Value) {
                            this.PatientName = Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim();
                        }                      
                    }
                    if(this.last_readed_tag.TagLow == 0x40) {
                      if (this.last_readed_tag.Value) {
                          this.PatientSex = Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim();
                      }                      
                    }
                    if(this.last_readed_tag.TagLow == 0x30) {
                      if (this.last_readed_tag.Value) {
                          this.PatientBDate = this.last_readed_tag.Value;
                      }                      
                    }
                } else if (this.last_readed_tag.TagHigh == 0x18) {
                    if(this.last_readed_tag.TagLow == 0x1063) {
                        if (this.last_readed_tag.Value) {
                            this.FrameTime = parseFloat(Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim()); // DS
                        }
                    }
                } else if (this.last_readed_tag.TagHigh == 0x20) {
                    if(this.last_readed_tag.TagLow == 0xD) {
                        if (this.last_readed_tag.Value) {
                            this.StudyInstanceUID = Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim();
                        }
                    } else if(this.last_readed_tag.TagLow == 0xE) {
                        if (this.last_readed_tag.Value) {
                            this.SeriesInstanceUID = Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim();
                        }
                    } else if(this.last_readed_tag.TagLow == 0x11) {
                        if (this.last_readed_tag.Value) {
                            this.SeriesNumber = parseInt(this.last_readed_tag.Value.trim());
                        }
                    } else if(this.last_readed_tag.TagLow == 0x13) {
                        if (this.last_readed_tag.Value) {
                            this.InstanceNumber = parseInt(this.last_readed_tag.Value.trim());
                        }
                    }
                }
            } else {
                break;
            }
        }
    }

    /**
     * Lee un Data Element en current_position.
     *
     *   Explicit VR, VR "corta" : TAG(4) VR(2) VL(2)            VALUE   -> cabecera 8
     *   Explicit VR, VR "larga" : TAG(4) VR(2) 0000(2) VL(4)    VALUE   -> cabecera 12  (LONG_LENGTH_VRS)
     *   Implicit VR             : TAG(4) VL(4)                  VALUE   -> cabecera 8   (VR del diccionario, solo informativa)
     *   Item / delimitadores    : FFFE,E000|E00D|E0DD VL(4)             -> cabecera 8   (nunca llevan VR)
     *
     * VL = 0xFFFFFFFF (longitud indefinida) en CUALQUIER elemento (SQ, UN, secuencia privada, Pixel Data encapsulado):
     * se deja VL = 0 y se "entra" (depth++), de modo que los items/fragmentos siguientes se leen como tags
     * consecutivos. (FFFE,E0DD) cierra ese nivel (depth--). Los SQ/items de longitud DEFINIDA se saltan enteros
     * (su contenido queda en Value).
     */
    private readTag(): void{
        try {
            const raw = this.file.rawData;
            const pos = this.current_position;
            const tag = new DCMTag();
            this.last_readed_tag = tag;

            //Read tag
            tag.setTag(raw.substring(pos, pos + 4), this.isLittleEndian);
            //If TX already readed, we know little/big endian. onece out of header tags 0x0002, TX rules. In header is Little endian always.
            if (this.forceLittleEndianForHeaderActive && tag.TagHigh != 0x02) {
                this.forceLittleEndianForHeaderActive = false;
                tag.setTag(raw.substring(pos, pos + 4), this.isLittleEndian);
                if (this.detectVR) {
                    // TS desconocida: explícita si tras el tag vienen dos letras que forman una VR. En implícita esos
                    // bytes son la parte baja de la longitud, y el primer elemento (grupo 0008) nunca mide tanto.
                    this.isVRExplicit = ALL_VRS.includes(raw.substring(pos + 4, pos + 6));
                    this.detectVR = false;
                }
            }

            let headerLength: number;
            if (tag.TagHigh == 0xFFFE) { //Item (E000), Item Delimitation (E00D), Sequence Delimitation (E0DD)
                tag.setVL32(raw.substring(pos + 4, pos + 8), this.isLittleEndian);
                if (tag.TagLow == 0xE000) {
                    tag.VR = VR_SQ;
                } else {
                    tag.VR = '';
                    tag.VL = 0;
                }
                headerLength = 8;
            } else if (tag.TagHigh == 2 || this.isVRExplicit) {
                tag.VR = raw.substring(pos + 4, pos + 6);
                if (LONG_LENGTH_VRS.includes(tag.VR)) {
                    tag.setVL32(raw.substring(pos + 8, pos + 12), this.isLittleEndian);
                    headerLength = 12;
                } else {
                    tag.setVL(raw.substring(pos + 6, pos + 8), this.isLittleEndian);
                    headerLength = 8;
                }
            } else {
                // Implicit VR: la VR sale del diccionario (solo informativa; la longitud siempre es de 4 bytes).
                tag.VR = DataTranslator.getVR(tag.TagHigh ?? 0, tag.TagLow ?? 0);
                tag.setVL32(raw.substring(pos + 4, pos + 8), this.isLittleEndian);
                headerLength = 8;
            }

            let undefinedLength = false;
            if (tag.VL == UNDEFINED_LENGTH) {
                tag.VL = 0;
                undefinedLength = true;
            } else if (tag.TagHigh == 0x7FE0 && tag.TagLow == 0x10 && this.depth == 0) {
                const suposedVL = (this.Rows * this.Columns * this.BitsAllocated * this.Frames * this.SamplesPerPixel) / 8;
                if (tag.VL != suposedVL) {
                    tag.WarningFlag = true;
                }
            }

            //Read Value
            tag.Value = raw.substring(pos + headerLength, pos + headerLength + (tag.VL ?? 0));

            //Nesting depth
            if (tag.TagHigh == 0xFFFE && tag.TagLow == 0xE0DD) {
                this.depth = Math.max(0, this.depth - 1);
            }
            tag.depth = this.depth;
            if (undefinedLength && tag.TagHigh != 0xFFFE) {
                this.depth++;
            }

            this.updateCurrentPosition(headerLength - 6);
        } catch (error) {
            this.last_readed_tag = undefined;
        }
    }

    private updateCurrentPosition(offset: number) {
        if (this.last_readed_tag) {
            this.last_readed_tag.position = this.current_position;
            this.last_readed_tag.dataOffset = 6 + offset;
            this.current_position += 6 + offset + (this.last_readed_tag.VL?this.last_readed_tag.VL:0);
        }
    }
}