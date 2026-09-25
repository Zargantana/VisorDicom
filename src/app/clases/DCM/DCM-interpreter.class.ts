import { Functions } from "../Crosscutting/Functions";
import { DCMFileReader } from "./DCM-file-reader.class";
import { DCMTagBase } from "./DCM-tag-base.class";
import { DCMTag } from "./DCM-tag.class";

export class FoundDCMTag extends DCMTagBase {
    public DS_tag_position: number | undefined;
}

export class PaletteColorLookupTableDescriptorData {
    constructor(public entriesInLookupTable: number = 0,
        public firstInputValueMapped: number = 0,
        public bitsAlocados: number = 0) {}
}

export class PaletteColorLookupTableData {
    private table: Uint16Array | Uint8Array;

    constructor(private tableData: string, private descriptor: PaletteColorLookupTableDescriptorData, private isLittleEndian: boolean) {
        // PS3.3 C.7.6.3.1.5: bits por entrada 8 o 16. La LUT es OW: con 16 bits son palabras del endian del dataset.
        const bytes = this.descriptor.bitsAlocados > 8 ? 2 : 1;
        const entries = Math.floor(tableData.length / bytes);
        this.table = bytes == 2 ? new Uint16Array(entries) : new Uint8Array(entries);
        for (let i = 0; i < entries; i++) {
            this.table[i] = bytes == 2 ? this.read16BitsNumber(tableData.substring(i * 2), isLittleEndian) : tableData.charCodeAt(i);
        }
    }

    /** Devuelve el color (0..255) para un indice de pixel. Fuera de rango -> primera/ultima entrada (PS3.3 C.7.6.3.1.5). */
    public LookupForInputValue(pixelValue: number): number {
        let tableEntryPointer = pixelValue - this.descriptor.firstInputValueMapped;
        if (tableEntryPointer < 0) {
            tableEntryPointer = 0;
        } else if (tableEntryPointer >= this.table.length) {
            tableEntryPointer = this.table.length - 1;
        }
        const value = this.table[tableEntryPointer];
        return this.descriptor.bitsAlocados > 8 ? (value >> 8) : value;
    }

    private read16BitsNumber(raw: string, LE: boolean): number {
        return raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);        
    }
}

export const enum PaletteColorLookupTables {
    RED = 0,
    GREEN = 1,
    BLUE = 2
}


export const enum PhotometricInterpretationType {
  PALETTE_COLOR = 0,
  RGB = 1,
  MONOCHROME2 = 2,
  MONOCHROME1 = 3,
  YBR_FULL = 4,
  YBR_FULL_422 = 5
}

export class LUTInformation {
    public entries: number = 0;
    public firstStoredPixelValueMapped: number = 0;
    public bitPerEntry: number = 0;

    public LUTData: string = '';
}

export class VOIData {
    public VOIfunction: VOIFunction = VOIFunction.LINEAR;
    public WindowCenter: number[] = [];
    public WindowWidth: number[] = [];
    public WindowDescription: string[] = [];

    public LUT: LUTInformation = new LUTInformation();    
}

export const enum VOIFunction {
    LINEAR = 0,
    LINEAR_EXACT = 1,
    SIGMOID  = 2
}

export const VOI_FUNC_LINEAR = 'LINEAR';
export const VOI_FUNC_LINEAR_EXACT = 'LINEAR_EXACT';
export const VOI_FUNC_SIGMOID  = 'SIGMOID';

export const PALETTE_COLOR = "PALETTE_COLOR";
export const PALETTE_COLOR_PT1 = "PALETTE";
export const PALETTE_COLOR_PT2 = "COLOR";
export const MONOCHROME2 = "MONOCHROME2";
export const MONOCHROME1 = "MONOCHROME1";
export const YBR_FULL_422 = "YBR_FULL_422";
export const YBR_FULL = "YBR_FULL";

export class RescaleParameters {
    public Intercept: number = 0;
    public Slope: number = 1;
    public Type: string = '';
}

export class DCMInterpreter {
    private isLittleEndian: boolean;

    constructor(private reader: DCMFileReader) {
        this.isLittleEndian = this.reader.isLittleEndian;
    }

    public getRescaleParameters(): RescaleParameters {
        const rescale = new RescaleParameters();

        rescale.Intercept = this.getRescaleIntercept();
        rescale.Slope = this.getRescaleSlope();
        rescale.Type = this.getRescaleType();

        return rescale;
    }

