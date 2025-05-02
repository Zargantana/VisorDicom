import { DataTranslator } from "../../dictionaries/data-tag-elements";
import { TXTranslator } from "../../dictionaries/transfer-syntaxes";
import { Functions } from "../Crosscutting/Functions";
import { DCMFile } from "./DCM-file.class";
import { DCMTag } from "./DCM-tag.class";

export const VR_OB = "OB";
export const VR_OW = "OW";
export const VR_SQ = "SQ";
export const VR_UN = "UN";

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

    private forceLittleEndianForHeaderActive: boolean = true;
    private _isLittleEndian: boolean = true;
    public get isLittleEndian(): boolean {
        return this._isLittleEndian || this.forceLittleEndianForHeaderActive;
    }
    public set isLittleEndian(value: boolean) {
        this._isLittleEndian = value;
    }

    private current_position: number = 132;
    

    public last_readed_tag: DCMTag | undefined;

    public readed_tags: DCMTag[] = [];
    
    
    public get FrameSize(): number {
        return (this.BitsAllocated >> 3) * this.Rows * this.Columns;
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
                if (this.last_readed_tag.TagHigh == 0x28) {
                    if (this.last_readed_tag.TagLow == 2) {
                        this.SamplesPerPixel = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    } else if (this.last_readed_tag.TagLow == 6) {
                        this.PlannarConfiguration = this.last_readed_tag.getValueAsNumString();
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
                    } else  if (this.last_readed_tag.TagLow == 0x103) {
                        this.PixelRepresentation = this.last_readed_tag.getValueAs2ByteNumber(this.isLittleEndian);
                    }
                } else if (this.last_readed_tag.TagHigh == 2) {
                    if(this.last_readed_tag.TagLow == 0x02) {
                        this.SOPClass = Functions.clearDCMImpairValue(this.last_readed_tag.Value??'');
                    } else if(this.last_readed_tag.TagLow == 0x10) {
                        if (this.last_readed_tag.Value) {
                            this.TransferSyntax = this.last_readed_tag.Value;
                            this.TransferSyntaxName = TXTranslator.getName(this.TransferSyntax.trim());
                            this.isVRExplicit = TXTranslator.isVRExplicit(this.TransferSyntax.trim());
                            this.isLittleEndian = !TXTranslator.isVREBigEndian(this.TransferSyntax.trim());
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
                            this.FrameTime = parseInt(Functions.clearDCMImpairValue(this.last_readed_tag.Value).trim());
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

    private readTag(): void{
        try {
            let offset = 0;
            this.last_readed_tag = new DCMTag();

            //Read tag
            this.last_readed_tag.setTag( 
                this.file.rawData.substring(this.current_position, this.current_position + 4),
                this.isLittleEndian); 
            //If TX already readed, we know little/big endian. onece out of header tags 0x0002, TX rules. In header is Little endian always.
            if (this.forceLittleEndianForHeaderActive && this.last_readed_tag.TagHigh != 0x02) {
                this.forceLittleEndianForHeaderActive = false;
                this.last_readed_tag.setTag( 
                    this.file.rawData.substring(this.current_position, this.current_position + 4),
                    this.isLittleEndian);
            }           

            //Read VR
            if (this.last_readed_tag.TagHigh == 2 || this.isVRExplicit) {
                this.last_readed_tag.VR = 
                    this.file.rawData.substring(this.current_position + 4, this.current_position + 6);
                offset += 2;
            } else {
                // Obtener el VR del tag de un diccionario.
                if (this.last_readed_tag.TagHigh && this.last_readed_tag.TagLow) {
                    this.last_readed_tag.VR = DataTranslator.getVR(
                        this.last_readed_tag.TagHigh, 
                        this.last_readed_tag.TagLow);
                    //console.log('ImplicitVR: ' + this.last_readed_tag.VR);
                }
            }
            
            //Read Length             
            if (this.last_readed_tag.TagHigh== 0xFFFE && this.last_readed_tag.TagLow == 0xE000) {//SQ Item 
                this.last_readed_tag.VR = VR_SQ;
                this.last_readed_tag.setVL32(
                    this.file.rawData.substring(
                        this.current_position + 4, 
                        this.current_position + 8), 
                    this.isLittleEndian);
                if (this.last_readed_tag.VL == 0xFFFFFFFF) {
                    this.last_readed_tag.VL = 0;
                }    
                offset = 2;            
            } else if (this.last_readed_tag.TagHigh== 0xFFFE && this.last_readed_tag.TagLow == 0xE00D) {//SQ Item Delimitation
                this.last_readed_tag.VR = '';
                this.last_readed_tag.VL = 0;
                offset = 2;
            } else if (this.last_readed_tag.TagHigh== 0xFFFE && this.last_readed_tag.TagLow == 0xE0DD) {//SQ Sequence Delimitation
                this.last_readed_tag.VR = '';
                this.last_readed_tag.VL = 0;
                offset = 2;
            } else if (this.last_readed_tag.TagHigh == 0x7FE0 && this.last_readed_tag.TagLow == 0x10) {//Trabajar la longitud de PixelData [00 00 08 00] PIX PIX PIX... Length [LL LH HL HH]
                let suposedVL = (this.Rows * this.Columns * this.BitsAllocated * this.Frames * this.SamplesPerPixel) / 8;
                if (this.last_readed_tag.VR == 'OB' || this.last_readed_tag.VR == 'OW') {
                    offset += 2;
                }
                this.last_readed_tag.setVL32(
                    this.file.rawData.substring(
                        this.current_position + 4 + offset, 
                        this.current_position + 8 + offset), 
                    this.isLittleEndian);
                if (this.last_readed_tag.VL == 0xFFFFFFFF) {
                    this.last_readed_tag.VL = 0;
                } else {
                    if (this.last_readed_tag.VL != suposedVL) {
                        this.last_readed_tag.WarningFlag = true;
                        //this.last_readed_tag.VL = suposedVL;
                    }                    
                }
                offset += 2;
                
            } else if (this.last_readed_tag.VR == VR_OW) {//Trabajar la longitud de un OW 00 00 [00 00 08 00] Length [LL LH HL HH]
                this.last_readed_tag.setVL32(
                    this.file.rawData.substring(
                        this.current_position + 6 + offset, 
                        this.current_position + 10 + offset), 
                    this.isLittleEndian);
                offset += 4;
            } else if (this.last_readed_tag.VR == VR_OB) {
                this.last_readed_tag.setVL32(
                    this.file.rawData.substring(
                        this.current_position + 6 + offset, 
                        this.current_position + 10 + offset), 
                    this.isLittleEndian);
                offset += 4;
            } else if (this.last_readed_tag.VR == VR_SQ) {//Trabajar los SQ length
                if ( this.isVRExplicit ) {
                    this.last_readed_tag.setVL32(
                        this.file.rawData.substring(
                            this.current_position + 6 + offset, 
                            this.current_position + 10 + offset), 
                        this.isLittleEndian);
                    offset += 4;                    
                } else {
                    this.last_readed_tag.setVL32(
                        this.file.rawData.substring(
                            this.current_position + 4 + offset, 
                            this.current_position + 8 + offset), 
                        this.isLittleEndian);
                    offset += 2;
                }
                if (this.last_readed_tag.VL == 0xFFFFFFFF) {//SQ Trabajar los undefined length
                    this.last_readed_tag.VL = 0;
                }                
            } else if (this.last_readed_tag.VR == VR_UN) {
                this.last_readed_tag.setVL32(
                    this.file.rawData.substring(
                        this.current_position + 6 + offset, 
                        this.current_position + 10 + offset), 
                    this.isLittleEndian);
                offset += 4;
            } else {
                if ( this.last_readed_tag.TagHigh == 2 || this.isVRExplicit ) {
                    this.last_readed_tag.setVL(
                        this.file.rawData.substring(
                            this.current_position + 4 + offset, 
                            this.current_position + 6 + offset), 
                        this.isLittleEndian);
                } else {
                    this.last_readed_tag.setVL32(
                        this.file.rawData.substring(
                            this.current_position + 4 + offset, 
                            this.current_position + 8 + offset), 
                        this.isLittleEndian);
                    offset +=2;
                }
            }

            //Read Value
            this.last_readed_tag.Value = 
                this.file.rawData.substring(
                    this.current_position + 6 + offset, 
                    this.current_position + 6 + offset + (this.last_readed_tag.VL?this.last_readed_tag.VL:0));
               
            this.updateCurrentPosition(offset);
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