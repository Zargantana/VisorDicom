import { Observable } from "rxjs";

export const DICOM_LABEL = "DICM";
export const VR_UL = "UL";
export const LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE = 2; //BE = 0

export enum FILEREAD_STATUS {
    NONE = 0,
    SUCCESS = 1,
    ERROR = 2,
    ABORT = 3
}

export class DCMFile {

    // public static HIGH_PRIOR = 0;

    private freader: FileReader;
    private readStatusSubscriber: any;
    private readStatusTrkSubscriber: any;
    private isDCMSubscriber: any;
    private lengthSubscriber: any;

    public readStatus$: Observable<FILEREAD_STATUS> = new Observable<FILEREAD_STATUS>((subscriber) => {
        this.readStatusSubscriber = subscriber;
        subscriber.next(FILEREAD_STATUS.NONE);
    });
    public readStatusTrk$: Observable<FILEREAD_STATUS> = new Observable<FILEREAD_STATUS>((subscriber) => {
        this.readStatusTrkSubscriber = subscriber;
        subscriber.next(FILEREAD_STATUS.NONE);
    });

    public readStatus: FILEREAD_STATUS = FILEREAD_STATUS.NONE;
    public rawData: string = '';
    public length: number = 0;
    public length$: Observable<number> = new Observable<number>((subscriber) =>  {
        this.lengthSubscriber = subscriber;
        subscriber.next(0);
    });
    public isDCM: boolean | null = null;
    public isDCM$: Observable<boolean | null> = new Observable<boolean | null>((subscriber) =>  {
        this.isDCMSubscriber = subscriber;
        subscriber.next(this.isDCM);
    });

    public static downloadedDCMFile(value: string): DCMFile {
      var file = new File([], 'emptyFile');
      var dcmFile = new DCMFile(file);
      dcmFile.rawData = value;
      dcmFile.length = value.length;
      dcmFile.isDCM = true;
      dcmFile.readStatus = FILEREAD_STATUS.SUCCESS;
      return dcmFile;
    }

    constructor(public file: File) {
        this.freader = new FileReader();
        this.addListeners();
    }
    
    public readContents(): void {
        this.resetReadResults();
        let sliced = this.file.slice(0,132);
        this.freader.readAsBinaryString(sliced);
    }

    private readCompleteFile(): void {
        this.freader.readAsBinaryString(this.file);
    }

    //TODO: Evitar reconocer un DICOMDIR como fichero DICOM.
    private isDICOMFile(): boolean {
        let DICOMLabel = this.rawData.substring(128, 132);
        //console.log('Label found: ' + DICOMLabel);
        //console.log('Id DICOM: ' + (DICOMLabel == DICOM_LABEL));
        const result = (DICOMLabel == DICOM_LABEL);
        this.isDCMSubscriber?.next(result);
        return result;
    }

    private resetReadResults(): void {
        this.readStatus = FILEREAD_STATUS.NONE;
        this.readStatusSubscriber?.next(this.readStatus);
        this.readStatusTrkSubscriber?.next(this.readStatus);
        this.rawData = '';
        this.length = 0;
        this.lengthSubscriber?.next(this.length);
        this.isDCM = null;
        this.isDCMSubscriber?.next(this.isDCM);
    }

    private addListeners(): void {
        this.freader.onloadstart = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onload = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onloadend = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onprogress = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onerror = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
        this.freader.onabort = (ev: ProgressEvent<FileReader>) => { this.handleEvent(ev); }
    }

    public handleEvent(event: any) {
        // if (DCMFile.HIGH_PRIOR && !this.isDCM) {
        //     setTimeout(() => this.handleEvent(event), 100);
        //     return;
        // }
        //console.log(`${event.type}: ${event.loaded} bytes transferred\n`);
        this.length = event.loaded;
        this.lengthSubscriber?.next(this.length);
        
        if (event.type === "loadend") {
            //console.log('Read Ended.');
            this.rawData = this.freader.result?this.freader.result.toString():'';
            this.length = this.rawData.length;
            this.lengthSubscriber?.next(this.length);
            if (this.isDCM) {
                // DCMFile.HIGH_PRIOR--;
                this.readStatus = FILEREAD_STATUS.SUCCESS;
                this.readStatusSubscriber?.next(this.readStatus);
                this.readStatusTrkSubscriber?.next(this.readStatus);
            } else {
                this.isDCM = this.isDICOMFile();
                if (this.isDCM) {
                    // DCMFile.HIGH_PRIOR++;
                    this.readCompleteFile();
                } else {
                    this.readStatus = FILEREAD_STATUS.SUCCESS;
                    this.readStatusSubscriber?.next(this.readStatus);
                    this.readStatusTrkSubscriber?.next(this.readStatus);
                }
            }
        } else if (event.type === "error") {
            console.log('Read Error.');
            this.readStatus = FILEREAD_STATUS.ERROR;
            this.readStatusSubscriber?.next(this.readStatus);
            this.readStatusTrkSubscriber?.next(this.readStatus);
        } else if (event.type === "abort") {
            console.log('Read Abort.');
            this.readStatus = FILEREAD_STATUS.ABORT;
            this.readStatusSubscriber?.next(this.readStatus);
            this.readStatusTrkSubscriber?.next(this.readStatus);
        }
    }

    public isLittleEndian(): boolean {
        let firstKnownTagByte = this.rawData.charCodeAt(132);
        //console.log('Little Endian: ' + (firstKnownTagByte == LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE));
        return (firstKnownTagByte == LITTLE_ENDIANT_FIRST_KNOWN_TAG_BYTE);
    }
}