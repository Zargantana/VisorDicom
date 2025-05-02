import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';

@Component({
  selector: 'image-icon',
  templateUrl: './image-icon.component.html',
  styleUrls: ['./image-icon.component.scss']
})
export class ImageIconComponent implements OnInit {

  @ViewChild('imageIconDisplay')
  private imageIconDisplay: ElementRef<HTMLImageElement> | undefined;

  @Input() theDICOMFile: DCMFile | undefined;
  @Input() aReadedDICOMFile: DCMFileReader | undefined;

  private reader: DCMFileReader | undefined;
  private image: ImageDCM | undefined;

  constructor() { }

  ngOnInit(): void {
    setTimeout(() => this.showIcon(), 100); //imageIconDisplay will be defined
  }

  private showIcon() {
    if (this.imageIconDisplay) {
      this.reader = (this.theDICOMFile)?new DCMFileReader(this.theDICOMFile):this.aReadedDICOMFile;
      if (this.reader) {
        this.image = new ImageDCM(this.reader);
        this.image.paintImage(this.imageIconDisplay);
      }
    }    
  }

}
