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
    constructor(private tableData: string, private descriptor: PaletteColorLookupTableDescriptorData, private isLittleEndian: boolean) {
    }

    public LookupForInputValue(pixelValue: number): number {
        let workingPixVal = (pixelValue < this.descriptor.firstInputValueMapped)?this.descriptor.firstInputValueMapped:pixelValue;
        let alocatedTableEntryBytes = this.descriptor.bitsAlocados / 8;
        let tableEntries = this.tableData.length / alocatedTableEntryBytes;
        let tableEntryPointer = workingPixVal - this.descriptor.firstInputValueMapped;
        if (tableEntryPointer >= tableEntries) { 
            throw new Error('tableEntryPointer out of range');
        }
        let bitsShiftTo8BitValue = (alocatedTableEntryBytes - 1) * 8;
        return this.read16BitsNumber(
                this.tableData.substring(tableEntryPointer * alocatedTableEntryBytes), this.isLittleEndian) >> bitsShiftTo8BitValue;
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
  MONOCHROME1 = 3
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
        const interceptTag = this.searchDCMTag(0x0028,0x1052);
        if (interceptTag?.VL && interceptTag.Value) {
            return parseInt(interceptTag.Value);
        }
        return 0;
    }

    private getRescaleSlope(): number {
        const slopeTag = this.searchDCMTag(0x0028,0x1053);
        if (slopeTag?.VL && slopeTag.Value) {
            return parseInt(slopeTag.Value);
        }
        return 1;
    }

    private getRescaleType(): string {
        const typeTag = this.searchDCMTag(0x0028,0x1054);
        if (typeTag?.VL && typeTag.Value) {
            return Functions.clearDCMImpairValue(typeTag.Value);
        }
        return '';
    }

    public getPaletteColorLookupTables(): PaletteColorLookupTableData[] {
        const descriptors = this.getPaletteColorLookupTableDescriptorsData();
        const result: PaletteColorLookupTableData[] = [];
        for (let i = 0; i < 3; i++) {
            let paletteColorDataTag = this.searchDCMTag(0x0028,0x1201 + i);
            if (paletteColorDataTag?.Value) {
                result.push( 
                    new PaletteColorLookupTableData(paletteColorDataTag.Value, descriptors[i], this.isLittleEndian));
            }
        }
        return result;
    }

    private getPaletteColorLookupTableDescriptorsData(): PaletteColorLookupTableDescriptorData[] {
        const result: PaletteColorLookupTableDescriptorData[] = [];
        for (let i = 0x1101; i < 0x1104; i++) {
            let paletteColorDescTag = this.searchDCMTag(0x0028,i);
            if (paletteColorDescTag?.Value) {
                this.pushLookupDescriptor(result, paletteColorDescTag.Value);
            }
        }
        return result;
    }

    public getPhotometricInterpretation(): PhotometricInterpretationType {
        let photometricInterpretation = this.searchDCMTag(0x0028,0x0004);
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
        let tag = this.searchDCMTag(0x0028,0x1051);
        let result: number[] = [];
        if (tag && tag.Value) {
            let values: string[] = tag.Value.split('\\');
            for (let i = 0; i < values.length; i++) {
                result.push( parseInt(values[i], 10) );
            }
        }
        return result;
    }

    private getWindowCenter(): number[] {
        let tag = this.searchDCMTag(0x0028,0x1050);
        let result: number[] = [];
        if (tag && tag.Value) {
            let values: string[] = tag.Value.split('\\');
            for (let i = 0; i < values.length; i++) {
                result.push( parseInt(values[i], 10) );
            }
        }
        return result;
    }

    private getWindowDescription(): string[] {
        let tag = this.searchDCMTag(0x0028,0x1055);
        let values: string[] = [];
        if (tag && tag.Value) {
            values = tag.Value.split('\\');
        }
        return values;
    }

    private getWindowVOIFunction(): VOIFunction {
        let result = VOIFunction.LINEAR;
        let tag = this.searchDCMTag(0x0028,0x1056);
        if (tag && tag.Value) {
            if (tag.Value.includes(VOI_FUNC_LINEAR)) {
                result = VOIFunction.LINEAR;
            } else if (tag.Value.includes(VOI_FUNC_LINEAR_EXACT)) {
                result = VOIFunction.LINEAR_EXACT;
            } else if (tag.Value.includes(VOI_FUNC_SIGMOID)) {
                result = VOIFunction.SIGMOID;
            } 
        }
        return result;
    }

    private getLUTDescription(LUT: LUTInformation) {
        let tag = this.searchDCMTag(0x0028,0x3002);
        if (tag && tag.Value) {
            LUT.entries = Functions.getValueAs2ByteNumber(tag.Value.substring(0,2), this.reader.isLittleEndian);
            LUT.firstStoredPixelValueMapped = Functions.getValueAs2ByteNumber(tag.Value.substring(2,4), this.reader.isLittleEndian);
            LUT.bitPerEntry = Functions.getValueAs2ByteNumber(tag.Value.substring(4,6), this.reader.isLittleEndian);
        }
    }

    private getLUTData(): string {
        let result: string = '';
        let tag = this.searchDCMTag(0x0028,0x3006);
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

    public getPixelDatas(): string[] {
        let finalResults: string[] = [];
        let finalResultsLength: number = 0;

        let PixelDatas = [this.searchDCMTag(0x7FE0,0x0010)];
        PixelDatas.push(this.searchDCMTag(0x7FE0,0x0010, PixelDatas[0]?.DS_tag_position));
        //Dos pixels data. Trataremos uno por uno con try/catch y el mas grande que resulte se devuelve. Puede ser compuesto por múltiples sub campos(frames).
        for(let i = 0; i < PixelDatas.length; i++) {
            //Buscar los frames o en Value o en subTags.
            let results: string[] = [];
            let resultsLength = 0;
            let pixelData = PixelDatas[i];
            if (pixelData) {
                if (pixelData.VL) {
                    results = [pixelData.Value??''];
                } else {
                    results = this.readDataStreamFragments(pixelData);
                }
            }
            //Check who is bigger
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

    private readDataStreamFragments(pixelData: FoundDCMTag): string[] {
        let fragments: string[] = [];
        let item;
        let lastFound = pixelData.DS_tag_position??0;
        let currentPosition = 0;
        while (item = this.searchDCMTag(0xFFFE,0xE000, lastFound)) {// Multiframe
            currentPosition = item.DS_tag_position??0;
            if (currentPosition != (lastFound + 1)) {
                break; 
            }
            fragments.push(item.Value??'');// Discard first empty SQ start delimiter.
            lastFound = currentPosition;
        }
        if (this.reader.Frames == 1) { //Meake one xurro only
            let startAt: number = fragments.length;
            let megachunk = fragments[fragments.length - 1];
            
            for(let i = 0; i < (fragments.length - 1) ; i++) {// Discard first not empty but with who knows value to discard SQ start delimiter.
                if (fragments[i].length > 0xFF) {
                    megachunk = fragments[i];
                    startAt = i + 1;
                }
            }

            for(let i = startAt; i < fragments.length; i++) {
                megachunk += fragments[i];
            }
            fragments = [megachunk];
        }
        return fragments;
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