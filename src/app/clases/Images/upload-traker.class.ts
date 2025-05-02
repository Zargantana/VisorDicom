import { ElementRef } from "@angular/core";
import { of, Observable } from "rxjs";
import { TRANSFER_SYNTAX, TX_Map } from "src/app/dictionaries/transfer-syntaxes";
import { ColorFactory } from "../Color/color-factory.class";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { BaseDecoder } from "../Decoders/base-decoder-class";
import { JPEG2000Decoder } from "../Decoders/JPEG-2000-decoder.class";
import { JPEGBaselineDecoder } from "../Decoders/JPEG-Baseline-decoder.class";
import { JPEGLosslessDecoder } from "../Decoders/JPEG-Lossless-decoder.class";
import { JPEGLSDecoder } from "../Decoders/JPEG-LS-decoder.class";
import { RLEDecoder } from "../Decoders/RLE-decoder.class";
import { UncompressedDecoder } from "../Decoders/Uncompressed-decoder.class";

export enum TRACK_FILE_STATUS {
  NONE = 0,
  UPLOADING = 1,
  UPLOADED = 2,
  PUBLISHED = 3,
  ERROR = 99
}

export class UploadTraker  {

  private _status = TRACK_FILE_STATUS.NONE;

  public Status$: Observable<TRACK_FILE_STATUS> = of(this._status);
  public progressPCT: number = 0;
  
  public set Status(value : TRACK_FILE_STATUS) {
    this._status = value;
    if (value == TRACK_FILE_STATUS.PUBLISHED) {
      this.reader.uploaded = true;
    }
  } 

  public get Status() {
    return this._status;
  } 

  constructor(public reader: DCMFileReader) {
  }
}