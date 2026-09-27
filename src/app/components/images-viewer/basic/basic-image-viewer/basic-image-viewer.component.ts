import { AfterViewInit, Component, DoCheck, ElementRef, EventEmitter, HostListener, Inject, Input, OnDestroy, Optional, Output, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ImageDCM, VOIWindowOption } from 'src/app/clases/Images/image-DCM.class';
import { I18n } from 'src/app/i18n/i18n';
import { ThemeService } from 'src/app/services/theme.service';
import { VIEWER_UPLOAD_HANDLER, ViewerUploadHandler } from '../../viewer-upload-handler';
import { ViewerFullscreen } from '../../viewer-fullscreen';

@Component({
    selector: 'basic-image-viewer',
    templateUrl: './basic-image-viewer.component.html',
    styleUrls: ['./basic-image-viewer.component.scss'],
    standalone: false
})
export class BasicImageViewerComponent implements AfterViewInit, DoCheck, OnDestroy {
  
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

  /**
   * Ventana VOI elegida por el usuario (indice en Window Center/Width). Vive en el visor, no en la imagen,
   * para que se mantenga al pasar de imagen en una serie (CT: "ABDOMEN\PULMON" en todas las imagenes).
   */
  public selectedWindow: number = 0;

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

  constructor(@Optional() @Inject(VIEWER_UPLOAD_HANDLER) private uploadHandler: ViewerUploadHandler | null) { }

