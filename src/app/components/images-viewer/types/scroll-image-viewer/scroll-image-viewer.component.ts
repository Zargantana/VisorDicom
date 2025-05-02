import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';
import { BasicImageViewerComponent } from '../../basic/basic-image-viewer/basic-image-viewer.component';

@Component({
  selector: 'scroll-image-viewer',
  templateUrl: './scroll-image-viewer.component.html',
  styleUrls: ['./scroll-image-viewer.component.scss']
})
export class ScrollImageViewerComponent implements OnInit {

  @ViewChild('imageIconDisplaySub1')
  private imageIconDisplaySub1: ElementRef<HTMLImageElement> | undefined;
  @ViewChild('imageIconDisplaySub2')
  private imageIconDisplaySub2: ElementRef<HTMLImageElement> | undefined;

  @ViewChild('imageIconDisplay')
  private imageIconDisplay: ElementRef<HTMLImageElement> | undefined;
  @ViewChild('imageIconDisplay2')
  private imageIconDisplay2: ElementRef<HTMLImageElement> | undefined;
  @ViewChild('imageIconDisplay3')
  private imageIconDisplay3: ElementRef<HTMLImageElement> | undefined;
  @ViewChild('imageIconDisplay4')
  private imageIconDisplay4: ElementRef<HTMLImageElement> | undefined;
  @ViewChild('imageIconDisplay5')
  private imageIconDisplay5: ElementRef<HTMLImageElement> | undefined;

  @ViewChild('display')
  public display: BasicImageViewerComponent | undefined;

  @Input() classifier: classifierDCM | undefined;

  public get isResizing(): boolean {
    return this.display?.issemiResizing??false;
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public maxIconListHeight(): number {
    return BasicImageViewerComponent.viewerMaxHeight;
  }

  public get reader(): DCMFileReader | undefined {
    return this.getImageFromList(this.mainImagePointer).reader;
  }

  public get currentImage(): ImageDCM | undefined {
    return this.getImageFromList(this.mainImagePointer);
  }

  public mainImagePointer: number = 0;

  public imageInfo = false;

  public fitScreen = false;

  private imageList: ImageDCM[] = [];

  private deltasAccumulator: number = 0;
  private deltasAccumulatorTS = Date.now();
  private deltasAccumulatorDelay = 50;

  constructor() { 
  }

  ngOnInit(): void {
    this.tryToViewImages();
  }

  public tryToViewImages() {
    this.preloadImages();
    this.trytoReviewImages();
  }

  private preloadImages() {    
    this.imageList = [];
    if (this.classifier) {
      for(let i = 0; i < this.classifier.numberOfImages; i++) {
        let imgReader = this.classifier.searchImageByIndex(i);
        if (imgReader) {
          this.imageList.push(new ImageDCM(imgReader));
        }
      }
    }
  }

  private trytoReviewImages() {
    if (this.classifier?.studySplit.length) {
      let currentImage = this.mainImagePointer;
      if (this.imageIconDisplay5) this.tryToViewImage(this.imageIconDisplay5, currentImage);
      if (this.imageIconDisplay4) this.tryToViewImage(this.imageIconDisplay4, ++currentImage);
      if (this.imageIconDisplay3) this.tryToViewImage(this.imageIconDisplay3, ++currentImage);
      if (this.imageIconDisplay2) this.tryToViewImage( this.imageIconDisplay2, ++currentImage);
      if (this.imageIconDisplay) this.tryToViewImage(this.imageIconDisplay, ++currentImage);

      currentImage = this.mainImagePointer;
      if (this.imageIconDisplaySub1) this.tryToViewImage(this.imageIconDisplaySub1, --currentImage);
      if (this.imageIconDisplaySub2) this.tryToViewImage(this.imageIconDisplaySub2, --currentImage);

      //setTimeout( ()=> this.display?.paintImage(), 10);
      let imageDCM = this.currentImage;
      if (imageDCM) {
        this.display?.paintImageF(imageDCM);
      }
    }
  }

  private tryToViewImage(image: ElementRef<HTMLImageElement>, imgNum: number) {
    this.getImageFromList(imgNum).paintImage(image);
  }

  private getImageFromList(imgNum: number): ImageDCM {
    if (imgNum < 0) {
      imgNum = this.imageList.length + imgNum;
    }
    if (imgNum < 0) {
      imgNum = 0;
    }
    imgNum = imgNum % this.imageList.length;
    return this.imageList[imgNum];
  }

  public onScroll(event: WheelEvent) {
    if (!this.display?.shouldScroll) {
      return this.onScrollF(event);
    }
    return true;
  }

  public onScrollF(event: WheelEvent) {
    let qty = event.deltaY/100;
    if (qty < 1 && qty > -1) {
      qty = (event.deltaY > 0)?1:-1;
    }
    this.deltasAccumulator += qty;

    setTimeout(() => this.ScrollImages(), this.deltasAccumulatorDelay);
    this.deltasAccumulatorTS = Date.now();
    event.stopPropagation();
    return false;
  }

  private ScrollImages() {
    if (this.deltasAccumulator) {
      let totalImages = this.classifier?.numberOfImages??1;
      this.mainImagePointer += Math.trunc(this.deltasAccumulator);
      if (this.mainImagePointer < 0) {
        this.mainImagePointer += totalImages;
      }
      if (this.mainImagePointer < 0) {
        this.mainImagePointer = 0;
      }
      this.mainImagePointer %= totalImages;
      this.deltasAccumulator = 0;
      if ((Date.now() - this.deltasAccumulatorTS) < this.deltasAccumulatorDelay) {
        setTimeout(() => this.trytoReviewImages(), 0);
      } else {
        this.trytoReviewImages();
      }
    }
  }

  public ImageBeforeClick() {
    this.ImageBefore();
  }

  public NextImageClick() {
    this.NextImage();
  }

  private ImageBefore() {
    if ((--this.mainImagePointer) < 0) {
      this.mainImagePointer = (this.classifier?.numberOfImages??1) - 1; 
    }
    this.trytoReviewImages();
  }

  private NextImage() {
    this.mainImagePointer++; 
    this.mainImagePointer %= this.classifier?.numberOfImages??1;
    this.trytoReviewImages();
  }

  public ImageClicked() {
    this.display?.MaxMin();
  }
}
