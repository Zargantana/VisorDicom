import { DataTranslator } from "../../dictionaries/data-tag-elements";
import { TXTranslator } from "../../dictionaries/transfer-syntaxes";
import { Functions } from "../Crosscutting/Functions";
import { DicomCharset } from "./DCM-charset.class";
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
    public SeriesDescription: string = '';
    public SOPInstanceUID: string = '';
    public SeriesNumber: number = 0;
    public InstanceNumber: number = 0;
    public FrameTime: number = 0;
    public HighBit: number = 0;
    /** Specific Character Set (0008,0005) del dataset raíz, ya normalizado (DicomCharset.parse). [] = repertorio básico. */
    public SpecificCharacterSet: string[] = [];
    /** Sin File Meta Information (ACR-NEMA, datasets crudos): la TS se ha deducido de los primeros elementos. */
    public noFileMeta: boolean = false;
    /** Grupo 0002 en VR explícita, como manda PS3.10; algunos datasets de MESA lo escriben en implícita. */
    private metaExplicit: boolean = true;

    private forceLittleEndianForHeaderActive: boolean = true;
    private _isLittleEndian: boolean = true;
    public get isLittleEndian(): boolean {
        return this._isLittleEndian || this.forceLittleEndianForHeaderActive;
    }
    public set isLittleEndian(value: boolean) {
        this._isLittleEndian = value;
    }

    private current_position: number = 132;
    /** Profundidad de anidamiento (secuencias e items, Pixel Data encapsulado). 0 = dataset raiz. */
    private depth: number = 0;
    /**
     * Contenedores abiertos: secuencias e items (de longitud definida, con `end` = posicion donde acaban, o
     * indefinida, `end` = Infinity, que cierra su delimitador) y el Pixel Data encapsulado (sus items son fragmentos
     * binarios, no datasets).
     */
    private containers: { end: number; kind: 'sq' | 'item' | 'pixel' }[] = [];
    /** Cache de los Per-Frame Functional Groups (DCMInterpreter.getPerFrameGroups). undefined = sin calcular. */
    public perFrameGroupsCache: any = undefined;


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

    /**
     * Pixel Data (7FE0,0010) del dataset raiz: donde empieza su valor en el fichero y cuanto mide (null = encapsulado,
     * longitud indefinida). null si el fichero no tiene Pixel Data. Con DCMFile.partial el valor no esta en rawData:
     * se lee por rangos (ver PixelDataAccess).
     */
    public get pixelDataInfo(): { valueOffset: number; length: number | null; vr: string } | null {
        const tag = this.readed_tags.find(t => t.TagHigh == 0x7FE0 && t.TagLow == 0x0010 && t.depth == 0);
        if (!tag || tag.position === undefined || tag.dataOffset === undefined) {
            return null;
        }
        return { valueOffset: tag.position + tag.dataOffset, length: tag.undefinedLength ? null : (tag.VL ?? 0), vr: (tag.VR ?? '').trim() };
    }

    /**
     * Dónde empieza y cómo va codificado lo primero que se lee. Con preámbulo, en 132 y como siempre. Sin preámbulo
     * (DCMFile.datasetOffset), en 0 o en 4; si no hay grupo 0002, la TS sale de los propios elementos: Implicit VR LE
     * (lo habitual en ACR-NEMA), Explicit VR LE o Explicit VR Big Endian.
     */
    private startDataset(): void {
        const raw = this.file.rawData;
        const start = DCMFile.datasetOffset(raw) ?? 132;
        this.current_position = start;
        const enc = DCMFile.sniffDataset(raw, start);
        if (!enc) {
            return;
        }
        const firstGroup = enc.littleEndian
            ? raw.charCodeAt(start) | (raw.charCodeAt(start + 1) << 8)
            : (raw.charCodeAt(start) << 8) | raw.charCodeAt(start + 1);
        if (firstGroup == 0x0002) {
            this.metaExplicit = enc.explicit;
            if (!enc.littleEndian) { // grupo 0002 en Big Endian (ficheros mal escritos)
                this.isLittleEndian = false;
                this.forceLittleEndianForHeaderActive = false;
            }
            return;
        }
        if (start == 132) {
            return; // preámbulo sin grupo 0002: se sigue como antes (detección de VR en el primer elemento)
        }
        this.noFileMeta = true;
        this.isVRExplicit = enc.explicit;
        this.isLittleEndian = enc.littleEndian;
        this.isPixelDataLittleEndian = enc.littleEndian;
        this.forceLittleEndianForHeaderActive = false;
        this.TransferSyntax = !enc.explicit ? '1.2.840.10008.1.2' : (enc.littleEndian ? '1.2.840.10008.1.2.1' : '1.2.840.10008.1.2.2');
        this.TransferSyntaxName = TXTranslator.getName(this.TransferSyntax);
    }

    private readFile(): void {
        this.isLittleEndian = true;
        this.startDataset();
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
                    if(this.last_readed_tag.TagLow == 0x05) {
                        this.SpecificCharacterSet = DicomCharset.parse(this.last_readed_tag.Value);
                    } else if(this.last_readed_tag.TagLow == 0x16) {
                        // SOP Class UID del dataset: manda el del grupo 0002 (Media Storage), pero sin él (ficheros sin
                        // File Meta Information) es el único que hay
                        if (!this.SOPClass && this.last_readed_tag.Value) {
                            this.SOPClass = Functions.clearDCMImpairValue(this.last_readed_tag.Value);
                        }
                    } else if(this.last_readed_tag.TagLow == 0x18) {
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
                          this.StudyDescription = this.last_readed_tag.Value; // texto: se decodifica al final (decodeTexts)
                      }
                    } else if(this.last_readed_tag.TagLow == 0x103E) {
                      if (this.last_readed_tag.Value) {
                          this.SeriesDescription = this.last_readed_tag.Value;
                      }
                    }
                } else if (this.last_readed_tag.TagHigh == 0x10) {
                    if(this.last_readed_tag.TagLow == 0x20) {
                        if (this.last_readed_tag.Value) {
                            this.PatientId = this.last_readed_tag.Value;
                        }
                    }
                    if(this.last_readed_tag.TagLow == 0x10) {
                        if (this.last_readed_tag.Value) {
                            this.PatientName = this.last_readed_tag.Value;
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
        this.decodeTexts();
    }

    /**
     * Textos que enseña el visor, decodificados con (0008,0005) cuando ya se ha leído todo el dataset (no depende del
     * orden de las etiquetas). El relleno (espacios, NUL) se quita de los bytes ANTES de decodificar: un trim() sobre el
     * binary string se comería bytes 0x85 o 0xA0 que en UTF-8 son parte de una letra ("Å", "à").
     */
    private decodeTexts(): void {
        this.PatientName = this.text(this.PatientName, true);
        this.PatientId = this.text(this.PatientId);
        this.StudyDescription = this.text(this.StudyDescription);
        this.SeriesDescription = this.text(this.SeriesDescription);
    }

    /**
     * Valor de texto del dataset (binary string) -> texto Unicode sin relleno. En los nombres (PN) sobran los "="
     * finales: "Wang^XiaoDong=王^小東=" (grupo fonético vacío) es el mismo nombre que sin él (PS3.5 6.2.1).
     */
    public text(raw: string | undefined | null, isPN: boolean = false): string {
        const unpadded = (raw ?? '').replace(/^[ \0]+|[ \0]+$/g, '');
        const value = DicomCharset.decode(unpadded, this.SpecificCharacterSet, isPN).replace(/\0/g, '').trim();
        return isPN ? value.replace(/=+$/, '').trim() : value;
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
     * consecutivos. (FFFE,E0DD) cierra ese nivel (depth--). Las SQ y los items de longitud DEFINIDA tambien se
     * recorren por dentro (antes se saltaban enteros y los functional groups de los multiframe mejorados de Siemens
     * o Toshiba, que van con longitud definida, eran invisibles): se apuntan en `containers` con la posicion donde
     * acaban y se cierran al llegar a ella. Excepcion: los items del Pixel Data encapsulado son fragmentos binarios.
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
                const looksExplicit = ALL_VRS.includes(raw.substring(pos + 4, pos + 6));
                if (this.detectVR) {
                    // TS desconocida: explícita si tras el tag vienen dos letras que forman una VR. En implícita esos
                    // bytes son la parte baja de la longitud, y el primer elemento (grupo 0008) nunca mide tanto.
                    this.isVRExplicit = looksExplicit;
                    this.detectVR = false;
                } else if (this.isVRExplicit && !looksExplicit) {
                    // La cabecera dice Explicit VR pero el dataset va en Implicit VR (ficheros mal escritos que
                    // pydicom y DCMTK también toleran): se lee como implícita.
                    console.warn('La Transfer Syntax es Explicit VR pero el dataset es Implicit VR: se lee como Implicit VR.');
                    this.isVRExplicit = false;
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
            } else if (tag.TagHigh == 2 ? this.metaExplicit : this.isVRExplicit) {
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

            const isItem = tag.TagHigh == 0xFFFE && tag.TagLow == 0xE000;
            const isPixelData = tag.TagHigh == 0x7FE0 && tag.TagLow == 0x10;
            const top = this.containers.length ? this.containers[this.containers.length - 1] : undefined;
            let undefinedLength = false;
            let descend = false; // contenedor de longitud definida: su contenido se lee como tags anidados
            if (tag.VL == UNDEFINED_LENGTH) {
                tag.VL = 0;
                undefinedLength = true;
                tag.undefinedLength = true;
            } else if (isItem) {
                descend = (tag.VL ?? 0) > 0 && top?.kind != 'pixel'; // dentro del Pixel Data, un item es un fragmento
            } else if (tag.TagHigh != 0xFFFE && tag.VR == VR_SQ && (tag.VL ?? 0) > 0) {
                descend = true;
            } else if (isPixelData && this.depth == 0) {
                const suposedVL = (this.Rows * this.Columns * this.BitsAllocated * this.Frames * this.SamplesPerPixel) / 8;
                if (tag.VL != suposedVL) {
                    tag.WarningFlag = true;
                }
            }

            //Read Value
            if (descend) {
                this.containers.push({ end: pos + headerLength + (tag.VL ?? 0), kind: isItem ? 'item' : 'sq' });
                tag.Value = '';
                tag.VL = 0; // solo se avanza la cabecera: lo de dentro son Data Elements
            } else {
                tag.Value = raw.substring(pos + headerLength, pos + headerLength + (tag.VL ?? 0));
            }

            //Nesting depth
            if (tag.TagHigh == 0xFFFE && tag.TagLow == 0xE0DD) {
                this.closeUndefinedContainer();
            }
            tag.depth = this.depth;
            if (undefinedLength && tag.TagHigh != 0xFFFE) {
                this.depth++;
                this.containers.push({ end: Infinity, kind: isPixelData ? 'pixel' : 'sq' });
            } else if (descend && !isItem) {
                this.depth++;
            }

            this.updateCurrentPosition(headerLength - 6);

            // Contenedores de longitud definida ya consumidos
            while (this.containers.length && this.containers[this.containers.length - 1].end <= this.current_position) {
                if (this.containers.pop()!.kind == 'sq') {
                    this.depth = Math.max(0, this.depth - 1);
                }
            }
        } catch (error) {
            this.last_readed_tag = undefined;
        }
    }

    /** (FFFE,E0DD): cierra la secuencia (o el Pixel Data encapsulado) de longitud indefinida abierta mas cercana. */
    private closeUndefinedContainer(): void {
        while (this.containers.length) {
            const c = this.containers.pop()!;
            if (c.kind != 'item') {
                this.depth = Math.max(0, this.depth - 1);
            }
            if (c.end === Infinity) {
                return;
            }
        }
        this.depth = Math.max(0, this.depth - 1); // delimitador suelto (fichero mal escrito): como antes
    }

    private updateCurrentPosition(offset: number) {
        if (this.last_readed_tag) {
            this.last_readed_tag.position = this.current_position;
            this.last_readed_tag.dataOffset = 6 + offset;
            this.current_position += 6 + offset + (this.last_readed_tag.VL?this.last_readed_tag.VL:0);
        }
    }
}