    private getRescaleIntercept(): number {
        const interceptTag = this.searchTopLevelFirst(0x0028,0x1052);
        const value = this.parseDS(interceptTag?.Value)[0];
        return (value === undefined) ? 0 : value;
    }

    private getRescaleSlope(): number {
        const slopeTag = this.searchTopLevelFirst(0x0028,0x1053);
        const value = this.parseDS(slopeTag?.Value)[0];
        return (value === undefined || value === 0) ? 1 : value;
    }

    private getRescaleType(): string {
        const typeTag = this.searchTopLevelFirst(0x0028,0x1054);
        if (typeTag?.VL && typeTag.Value) {
            return Functions.clearDCMImpairValue(typeTag.Value);
        }
        return '';
    }

    public getPaletteColorLookupTables(): PaletteColorLookupTableData[] {
        const descriptors = this.getPaletteColorLookupTableDescriptorsData();
        const result: PaletteColorLookupTableData[] = [];
        for (let i = 0; i < 3; i++) {
            let paletteColorDataTag = this.searchTopLevelFirst(0x0028,0x1201 + i);
            if (paletteColorDataTag?.Value && descriptors[i]) {
                result.push( 
                    new PaletteColorLookupTableData(paletteColorDataTag.Value, descriptors[i], this.isLittleEndian));
            }
        }
        return result;
    }

    private getPaletteColorLookupTableDescriptorsData(): PaletteColorLookupTableDescriptorData[] {
        const result: PaletteColorLookupTableDescriptorData[] = [];
        for (let i = 0x1101; i < 0x1104; i++) {
            let paletteColorDescTag = this.searchTopLevelFirst(0x0028,i);
            if (paletteColorDescTag?.Value) {
                this.pushLookupDescriptor(result, paletteColorDescTag.Value);
            }
        }
        return result;
    }

    public getPhotometricInterpretation(): PhotometricInterpretationType {
        let photometricInterpretation = this.searchTopLevelFirst(0x0028,0x0004);
        if (photometricInterpretation?.Value) {
            if (photometricInterpretation.Value.includes(PALETTE_COLOR_PT1) &&
                photometricInterpretation.Value.includes(PALETTE_COLOR_PT2)) {
                return PhotometricInterpretationType.PALETTE_COLOR;
            }
            if (photometricInterpretation.Value.includes(MONOCHROME2)) {
                return PhotometricInterpretationType.MONOCHROME2;
            }
            if (photometricInterpretation.Value.includes(MONOCHROME1)) {
                return PhotometricInterpretationType.MONOCHROME1;
            }
            if (photometricInterpretation.Value.includes(YBR_FULL_422)) {
                return PhotometricInterpretationType.YBR_FULL_422;
            }
            if (photometricInterpretation.Value.includes(YBR_FULL)) {
                return PhotometricInterpretationType.YBR_FULL;
            }
        }
        
        return PhotometricInterpretationType.RGB;
    }

    public getVOIData(): VOIData {
        let result = new VOIData();

        result.WindowWidth = this.getWindowWidth();
        result.WindowCenter = this.getWindowCenter();
        result.WindowDescription = this.getWindowDescription();
        result.VOIfunction = this.getWindowVOIFunction();

        this.getLUTDescription(result.LUT);
        result.LUT.LUTData = this.getLUTData();

        return result;
    }

    private getWindowWidth(): number[] {
        return this.parseDS(this.searchTopLevelFirst(0x0028,0x1051)?.Value);
    }

    private getWindowCenter(): number[] {
        return this.parseDS(this.searchTopLevelFirst(0x0028,0x1050)?.Value);
    }

    private getWindowDescription(): string[] {
        let tag = this.searchTopLevelFirst(0x0028,0x1055);
        let values: string[] = [];
        if (tag && tag.Value) {
            values = Functions.clearDCMImpairValue(tag.Value).split('\\').map(v => v.trim());
        }
        return values;
    }

    private getWindowVOIFunction(): VOIFunction {
        let result = VOIFunction.LINEAR;
        let tag = this.searchTopLevelFirst(0x0028,0x1056);
        if (tag && tag.Value) {
            // LINEAR_EXACT contiene "LINEAR": hay que mirarlo antes.
            if (tag.Value.includes(VOI_FUNC_LINEAR_EXACT)) {
                result = VOIFunction.LINEAR_EXACT;
            } else if (tag.Value.includes(VOI_FUNC_SIGMOID)) {
                result = VOIFunction.SIGMOID;
            } else if (tag.Value.includes(VOI_FUNC_LINEAR)) {
                result = VOIFunction.LINEAR;
            }
        }
        return result;
    }

