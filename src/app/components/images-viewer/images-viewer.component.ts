import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';
import { ListImageViewerComponent } from './types/list-image-viewer/list-image-viewer.component';
import { ScrollImageViewerComponent } from './types/scroll-image-viewer/scroll-image-viewer.component';

@Component({
  selector: 'images-viewer',
  templateUrl: './images-viewer.component.html',
  styleUrls: ['./images-viewer.component.scss']
})
export class ImagesViewerComponent {
  
  @ViewChild('mainDiv')
  private mainDiv: ElementRef<HTMLDivElement> | undefined;

  @ViewChild('listviewer')
  private listViewer: ListImageViewerComponent | undefined;

  @ViewChild('scrollviewer')
  private scrollviewer: ScrollImageViewerComponent | undefined;

  private nextToClassify: number = 0;
  public classifier: classifierDCM = new classifierDCM();
  public selectedClassifier: classifierDCM | null = null;
  public readEnded: boolean = false;
  private _colapsed: boolean = true;
  public get colapsed(): boolean {
    return this._colapsed
  }
  public set colapsed(value: boolean) {
    if (this._colapsed != value) {
      this._colapsed = value;
      setTimeout(() => this.callToViewersResized(), 50);
    }    
  }

  public colapsedManipulated: boolean = false;
  private startedWatching: boolean = false;

  @Input() foundDCMFiles: DCMFile[] | undefined;  

  constructor() { }

  private callToViewersResized() {
    if (this.scrollviewer?.display) this.scrollviewer.display.onResize();
    if (this.listViewer?.display) this.listViewer.display.onResize();
  }

  public getMainDivHeight() {
    return this.mainDiv?.nativeElement.clientHeight??0;
  }

  public colapseClick() {
    this.colapsedManipulated = true;
    this.colapsed = !this.colapsed;
  }
  
  public listviewerSelected(): boolean {
    let result: boolean = (this.readEnded || this.classifier.numberOfImages > 10);
    return result && !this.scrollviewerSelected();
  }

  public scrollviewerSelected(): boolean {
    let result = false;
    if ((this.selectedClassifier?.studySplit.length)&&(this.selectedClassifier.numberOfSeries == 1)) {
      let reader = this.selectedClassifier.searchImageByIndex(0);
      switch (reader?.Modality??'') {
        case 'CT':
        case 'MR':
        case 'PT':  {
          result = (this.selectedClassifier.numberOfImages > 10);
          break;
        }
        case 'US':
        case 'CR':  
        case 'DX':  
        case 'XA': {
          result = false;
          break;
        }
        default:
          result = (this.selectedClassifier.numberOfImages > 25);
      }
    }
    return result;
  }


  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public StartWatchingDCMFile(): void {
    this.readEnded = true;    
    if (!this.colapsedManipulated) {
      this.colapsed = true;
    }
    if (this.classifier.numberOfSeries == 1) {
      this.callToViewersResized();
    }
    setTimeout(() => this.listViewer?.StartWatchingDCMFile(), 100);
    setTimeout(() => this.scrollviewer?.tryToViewImages(), 110);
  }

  public Classify(): void {
    if (this.foundDCMFiles?.length) {
      let initial = this.classifier.numberOfSeries;
      this.classifier.Classify(this.foundDCMFiles, this.nextToClassify, this.foundDCMFiles.length);      
      if ((this.classifier.numberOfSeries > initial) && (!this.colapsed)) {
        this.callToViewersResized();
      }
      this.nextToClassify = this.foundDCMFiles.length;
      if (!this.selectedClassifier) {
        this.selectedClassifier = this.classifier.SeriesBranchZero();  
      }
      if (!this.startedWatching && (this.listViewer || this.scrollviewer)) {
        this.startedWatching = true;
        this.listViewer?.StartWatchingDCMFileF(this.selectedClassifier);
        setTimeout(() => this.scrollviewer?.tryToViewImages(), 100);
      }

    }
  }

  public ClassifyDownloaded(): void {
    if (this.foundDCMFiles?.length) {
      let initial = this.classifier.numberOfSeries;
      this.classifier.ClassifyDownloaded(this.foundDCMFiles, this.nextToClassify, this.foundDCMFiles.length);      
      if ((this.classifier.numberOfSeries > initial) && (!this.colapsed)) {
        this.callToViewersResized();
      }
      this.nextToClassify = this.foundDCMFiles.length;
      if (!this.selectedClassifier) {
        this.selectedClassifier = this.classifier.SeriesBranchZero();  
      }
      if (!this.startedWatching && (this.listViewer || this.scrollviewer)) {
        this.startedWatching = true;
        this.listViewer?.StartWatchingDCMFileF(this.selectedClassifier);
        setTimeout(() => this.scrollviewer?.tryToViewImages(), 100);
      }

    }
  }

  public ReViewImage(SOPInstanceUID: string) {
    this.selectedClassifier = this.classifier.SeriesBranchByImageUID(SOPInstanceUID);
    this.ReviewClick(SOPInstanceUID);
  }

  public ReViewModality(SOPInstanceUID: string) {
    this.selectedClassifier = this.classifier.ModalityBranchByImageUID(SOPInstanceUID);
    this.ReviewClick(SOPInstanceUID);
  }

  public ReViewStudy(SOPInstanceUID: string) {
    this.selectedClassifier = this.classifier.StudyBranchByImageUID(SOPInstanceUID);
    this.ReviewClick(SOPInstanceUID);
  }

  public ReViewPatient(SOPInstanceUID: string) {
    this.selectedClassifier = this.classifier.PatientBranchByImageUID(SOPInstanceUID);
    this.ReviewClick(SOPInstanceUID);
  }

  private ReviewClick(SOPInstanceUID: string) {
    this.callToViewersResized();
    setTimeout(() =>  this.listViewer?.ViewImage(SOPInstanceUID), 100);
    setTimeout(() => this.scrollviewer?.tryToViewImages(), 110);
    this.colapsed = true;
  }
}
