import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'basic-image-viewer',
  templateUrl: './basic-image-viewer.component.html',
  styleUrls: ['./basic-image-viewer.component.scss']
})
export class BasicImageViewerComponent implements AfterViewInit{
  
  @ViewChild('componentDiv')
  private componentDiv: ElementRef<HTMLImageElement> | undefined;

  @ViewChild('imageDisplay')
  private imageDisplay: ElementRef<HTMLImageElement> | undefined;

  @ViewChild('imgContainer')
  private imgContainer: ElementRef<HTMLDivElement> | undefined;

  @ViewChild('infoContainer')
  private infoContainer: ElementRef<HTMLDivElement> | undefined;
  
  @Input() iconListVisible: boolean = false;
  @Input() pointerControls: boolean = false;
  @Input() playpauseControl: boolean = false;
  @Input() playpauseControlState: boolean = true;
  @Input() wheelScrolls: boolean = false;
  @Input() currentElementPointer: number = 0
  @Input() numberOfElements: number = 0

  @Input()  reader: DCMFileReader | undefined;
  @Input()  currentImage: ImageDCM | undefined;

  @Output() nextClick = new EventEmitter<void>();
  @Output() beforeClick = new EventEmitter<void>();
  @Output() playpauseClick = new EventEmitter<void>();
  @Output() imageClick = new EventEmitter<void>();
  @Output() imageWheel = new EventEmitter<WheelEvent>();
  
  public ratio = 1;
  public fitScreen = true;
  public imageInfo = false;

  private _viewerX: number = 0;
  private _viewerY: number = 0;

  private set viewerX(value: number) {
    this._viewerX = value;
  }
  private get viewerX(): number {
    if ( (this._viewerX == 0) || (this._viewerX == 1000) ) {
      this._viewerX = this.imgContainer?.nativeElement.clientWidth??1000;
      if (this.imageInfo && this.infoContainer) this._viewerX += this.infoContainer.nativeElement.clientWidth;
    }    
    return this._viewerX;
  }
  private set viewerY(value: number) {
    this._viewerY = value;
  }
  private get viewerY(): number {
    if ((this._viewerY == 0) && (this.imgContainer)) {
        this._viewerY = this.imgContainer.nativeElement.clientHeight;
        this.imgContainer.nativeElement.style.maxHeight = this._viewerY + 'px';
    }
    return this._viewerY;
  }

  public isResizing: boolean = false;
  public issemiResizing: boolean = false;
  private resizes: number = 0;

  public static viewerMaxHeight: number = 0;

  public shouldScroll: boolean = false;

  //private firstViewInitDone: boolean = false;

  constructor() { }

  ngAfterViewInit(): void {
    console.log('After View Init.')
    //this.sizesInitialization();
    if (this.componentDiv) BasicImageViewerComponent.viewerMaxHeight = this.componentDiv.nativeElement.clientHeight;
  }
/*
  private sizesInitialization(): void {
    if (this.firstViewInitDone) return;
    if (this.imgContainer) {
      this.viewerX = this.imgContainer.nativeElement.clientWidth;
      if (this.imageInfo && this.infoContainer) this.viewerX += this.infoContainer.nativeElement.clientWidth;
      this.viewerY = this.imgContainer.nativeElement.clientHeight;
      this.imgContainer.nativeElement.style.maxHeight = this.viewerY + 'px';
      if (this.componentDiv) BasicImageViewerComponent.viewerMaxHeight = this.componentDiv.nativeElement.clientHeight;
    }    
    this.firstViewInitDone = true;
  }
  */

  onResize() {
    this.isResizing = true;
    this.issemiResizing = true;
    if (this.imgContainer) this.imgContainer.nativeElement.style.maxHeight = '';
    this.resizes++;
    setTimeout(() => {
      this.semiResize();
      }, 500);
  }

  private semiResize() {    
    if (this.componentDiv && this.componentDiv.nativeElement.clientHeight) BasicImageViewerComponent.viewerMaxHeight = this.componentDiv.nativeElement.clientHeight;    
    if (!(--this.resizes))this.issemiResizing = false;
    setTimeout(() => {
      this.Resizing();
      }, 200);
  }

  private Resizing() {
    if (!this.resizes) this.isResizing = false;
    if (this.imgContainer) {
      if (this.imgContainer.nativeElement.clientWidth) this.viewerX = this.imgContainer.nativeElement.clientWidth;
      if (this.imageInfo && this.infoContainer) this.viewerX += this.infoContainer.nativeElement.clientWidth;
      if (this.imgContainer.nativeElement.clientHeight) this.viewerY = this.imgContainer.nativeElement.clientHeight;
      this.imgContainer.nativeElement.style.maxHeight = this.viewerY + 'px';      
    }
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public MaxMin() {
    this.fitScreen = !this.fitScreen;
    this.enqueueRatioRecalc();
  }

  public infoClick() {
    this.imageInfo = !this.imageInfo;
    this.enqueueRatioRecalc();
  }

  public enqueueRatioRecalc() {
    setTimeout(() => {
      this.RecalculateRatio();
      }, 100);
  }

  private RecalculateRatio() {
    if (this.reader) {
      this.RecalculateRatioF(this.reader);
    } 
  }

  private RecalculateRatioF(reader: DCMFileReader) {
    let ancho = this.viewerX;
    if (this.imageInfo && this.infoContainer) ancho -= this.infoContainer.nativeElement.clientWidth;
    if (this.imgContainer) {
      this.ratio = 1;
      if (this.fitScreen) {
        this.ratio = ancho / reader.Columns;
        let suposedHeight = reader.Rows * this.ratio;
        if (suposedHeight > this.viewerY) {
          this.ratio = this.viewerY / reader.Rows;
        }
      } else {
        this.ratio = ancho / reader.Columns;
        let suposedHeight = reader.Rows * this.ratio;
        if (suposedHeight > this.viewerY) {
          ancho = ancho - 20;
          this.ratio = ancho / reader.Columns;
        }
      }
    }
  }

  public paintImage() {
    if (this.currentImage && this.imageDisplay) {
      this.RecalculateRatio();
      this.currentImage.paintImage(this.imageDisplay);
    }
  }

  public paintImageF(imageDCM: ImageDCM) {
    if (this.imageDisplay) {
      this.RecalculateRatioF(imageDCM.reader);
      imageDCM.paintImage(this.imageDisplay);
    }
  }

  public NextClick() {
    this.nextClick.emit();
  }

  public BeforeClick() {
    this.beforeClick.emit();
  }

  public ImageClicked() {
    this.imageClick.emit();
  }

  public ImageWheel(event: WheelEvent) {    
    let imgHeight = ((this.reader?.Rows??0) * this.ratio);
    let overHeighted = (imgHeight > this.viewerY);
    this.shouldScroll = this.wheelScrolls || ((event.altKey||event.ctrlKey||event.shiftKey) && overHeighted);
    this.imageWheel.emit(event);
    if (!this.shouldScroll) event.stopPropagation();
    return this.shouldScroll;
  }

  public PlayPauseClick() {    
    this.playpauseClick.emit();      
  }

  public styleHeightPixels(): number {
    this.RecalculateRatio();    
    return (this.reader?.Rows??0) * this.ratio;

  }

  public styleWidthPixels(): number {
    this.RecalculateRatio();
    return (this.reader?.Columns??0) * this.ratio;
  }
}
