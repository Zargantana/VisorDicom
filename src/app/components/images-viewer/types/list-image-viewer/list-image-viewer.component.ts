import { Component, Input, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';
import { BasicImageViewerComponent } from '../../basic/basic-image-viewer/basic-image-viewer.component';

@Component({
  selector: 'list-image-viewer',
  templateUrl: './list-image-viewer.component.html',
  styleUrls: ['./list-image-viewer.component.scss']
})
export class ListImageViewerComponent{

  @ViewChild('display')
  public display: BasicImageViewerComponent | undefined;

  @Input() classifier: classifierDCM | undefined;

  public reader: DCMFileReader | undefined;

  public viewingImage: number = 0;

  public currentImage: ImageDCM | undefined;

  public stopPlaying: boolean = true;  
  public stoppedPlaying: boolean = true;  

   public get isResizing(): boolean {
    return this.display?.issemiResizing??false;
  }

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public maxIconListHeight(): number {
    return BasicImageViewerComponent.viewerMaxHeight;
  }

  public ImageClicked() {
    if ((this.reader?.Frames??1) > 1) {
      this.PlayPause();
    } else {
      this.display?.MaxMin();
    }
  }
  
  public Play() {
      this.stopPlaying = false;
      this.stoppedPlaying = false;
      this.NextFrameAndEnqueue();
  }

  public PlayPause() {
    if (this.stopPlaying && this.stoppedPlaying) {
      this.Play();
    } else {
      this.Pause();
    }
  }

  private NextFrameAndEnqueue() {
    if (!this.stopPlaying) {
      this.NextFrameClick();
      setTimeout(() => {
        this.NextFrameAndEnqueue();
        }, this.reader?.FrameTime);
    } else {
      this.stoppedPlaying = true;
    }
  }

  public Pause() {
    this.stopPlaying = true;
  }

  public NextFrameClick() {
    if (this.currentImage && this.display) {
      this.currentImage.NextFrame();
      this.enqueueRepaint();
    }
  }

  public FrameBeforeClick() {
    if (this.currentImage && this.display) {
      this.currentImage.FrameBefore();
      this.enqueueRepaint();
    }
  }

  public ViewImage(SOPInstanceUID: string) {
    if (this.classifier?.studySplit.length) {
      this.reader = this.classifier?.searchImageByUID(SOPInstanceUID);
      if (this.reader) {
        if (this.reader.Frames <= 1) {
          this.Pause();
        }
        this.viewingImage = (this.classifier?.lastSearchIndexFound??0) + 1;
        this.paintImage();
      }
    }
  }

  private enqueueRepaint() {
    setTimeout(() => this.display?.paintImage(), 50);
  }

  private paintImage() {
    if (this.reader && this.display) {
      this.currentImage = new ImageDCM(this.reader);
      this.enqueueRepaint();
    }
  }

  private paintImageF() {
    if (this.reader && this.display) {
      this.currentImage = new ImageDCM(this.reader);
      this.display?.paintImageF(this.currentImage);
    }
  }

  public StartWatchingDCMFile(): void {
    if ((this.viewingImage == 0) && this.classifier?.studySplit.length) {
      this.viewingImage = 1;
      this.reader = this.classifier.searchImageByIndex(0);
      this.paintImage();
    }
  }

  public StartWatchingDCMFileF(classifier: classifierDCM | undefined): void {
    if ((this.viewingImage == 0) && classifier?.studySplit.length) {
      this.viewingImage = 1;
      this.reader = classifier.searchImageByIndex(0);
      this.paintImageF();
    }
  }

  public ContinueWatchingDCMFiles(): void {
    if ((this.viewingImage) && this.classifier?.studySplit.length) {
      this.viewingImage = (++this.viewingImage) % this.classifier.numberOfImages + 1;
      this.reader = this.classifier.searchImageByIndex(this.viewingImage - 1);
      this.paintImage();
    }
  }
}
