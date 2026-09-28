import { AfterViewChecked, Component, ElementRef, Inject, Input, Optional, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { Cine } from 'src/app/clases/Images/cine';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ImageDCM } from 'src/app/clases/Images/image-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';
import { BasicImageViewerComponent } from '../../basic/basic-image-viewer/basic-image-viewer.component';
import { VIEWER_UPLOAD_HANDLER, ViewerUploadHandler } from '../../viewer-upload-handler';

@Component({
    selector: 'list-image-viewer',
    templateUrl: './list-image-viewer.component.html',
    styleUrls: ['./list-image-viewer.component.scss'],
    standalone: false
})
export class ListImageViewerComponent implements AfterViewChecked {

  @ViewChild('display')
  public display: BasicImageViewerComponent | undefined;

  /**
   * La rama que se ve. Al cambiarla, la lista de miniaturas vuelve arriba, donde está la imagen que se abre: antes se
   * quedaba desplazada como en el estudio anterior (B0008). No vale un scrollTo inmediato: al cambiar de serie el visor
   * se redimensiona y oculta la lista un momento (isResizing), y al volver a mostrarla el navegador le devuelve el
   * desplazamiento que tenía. Se hace en ngAfterViewChecked, cuando ya se ve.
   */
  @Input() set classifier(value: classifierDCM | undefined) {
    if (value !== this._classifier) {
      this._classifier = value;
      this.iconListToTop = true;
    }
  }
  get classifier(): classifierDCM | undefined {
    return this._classifier;
  }
  private _classifier: classifierDCM | undefined;
  private iconListToTop = false;

  @ViewChild('iconList')
  private iconList: ElementRef<HTMLDivElement> | undefined;

  public reader: DCMFileReader | undefined;

  public viewingImage: number = 0;

  public currentImage: ImageDCM | undefined;

  public stopPlaying: boolean = true;  
  public stoppedPlaying: boolean = true;  

  /** "Guardar" solo aparece si la aplicación registra un VIEWER_UPLOAD_HANDLER y queda algo sin subir. */
  public get NotAllUploaded(): boolean {
    let result: boolean = false;
    if (this.uploadHandler && this.classifier) {
      this.classifier.getArray().forEach((e) => { if (!e.uploaded) result = true });
    }
    return result;
  }

  public get isResizing(): boolean {
    return this.display?.issemiResizing??false;
  }

  constructor(@Optional() @Inject(VIEWER_UPLOAD_HANDLER) private uploadHandler: ViewerUploadHandler | null) { }

  ngAfterViewChecked(): void {
    const list = this.iconList?.nativeElement;
    if (this.iconListToTop && list && list.offsetParent !== null) {
      list.scrollTop = 0;
      this.iconListToTop = false;
    }
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public maxIconListHeight(): number {
    return BasicImageViewerComponent.viewerMaxHeight;
  }

  /** Multiframe que se reproduce como vídeo (Cine: tiempos del fichero o la modalidad). */
  public get canPlay(): boolean {
    return !!this.reader && Cine.canPlay(this.reader);
  }

  /** Clic en la imagen: cine → play/pausa; cortes sin tiempos (TC, RM, NM, tomosíntesis...) → frame siguiente; una sola imagen → maximizar. */
  public ImageClicked() {
    if (this.canPlay) {
      this.PlayPause();
    } else if (this.reader && Cine.isStack(this.reader)) {
      this.NextFrameClick();
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
        }, this.reader ? Cine.frameTime(this.reader) : 100);
    } else {
      this.stoppedPlaying = true;
    }
  }

  public Pause() {
    this.stopPlaying = true;
  }

  public NextFrameClick() {
    if (this.currentImage && this.display) {
      if (this.currentImage.frames <= 1) {
        this.stepImage(1); // una sola imagen por fichero (XA, CR…): deslizar el dedo pasa a la siguiente de la lista
        return;
      }
      this.currentImage.NextFrame();
      this.enqueueRepaint();
    }
  }

  public FrameBeforeClick() {
    if (this.currentImage && this.display) {
      if (this.currentImage.frames <= 1) {
        this.stepImage(-1);
        return;
      }
      this.currentImage.FrameBefore();
      this.enqueueRepaint();
    }
  }

  /** Imagen siguiente o anterior de la lista (con vuelta al principio), como pulsar su miniatura. */
  private stepImage(delta: 1 | -1) {
    const count = this.classifier?.numberOfImages ?? 0;
    if (count <= 1 || !this.classifier) {
      return;
    }
    const index = ((this.viewingImage - 1 + delta) % count + count) % count;
    const reader = this.classifier.searchImageByIndex(index);
    if (reader) {
      this.ViewImage(reader.SOPInstanceUID);
    }
  }

  public ViewImage(SOPInstanceUID: string) {
    if (this.classifier?.studySplit.length) {
      this.reader = this.classifier?.searchImageByUID(SOPInstanceUID);
      if (this.reader) {
        if (!this.canPlay) {
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

  public uploadClick() {
    if (this.classifier && this.uploadHandler) {
      this.uploadHandler.prepareUpload(this.classifier);
    }
  }
}
