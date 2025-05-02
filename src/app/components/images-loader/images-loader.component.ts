import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { DCMFile, FILEREAD_STATUS } from 'src/app/clases/DCM/DCM-file.class';

@Component({
  selector: 'images-loader',
  templateUrl: './images-loader.component.html',
  styleUrls: ['./images-loader.component.scss']
})
export class ImagesLoaderComponent {
  public foundFiles: DCMFile[] = [];
  @Input() foundDCMFiles: DCMFile[] | undefined;
  @Output() someDCMFound = new EventEmitter<boolean>();
  @Output() readingNewFile = new EventEmitter<boolean>();
  @Output() fileReadEnd = new EventEmitter<FILEREAD_STATUS>();
  @Output() allFilesReaded = new EventEmitter<boolean>();
  
  private foundFilesSubscriptions: Subscription[] = [];
  
  public totalFiles: number = 0;
  public readingFiles: number = 0;
  public readEndedFiles: number = 0;

  public AllDone = true;

  constructor() { }

  public get FILEREAD_STATUS() {
    return FILEREAD_STATUS;
  }

  public onSelected(event: any): void {
    this.resetReadStatus();
    this.totalFiles = event.target.files.length;

    for (let numFile = 0; numFile < event.target.files.length; numFile++) {
      const file:File = event.target.files[numFile];
      setTimeout(() => {
        if (file) {
          //console.log('File: ' + file.webkitRelativePath);
          const theDCMFile = new DCMFile(file);
          const numFile = this.foundFiles.length;
          this.foundFiles.push(theDCMFile);
          this.foundFilesSubscriptions.push(
            theDCMFile.readStatus$.subscribe({
              next: (status: FILEREAD_STATUS) => {
                this.checkReadyToInterpretDCMTags(status, numFile);
              }
            })
          );
          this.readingNewFile.emit(true);
          this.readingFiles++;
          theDCMFile.readContents();
        }
      }, 100);
    }    
  }

  private resetReadStatus() {
    for (let i = 0; i < this.foundFilesSubscriptions.length; i++) {
      this.foundFilesSubscriptions[i].unsubscribe();
    }
    this.AllDone = false;
    this.readingFiles = 0;
    this.readEndedFiles = 0;
    this.foundFilesSubscriptions = [];
    this.foundFiles = [];
    if (this.foundDCMFiles) {
      this.foundDCMFiles.length = 0;
    }
  }

  private checkReadyToInterpretDCMTags(status: FILEREAD_STATUS, imageNumber: number) {
    if (status == FILEREAD_STATUS.SUCCESS) {
      this.fileReadEnd.emit(status);
      this.readEndedFiles++;
      if (this.foundFiles[imageNumber].isDCM) {        
        this.foundDCMFiles?.push(this.foundFiles[imageNumber]);
        this.someDCMFound.emit(true);
      } 
    } else if (status == FILEREAD_STATUS.ABORT || status == FILEREAD_STATUS.ERROR) {
      this.fileReadEnd.emit(status);
      this.readEndedFiles++;
    }
    if (this.totalFiles == this.readEndedFiles) {
      this.AllDone = true;
      this.allFilesReaded.emit(true);
    }
  }
}