    /** Decimal String (DS) multivalor "40.5\\-600" -> [40.5, -600]. parseInt truncaba (slope 0.5 -> 0). */
    private parseDS(value: string | undefined): number[] {
        if (!value) {
            return [];
        }
        return Functions.clearDCMImpairValue(value).split('\\')
            .map(v => parseFloat(v.trim()))
            .filter(v => !isNaN(v));
    }

    private getLUTDescription(LUT: LUTInformation) {
        let tag = this.searchTopLevelFirst(0x0028,0x3002);
        if (tag && tag.Value) {
            LUT.entries = Functions.getValueAs2ByteNumber(tag.Value.substring(0,2), this.reader.isLittleEndian);
            LUT.firstStoredPixelValueMapped = Functions.getValueAs2ByteNumber(tag.Value.substring(2,4), this.reader.isLittleEndian);
            LUT.bitPerEntry = Functions.getValueAs2ByteNumber(tag.Value.substring(4,6), this.reader.isLittleEndian);
        }
    }

    private getLUTData(): string {
        let result: string = '';
        let tag = this.searchTopLevelFirst(0x0028,0x3006);
        if (tag && tag.Value) {
            result = tag.Value;
        }
        return result;
    }
    
    private pushLookupDescriptor(result: PaletteColorLookupTableDescriptorData[], paletteColorDescTagValue: string) {
        result.push(new PaletteColorLookupTableDescriptorData(
            this.read16BitsNumber(paletteColorDescTagValue, this.isLittleEndian),
            this.read16BitsNumber(paletteColorDescTagValue.substring(2), this.isLittleEndian),
            this.read16BitsNumber(paletteColorDescTagValue.substring(4), this.isLittleEndian)));
    }

