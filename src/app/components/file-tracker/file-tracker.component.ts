import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { DCMFile, FILEREAD_STATUS } from 'src/app/clases/DCM/DCM-file.class';

export enum FILESTATUS {
  FILEFOUND = 0,
  READING_132 = 1,
  READING_FULL = 2,
  DCMFILE_READED = 3,
  FILE_READ_FAIL = 4,
  NOT_DICOM = 5
}

@Component({
  selector: 'file-tracker',
  templateUrl: './file-tracker.component.html',
  styleUrls: ['./file-tracker.component.scss']
})
export class FileTrackerComponent implements OnInit, OnDestroy {
  @Input() theDICOMFile: DCMFile | undefined;

  public FileState: FILESTATUS = FILESTATUS.FILEFOUND;

  private readStatusSubscription: Subscription | undefined;
  private isDCMSubscription: Subscription | undefined;
  private lengthSubscription: Subscription | undefined;

  private isDCM: boolean | null = null;
  private readStatus = FILEREAD_STATUS.NONE;
  
  public readed: number = 0;
  public readedpct: string = '0';

  constructor() {     
  }

  ngOnInit(): void {
    if (this.theDICOMFile) {
      
      this.readStatusSubscription = this.theDICOMFile.readStatusTrk$.subscribe({
        next: (status) => { this.trackFileState(status, this.isDCM); }
      });

      this.isDCMSubscription = this.theDICOMFile.isDCM$.subscribe({
        next: (isDCM) => { this.trackFileState(this.readStatus, isDCM); }
      })

      this.lengthSubscription = this.theDICOMFile.length$.subscribe({
        next: (readed) => { 
          this.readed = readed; 
          if (this.theDICOMFile && this.theDICOMFile.file) {
            this.readedpct = ((100 * readed) / this.theDICOMFile.file.size).toString();
          }
        }
      })

    }
  }

  ngOnDestroy(): void {
    this.readStatusSubscription?.unsubscribe();
    this.isDCMSubscription?.unsubscribe();
    this.lengthSubscription?.unsubscribe();
  }

  public get FILESTATUS() {
    return FILESTATUS;
  }

  private trackFileState(status: FILEREAD_STATUS, isDCM: boolean | null) {
    this.readStatus = status; 
    this.isDCM = isDCM;

    let state = FILESTATUS.NOT_DICOM; //(!DCMFile.isDCM) readed first 132 bytes and discarded as a DCM, is other kinda file
    
    if (isDCM == null) { //leyendo o para empezar a leer los primeros 132 bytes
      this.FileState = FILESTATUS.READING_132;
    } else if (isDCM) {
      switch (status) {
        case FILEREAD_STATUS.NONE: { //reading full DICOM qualified file bytes from first 132 ones.
          this.FileState = FILESTATUS.READING_FULL;
          break;
        }
        case FILEREAD_STATUS.SUCCESS: { //Success reading full DICOM qualified file
          this.FileState = FILESTATUS.DCMFILE_READED;
          break;
        } 
        case FILEREAD_STATUS.ERROR:
        case FILEREAD_STATUS.ABORT:
        default: {
          this.FileState = FILESTATUS.FILE_READ_FAIL;
        }
      }
    }    

    this.FileState = state;    
  }


  //(DCMFile.isDCM == null) leyendo o para empezar a leer los primeros 132 bytes
  //(!DCMFile.isDCM) readed first 132 bytes and discarded as a DCM, is other kinda file
  //(DCMFile.isDCM) && (!DCMFile.readStatus) /*because FILEREAD_STATUS.NONE = 0*/ reading full DICOM qualified file bytes from first 132 ones.
  //(DCMFile.isDCM) && (DCMFile.readStatus) Error/Abort/Success reading full DICOM qualified file
}
