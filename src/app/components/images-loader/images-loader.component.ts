import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { DCMFile, FILEREAD_STATUS } from 'src/app/clases/DCM/DCM-file.class';

@Component({
    selector: 'images-loader',
    templateUrl: './images-loader.component.html',
    styleUrls: ['./images-loader.component.scss'],
    standalone: false
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

  /** Ficheros que aún no han terminado de leerse */
  public get pendingFiles(): number {
    return Math.max(0, this.totalFiles - this.readEndedFiles);
  }

  /** Progreso global, 0-100 */
  public get progressPct(): number {
    return this.totalFiles ? Math.round(100 * this.readEndedFiles / this.totalFiles) : 0;
  }

  /** Los últimos ficheros que se están leyendo ahora mismo (para no listar cientos) */
  public get activeFiles(): DCMFile[] {
    const active: DCMFile[] = [];
    for (let i = this.foundFiles.length - 1; i >= 0 && active.length < 6; i--) {
      if (this.foundFiles[i].readStatus == FILEREAD_STATUS.NONE) active.unshift(this.foundFiles[i]);
    }
    return active;
  }

  /** Resaltado de la zona de soltar mientras se arrastra algo encima */
  public dragging: boolean = false;

  public onSelected(event: any): void {
    this.loadFiles(Array.from(event.target.files as FileList));
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragging = true;
  }

  public onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
  }

  /** Soltar ficheros o carpetas: se leen igual que los elegidos con el botón. */
  public async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;
    const files = await ImagesLoaderComponent.filesFromDrop(event.dataTransfer);
    if (files.length) this.loadFiles(files);
  }

  /**
   * Ficheros de un arrastre. Las carpetas se recorren enteras con la API de entradas (Chrome, Edge, Firefox,
   * Safari); si el navegador no la da, se usan los ficheros sueltos. Las entradas hay que cogerlas antes de
   * cualquier espera: después del evento el DataTransfer se vacía.
   */
  private static async filesFromDrop(dataTransfer: DataTransfer | null): Promise<File[]> {
    if (!dataTransfer) return [];
    const entries = Array.from(dataTransfer.items ?? [])
      .map((item: any) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
      .filter((entry) => !!entry);
    if (!entries.length) return Array.from(dataTransfer.files ?? []);
    const files: File[] = [];
    const walk = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
        if (file) files.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch: any[] = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
          if (!batch.length) break;
          for (const child of batch) await walk(child);
        }
      }
    };
    for (const entry of entries) await walk(entry);
    return files;
  }

  public loadFiles(files: File[]): void {
    this.resetReadStatus();
    this.totalFiles = files.length;

    for (let numFile = 0; numFile < files.length; numFile++) {
      const file: File = files[numFile];
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