    private read16BitsNumber(raw: string, LE: boolean): number {
        return raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);        
    }

    /**
     * Pixel Data (7FE0,0010) "en bruto":
     *  - nativo (VL definida): [Value]
     *  - encapsulado (VL indefinida): los items que le siguen, TAL CUAL: [BOT, frag1, frag2, ...]
     * Se prefiere el (7FE0,0010) del dataset raiz; si no lo hay (fichero raro) se usa la heuristica antigua:
     * de los dos primeros (p.ej. el de la Icon Image Sequence y el real) el mas grande.
     */
    public getPixelDatas(): string[] {
        const topLevel = this.findTopLevel(0x7FE0, 0x0010);
        if (topLevel) {
            return topLevel.VL ? [topLevel.Value ?? ''] : this.readDataStreamItems(topLevel);
        }
        let finalResults: string[] = [];
        let finalResultsLength: number = 0;

        let PixelDatas = [this.searchDCMTag(0x7FE0,0x0010)];
        PixelDatas.push(this.searchDCMTag(0x7FE0,0x0010, PixelDatas[0]?.DS_tag_position));
        for(let i = 0; i < PixelDatas.length; i++) {
            let results: string[] = [];
            let resultsLength = 0;
            let pixelData = PixelDatas[i];
            if (pixelData) {
                results = pixelData.VL ? [pixelData.Value??''] : this.readDataStreamItems(pixelData);
            }
            for(let j = 0; j < results.length; j++) {
                resultsLength += results[j].length;
            }
            if (resultsLength > finalResultsLength) {
                finalResultsLength = resultsLength;
                finalResults = results;
            }
        }
        return finalResults;
    }

    /** Frames de un Pixel Data NATIVO: se trocea por FrameSize (Rows*Cols*Samples*BitsAllocated/8). */
    public getFramesData(): string[] {
        let pixelData = this.getPixelDatas();
        if ((pixelData.length == 1)&&(this.reader.Frames > 1)) {
            return this.splitPixelDataIntoFrames(pixelData[0]);
        }
        return pixelData;
    }

    private splitPixelDataIntoFrames(pixelData: string): string[] {
        let framesData: string[] = [];
        for(let frame = 0; frame < this.reader.Frames; frame++) {
            const start: number = frame * this.reader.FrameSize;
            const end: number = start + this.reader.FrameSize;
            framesData.push(pixelData.substring(start, end));
        }
        return framesData;
    }

    /**
     * Frames de un Pixel Data ENCAPSULADO (PS3.5 A.4): exactamente un string (bitstream comprimido) por frame.
     *  - El primer item es SIEMPRE la Basic Offset Table (puede estar vacia) y se descarta.
     *  - 1 frame: se concatenan todos los fragmentos.
     *  - N frames y N fragmentos: 1 a 1.
     *  - N frames y mas fragmentos: se agrupan usando la BOT o, si esta vacia, la Extended Offset Table
     *    (7FE0,0001); si tampoco hay, cortando donde un fragmento empieza por un marcador de inicio de
     *    codestream (JPEG SOI FFD8 / JPEG 2000 SOC FF4F).
     */
    public getEncapsulatedFrames(): string[] {
        const items = this.getPixelDatas();
        if (items.length == 0) {
            return [];
        }
        const bot = items[0];
        const fragments = items.slice(1);
        const frames = Math.max(1, this.reader.Frames || 1);
        if (fragments.length == 0) {
            return [];
        }
        if (frames == 1) {
            return [fragments.join('')];
        }
        if (fragments.length == frames) {
            return fragments;
        }

        let offsets = this.readOffsetTable(bot, 4);
        if (offsets.length != frames) {
            offsets = this.readOffsetTable(this.searchTopLevelFirst(0x7FE0, 0x0001)?.Value ?? '', 8);
        }
        if (offsets.length == frames) {
            const result: string[] = new Array(frames).fill('');
            let fragmentStart = 0; // offset del primer byte del item (FFFE,E000) respecto al primer fragmento
            let frame = 0;
            for (const fragment of fragments) {
                while (frame + 1 < frames && fragmentStart >= offsets[frame + 1]) {
                    frame++;
                }
                result[frame] += fragment;
                fragmentStart += 8 + fragment.length;
            }
            return result;
        }

        const result: string[] = [];
        for (const fragment of fragments) {
            if (result.length == 0 || this.startsCodestream(fragment)) {
                result.push(fragment);
            } else {
                result[result.length - 1] += fragment;
            }
        }
        return result;
    }

    private readOffsetTable(table: string, bytesPerEntry: number): number[] {
        const result: number[] = [];
        for (let i = 0; i + bytesPerEntry <= table.length; i += bytesPerEntry) {
            let value = 0;
            for (let b = bytesPerEntry - 1; b >= 0; b--) { // encapsulado => siempre little endian
                value = value * 256 + table.charCodeAt(i + b);
            }
            result.push(value);
        }
        return result;
    }

    private startsCodestream(fragment: string): boolean {
        const b0 = fragment.charCodeAt(0), b1 = fragment.charCodeAt(1);
        return b0 == 0xFF && (b1 == 0xD8 || b1 == 0x4F);
    }

    /** Items (FFFE,E000) consecutivos que siguen al Pixel Data encapsulado: [BOT, frag1, ...]. */
    private readDataStreamItems(pixelData: FoundDCMTag): string[] {
        let items: string[] = [];
        let item;
        let lastFound = pixelData.DS_tag_position??0;
        while (item = this.searchDCMTag(0xFFFE,0xE000, lastFound)) {
            const currentPosition = item.DS_tag_position??0;
            if (currentPosition != (lastFound + 1)) {
                break; 
            }
            items.push(item.Value??'');
            lastFound = currentPosition;
        }
        return items;
    }

    /** Primer tag (High,Low) del dataset raiz (depth 0), o undefined. */
    private findTopLevel(High: number, Low: number): FoundDCMTag | undefined {
        const tags = this.reader.readed_tags;
        for (let i = 0; i < tags.length; i++) {
            const next = tags[i];
            if (next.TagHigh == High && next.TagLow == Low && next.depth == 0) {
                return { ...next, DS_tag_position: i };
            }
        }
        return undefined;
    }

    /** Busca primero en el dataset raiz y, si no esta, en cualquier nivel (p.ej. functional groups de Enhanced). */
    private searchTopLevelFirst(High: number, Low: number): FoundDCMTag | undefined {
        return this.findTopLevel(High, Low) ?? this.searchDCMTag(High, Low);
    }

    private searchDCMTag(High: number, Low: number, from: number = -1): FoundDCMTag | undefined {
        let next: DCMTag;
        let found: FoundDCMTag | undefined = undefined;

        for (let i = from + 1; i < this.reader.readed_tags.length; i++)
        {
            next = this.reader.readed_tags[i];
            if (next.TagHigh == High && next.TagLow == Low) {
                found = { ...next, DS_tag_position: i };
                break;
            }
        }
        return found;
    }   
}