  ngAfterViewInit(): void {
    //this.sizesInitialization();
    // Los visores de lista y pila (componentes padre) leen viewerMaxHeight en su plantilla. Si se asigna aquí,
    // cambia dentro del mismo ciclo de detección y Angular lanza NG0100 en desarrollo. Con setTimeout se asigna
    // al terminar el ciclo y zone.js dispara otro que ya pinta la altura buena.
    setTimeout(() => {
      if (this.componentDiv) BasicImageViewerComponent.viewerMaxHeight = this.componentDiv.nativeElement.clientHeight;
    });
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

  /** La pestaña está en pantalla completa del navegador (Fullscreen API), pedida desde el botón del visor */
  public fullscreen = false;

  /**
   * Botón de maximizar: pone el navegador en pantalla completa (como F11) y la imagen sigue ajustándose al ancho o al
   * alto disponible; al volver a pulsar (o con Esc) se sale. Donde no hay Fullscreen API (iOS) se hace lo de antes:
   * alternar entre ajustar a la ventana y tamaño natural con desplazamiento.
   */
  public MaxMin() {
    const doc: any = document;
    const root: any = doc.documentElement;
    if (typeof root?.requestFullscreen === 'function' && typeof doc.exitFullscreen === 'function') {
      if (!doc.fullscreenElement) {
        root.requestFullscreen().catch(() => { this.fitScreen = !this.fitScreen; this.enqueueRatioRecalc(); });
      } else {
        doc.exitFullscreen().catch(() => { /* ya no estaba */ });
      }
    } else {
      this.fitScreen = !this.fitScreen;
    }
    this.enqueueRatioRecalc();
  }

  /**
   * El navegador entra o sale de pantalla completa (por el botón o con Esc): la aplicación esconde o enseña la barra
   * superior y el menú (ViewerFullscreen) y se recalcula el tamaño de la imagen.
   */
  @HostListener('document:fullscreenchange')
  public onFullscreenChange() {
    this.fullscreen = !!(document as any).fullscreenElement;
    ViewerFullscreen.active = this.fullscreen;
    this.onResize();
  }

  ngOnDestroy(): void {
    const doc: any = document;
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') doc.exitFullscreen().catch(() => { /* nada */ });
    ViewerFullscreen.active = false;
  }

  public infoClick() {
    this.imageInfo = !this.imageInfo;
    this.enqueueRatioRecalc();
  }

  /** El botón de copiar acaba de copiar (icono de check un momento) */
  public copied = false;

  /**
   * Copia al portapapeles la imagen tal como se ve (PNG con la ventana aplicada) junto con la línea de datos
   * (paciente, fecha, serie, imagen): como PNG, como texto y como HTML, para que Word o el correo peguen las dos
   * cosas. Si el navegador no admite varios formatos (Safari), se copia solo la imagen.
   */
  public async copyImage(): Promise<void> {
    const img = this.imageDisplay?.nativeElement;
    if (!img || !img.naturalWidth || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin imagen'))), 'image/png'));
      const caption = this.caption();
      const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<p>${escape(caption)}</p><img src="${canvas.toDataURL('image/png')}" alt="${escape(caption)}">`;
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'image/png': png,
          'text/plain': new Blob([caption], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
      } catch {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      }
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 1500);
    } catch (e) {
      console.warn('No se pudo copiar la imagen', e);
    }
  }

  /** La línea de datos que se muestra sobre la imagen, en el idioma de la interfaz */
  private caption(): string {
    const r = this.reader;
    if (!r) return '';
    return `${I18n.t('viewer.patientId')} ${r.PatientId} ${I18n.t('viewer.studyDate')} ${r.StudyDate} ${I18n.t('viewer.seriesNumber')} #${r.SeriesNumber} ${I18n.t('viewer.image')} #${r.InstanceNumber}`;
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
      this.applySelectedWindow(this.currentImage);
      this.currentImage.paintImage(this.imageDisplay);
    }
  }

  public paintImageF(imageDCM: ImageDCM) {
    if (this.imageDisplay) {
      this.RecalculateRatioF(imageDCM.reader);
      this.applySelectedWindow(imageDCM);
      imageDCM.paintImage(this.imageDisplay);
    }
  }

  /** Ventanas VOI del fichero visible. El selector solo se muestra si hay mas de una. */
  public get windows(): VOIWindowOption[] {
    return this.currentImage?.windows ?? [];
  }

  /** Ventana realmente aplicada: la elegida, acotada a las que tiene la imagen actual. */
  public get effectiveWindow(): number {
    const count = this.windows.length;
    return count ? Math.min(this.selectedWindow, count - 1) : 0;
  }

  public windowLabel(index: number): string {
    const w = this.windows[index];
    if (!w) {
      return '';
    }
    const name = w.explanation ? w.explanation : ('Ventana ' + (index + 1));
    return name + ' (C ' + w.center + ' / W ' + w.width + ')';
  }

  public onWindowSelected(value: string | number) {
    const index = Math.trunc(+value);
    if (!isNaN(index) && index != this.selectedWindow) {
      this.selectedWindow = index;
      this.paintImage();
    }
  }

  private applySelectedWindow(imageDCM: ImageDCM) {
    const count = imageDCM.windowCount;
    imageDCM.selectedWindow = count ? Math.min(this.selectedWindow, count - 1) : 0;
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

  /**
   * La escala se recalcula una vez por ciclo de detección, ANTES de evaluar la plantilla. Antes se hacía
   * dentro de styleHeightPixels()/styleWidthPixels(): la plantilla cambiaba estado al pintarse y Angular
   * lanzaba NG0100 en desarrollo. El resultado en pantalla es el mismo.
   */
  ngDoCheck(): void {
    this.RecalculateRatio();
  }

  public styleHeightPixels(): number {
    return (this.reader?.Rows??0) * this.ratio;
  }

  public styleWidthPixels(): number {
    return (this.reader?.Columns??0) * this.ratio;
  }

  /** Solo hay subida si la aplicación registra un VIEWER_UPLOAD_HANDLER (ReadyDoctor sí, VisorDicom no). */
  public get canUpload(): boolean {
    return !!this.uploadHandler;
  }

  public get FileUploaded(): boolean {
    return this.reader?.uploaded??true;
  }

  public Upload(): void {
    if (this.reader && this.uploadHandler) {
      var classifier = new classifierDCM();
      classifier.ClassifyReader(this.reader);
      this.uploadHandler.prepareUpload(classifier);
    }
  }

}
