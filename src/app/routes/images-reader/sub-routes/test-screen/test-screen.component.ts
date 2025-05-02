import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { ColorFactory } from 'src/app/clases/Color/color-factory.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { DCMTag } from 'src/app/clases/DCM/DCM-tag.class';
import { UIDCMTag } from 'src/app/clases/DCM/UI-DCM-tag.class';
import { JPEGLosslessDecoder } from 'src/app/clases/Decoders/JPEG-Lossless-decoder.class';
import { RLEDecoder } from 'src/app/clases/Decoders/RLE-decoder.class';
import { UncompressedDecoder } from 'src/app/clases/Decoders/Uncompressed-decoder.class';
import { DataTranslator } from 'src/app/dictionaries/data-tag-elements';
import { AnticrawlerSecrets } from 'src/app/clases/Crosscutting/Anticrawler-secrets';

@Component({
  selector: 'app-test-screen',
  templateUrl: './test-screen.component.html',
  styleUrls: ['./test-screen.component.scss']
})
export class TestScreenComponent implements OnInit {
  
  @ViewChild('dropbox')
  private dropbox: ElementRef<HTMLDivElement> | undefined;

  @ViewChild('imageDisplay')
  private imageDisplay: ElementRef<HTMLImageElement> | undefined;

  @ViewChild('toXorr')
  private toXorr: ElementRef<HTMLInputElement> | undefined;

  public reader: DCMFileReader | undefined;
  private readedTags$: Observable<DCMTag> | undefined;
  private readedTagsSubscription: Subscription | undefined;
  public UIReadedTags: UIDCMTag[] = [];

  private viewingFrame: number = 0;

  private foundFiles: DCMFile[] = [];

  ngOnInit(): void {
    this.addListeners();
  }

  public context: CanvasRenderingContext2D | null | undefined;

  public OnClick() {
    this.readDICOMFile();
  }

  public OnClickRLE() {    
    if (this.reader) {
      let deco = new RLEDecoder(this.reader);
      let rawFrames = deco.Decode();
      this.createImageData(rawFrames[this.viewingFrame++]);
      this.viewingFrame %= this.reader.Frames;
    }
  }

  public OnClickJPEG() {    
    if (this.reader) {
      let deco = new JPEGLosslessDecoder(this.reader);
      let rawFrames = deco.Decode();
      this.createImageData(rawFrames[this.viewingFrame++]);
      this.viewingFrame %= this.reader.Frames;
    }
  }

  public OnClickUncompressed() {
    if (this.reader) {
      let deco = new UncompressedDecoder(this.reader);
      let rawFrames = deco.Decode();
      this.createImageData(rawFrames[this.viewingFrame++]);
      this.viewingFrame %= this.reader.Frames;
    }
  }

  public OnClickDeXorr() {
    let encrypted = AnticrawlerSecrets.getStringValue('toEncrypt');
    if (this.toXorr) {
      let output: number[] = [];
      let values = encrypted?.split('');
      values?.forEach((leter) => output.push(leter.charCodeAt(0)));
      console.log(output);
      //this.toXorr.nativeElement.value = encrypted;
    }
    
    
  }

  //TODO: JPEG Baseline process 1 -> buscar JPEG turbo npm

  private createImageData(frame: string): void {
    if (this.reader) {

      var canvas = document.createElement("canvas");
      canvas.width = this.reader.Columns;
      canvas.height = this.reader.Rows;
      var ctx = canvas.getContext("2d");
      if (ctx)
      {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, this.reader.Columns, this.reader.Rows);
        
        let result: ImageData = ctx.getImageData(0, 0, this.reader.Columns, this.reader.Rows);
        let data: Uint8ClampedArray = result.data;
        //TODO: Factory de interprete de color segun Photometric Interpretation 0028,0004
        let colorFractory = new ColorFactory(this.reader);
        colorFractory.pixelDataTo32BitBuffer(data, frame);
        
        ctx.putImageData(result, 0, 0); 
      }

      /* var img = document.createElement("img");
      img.src = canvas.toDataURL("image/png"); */

      if (this.imageDisplay) {
        this.imageDisplay.nativeElement.src = canvas.toDataURL("image/png");
      }
    }
  }

  private readDICOMFile(): void {
    if (this.foundFiles.length && this.foundFiles[0].isDCM) {
      this.clearFromLastReadResult();    
      //this.foundFiles[0].rawData =  utf8ToAnsi(this.foundFiles[0].rawData);
      this.reader = new DCMFileReader(this.foundFiles[0]);
      this.generateUIDCMTags();
    } 
  }

  private generateUIDCMTags(): void {
    this.readedTags$ = of(...(this.reader?.readed_tags || []));
    this.readedTagsSubscription = this.readedTags$.subscribe({            
      next: tag => {
        const func = (TagHigh: number, TagLow: number) => DataTranslator.getName(TagHigh, TagLow);
        const UITag: UIDCMTag = {...tag, getName: func};
        UITag.Value = (tag.VL && tag.VL > 500)?'[BIG]':tag.Value;
        this.UIReadedTags.push(UITag);
      }
    });
  }

  private clearFromLastReadResult(): void {
    this.UIReadedTags = [];
    this.readedTagsSubscription?.unsubscribe();
    this.readedTags$ = undefined;
  }

  private addListeners(): void {
    if (this.dropbox) {
      this.dropbox.nativeElement.addEventListener("dragenter", this.dragenter, false);
      this.dropbox.nativeElement.addEventListener("dragover", this.dragover, false);
      this.dropbox.nativeElement.addEventListener("dragend", this.drop, false);
    }

  }

  public dragenter(e: any) {
    e.stopPropagation();
    e.preventDefault();
  }
  
  public dragover(e: any) {
    e.stopPropagation();
    e.preventDefault();
  }

  public drop(e: any) {
    e.stopPropagation();
    e.preventDefault();
  
    const dt = e.dataTransfer;
    const files = dt.files;
  
    //TODO: handleFiles(files);
  }

  public onFileSelected(event: any): void {
    const file:File = event.target.files[0];

    if (file) {
        this.foundFiles = [new DCMFile(file)];
        this.foundFiles[0].readContents();
    }
  }

  public onDirectorySelected(event: any): void {
    this.foundFiles = [];
    for (const file of event.target.files) {
      let item = file.webkitRelativePath;
      //const path = file.webkitRelativePath.split('/');
      console.log('File: ' + item);
      const dicomFile = new DCMFile(file);
      dicomFile.readContents();
      this.foundFiles.push(dicomFile);
    };
  }

}

export enum FILE_READER_READY_STATE {
    EMPTY = 0, //Reader has been created. None of the read methods called yet.
    LOADING = 1, //A read method has been called.
    DONE = 2 //The operation is complete.
  }