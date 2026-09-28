import { AfterViewInit, Component, DoCheck, ElementRef, EventEmitter, HostListener, Inject, Input, OnDestroy, Optional, Output, ViewChild } from '@angular/core';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ManualWindow } from 'src/app/clases/Color/base-color.class';
import { ImageDCM, VOIWindowOption } from 'src/app/clases/Images/image-DCM.class';
import { WindowPreset, WindowPresets } from 'src/app/clases/Images/window-presets';
import { I18n } from 'src/app/i18n/i18n';
import { ThemeService } from 'src/app/services/theme.service';
import { VIEWER_UPLOAD_HANDLER, ViewerUploadHandler } from '../../viewer-upload-handler';
import { ViewerFullscreen } from '../../viewer-fullscreen';
import { TouchGestures } from '../touch-gestures';

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
  private imageDisplay: ElementRef<HTMLCanvasElement> | undefined;

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

  /**
   * Contraste con el ratón (doc 06 V1). Tres fuentes, de más a menos prioritaria: la ventana arrastrada
   * (`manualWindow`), el preset elegido en el selector (`selectedPreset`, solo TC) y la ventana del fichero
   * (`selectedWindow`). Viven en el visor: se mantienen al pasar de imagen o de frame (también en cine) y la arrastrada
   * se olvida al cambiar de serie.
   */
  public manualWindow: ManualWindow | null = null;
  public selectedPreset: string | null = null;
  private lastSeries: string | null = null;
  /** Arrastre en curso (botón izquierdo o derecho sobre la imagen); `moved` cuando pasa de 4 px y deja de ser un clic */
  private drag: { id: number; button: number; x: number; y: number; start: ManualWindow; scale: number; moved: boolean } | null = null;
  private suppressClick = false;
  private paintQueued = false;

  /**
   * Visor táctil (doc 06 V3): zoom y desplazamiento de la imagen con los dedos (transformación CSS del canvas: el
   * frame no se vuelve a pintar). Se mantienen al pasar de imagen en la serie y vuelven a 1 al cambiar de serie o con
   * un doble toque.
   */
  public zoom = 1;
  public panX = 0;
  public panY = 0;
  private gestureStart = { zoom: 1, panX: 0, panY: 0, window: null as ManualWindow | null, scale: 1 };
  /** Hasta cuándo un click del navegador viene de un toque (el toque ya lo han tratado los gestos). */
  private touchClickUntil = 0;
  private readonly touch = new TouchGestures({
    zoomed: () => this.zoom > 1.01,
    step: (delta) => (delta > 0 ? this.nextClick : this.beforeClick).emit(),
    panStart: () => this.rememberGestureStart(),
    pan: (dx, dy) => { this.panX = this.gestureStart.panX + dx; this.panY = this.gestureStart.panY + dy; },
    pinchStart: () => this.rememberGestureStart(),
    pinch: (ratio, dx, dy) => {
      this.zoom = Math.min(8, Math.max(1, this.gestureStart.zoom * ratio));
      if (this.zoom <= 1.01) {
        this.zoom = 1;
        this.panX = this.panY = 0;
      } else {
        this.panX = this.gestureStart.panX + dx;
        this.panY = this.gestureStart.panY + dy;
      }
    },
    contrastStart: () => {
      const start = this.currentImage?.grayscale ? this.currentImage.currentWindow() : null;
      this.gestureStart.window = start;
      this.gestureStart.scale = start ? Math.max(start.width, 16) / 256 : 1;
      return !!start;
    },
    contrast: (dx, dy) => {
      const w = this.gestureStart.window;
      if (w) {
        this.manualWindow = { center: Math.round((w.center + dy * this.gestureStart.scale) * 100) / 100,
                              width: Math.max(1, Math.round((w.width + dx * this.gestureStart.scale) * 100) / 100) };
        this.queuePaint();
      }
    },
    tap: () => this.imageClick.emit(),
    doubleTap: () => this.resetZoom(),
  });

  private rememberGestureStart() {
    this.gestureStart.zoom = this.zoom;
    this.gestureStart.panX = this.panX;
    this.gestureStart.panY = this.panY;
  }

  /** Transformación del canvas con el zoom táctil (null sin zoom: el canvas se queda como siempre). */
  public get canvasTransform(): string | null {
    return this.zoom > 1 || this.panX || this.panY ? `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})` : null;
  }

  public resetZoom() {
    this.zoom = 1;
    this.panX = this.panY = 0;
  }

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
    this.touch.dispose();
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
    const canvas = this.imageDisplay?.nativeElement; // el visor pinta en un canvas: se copia tal cual
    if (!canvas || !canvas.width || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
    try {
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

  /** Ventanas VOI del fichero visible. */
  public get windows(): VOIWindowOption[] {
    return this.currentImage?.windows ?? [];
  }

  /** Presets de la modalidad (TC: cerebro, partes blandas, mediastino, pulmón, hueso), solo en monocromo. */
  public get presets(): WindowPreset[] {
    return this.currentImage?.grayscale ? WindowPresets.forModality(this.reader?.Modality) : [];
  }

  /** Posiciones del selector: primero las ventanas del fichero y después los presets. */
  public get optionCount(): number {
    return this.windows.length + this.presets.length;
  }

  /** El selector se ve si hay más de una opción o si el usuario ha arrastrado (para ver C/W y poder volver). */
  public get showWindowSelector(): boolean {
    return this.optionCount > 1 || !!this.manualWindow;
  }

  /** Ventana del fichero aplicada: la elegida, acotada a las que tiene la imagen actual. */
  public get effectiveWindow(): number {
    const count = this.windows.length;
    return count ? Math.min(this.selectedWindow, count - 1) : 0;
  }

  /** Posición del selector: el preset elegido o la ventana del fichero. */
  public get optionIndex(): number {
    const p = this.selectedPreset ? this.presets.findIndex((x) => x.key == this.selectedPreset) : -1;
    return p >= 0 ? this.windows.length + p : this.effectiveWindow;
  }

  public windowLabel(index: number): string {
    const count = this.windows.length;
    if (index >= count) {
      const p = this.presets[index - count];
      return p ? `${I18n.t(('viewer.preset.' + p.key) as any)} (C ${p.center} / W ${p.width})` : '';
    }
    const w = this.windows[index];
    if (!w) {
      return '';
    }
    const name = w.explanation ? w.explanation : (I18n.t('viewer.window') + ' ' + (index + 1));
    return name + ' (C ' + w.center + ' / W ' + w.width + ')';
  }

  /** Lo que dice el selector: la ventana arrastrada o la opción elegida. */
  public get currentWindowLabel(): string {
    const m = this.manualWindow;
    return m ? `${I18n.t('viewer.windowManual')} (C ${Math.round(m.center)} / W ${Math.round(m.width)})` : this.windowLabel(this.optionIndex);
  }

  public onWindowSelected(value: string | number) {
    const index = Math.trunc(+value);
    if (isNaN(index)) {
      return;
    }
    const count = this.windows.length;
    if (index < count) {
      this.selectedWindow = index;
      this.selectedPreset = null;
    } else {
      this.selectedPreset = this.presets[index - count]?.key ?? null;
    }
    this.manualWindow = null;
    this.paintImage();
  }

  /** Vuelve a la ventana del fichero (o a la automática): olvida la arrastrada y el preset. */
  public resetWindow() {
    this.manualWindow = null;
    this.selectedPreset = null;
    this.paintImage();
  }

  private applySelectedWindow(imageDCM: ImageDCM) {
    const series = imageDCM.reader.SeriesInstanceUID;
    if (series !== this.lastSeries) {
      // Otra serie: la ventana arrastrada era de la anterior. El preset se conserva si la nueva también lo tiene.
      this.lastSeries = series;
      this.manualWindow = null;
      this.resetZoom();
      if (this.selectedPreset && !WindowPresets.forModality(imageDCM.reader.Modality).some((p) => p.key == this.selectedPreset)) {
        this.selectedPreset = null;
      }
    }
    const count = imageDCM.windowCount;
    imageDCM.selectedWindow = count ? Math.min(this.selectedWindow, count - 1) : 0;
    const preset = this.selectedPreset ? WindowPresets.forModality(imageDCM.reader.Modality).find((p) => p.key == this.selectedPreset) : undefined;
    imageDCM.manualWindow = this.manualWindow ?? (preset ? { center: preset.center, width: preset.width } : null);
  }

  /**
   * Arrastrar sobre la imagen con el botón izquierdo o el derecho ajusta la ventana: en horizontal la anchura
   * (contraste), en vertical el centro (brillo; hacia abajo, más oscuro). La sensibilidad es proporcional a la anchura
   * al empezar (256 px la duplican), así sirve igual para un cerebro (W 80) que para un pulmón (W 1500). Un clic sin
   * mover sigue haciendo lo de siempre (cine, frame siguiente, ajustar). El táctil va aparte (doc 06 V3).
   */
  public onPointerDown(event: PointerEvent) {
    this.suppressClick = false;
    if (event.pointerType === 'touch') {
      (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
      this.touch.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    const start = this.currentImage?.grayscale ? this.currentImage.currentWindow() : null;
    if (!start) {
      return;
    }
    this.drag = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, start,
                  scale: Math.max(start.width, 16) / 256, moved: false };
  }

  public onPointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      this.touch.move(event.pointerId, event.clientX, event.clientY);
      return;
    }
    const d = this.drag;
    if (!d || event.pointerId !== d.id) {
      return;
    }
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) {
        return;
      }
      d.moved = true;
      (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    this.manualWindow = {
      center: Math.round((d.start.center + dy * d.scale) * 100) / 100,
      width: Math.max(1, Math.round((d.start.width + dx * d.scale) * 100) / 100),
    };
    this.queuePaint();
  }

  public onPointerUp(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      if (event.type === 'pointercancel') {
        this.touch.cancel(event.pointerId);
      } else {
        this.touch.up(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      }
      this.touchClickUntil = Date.now() + 800;
      return;
    }
    const d = this.drag;
    if (d && event.pointerId === d.id) {
      // El click que sigue a soltar el botón izquierdo tras arrastrar no es un clic (no arranca el cine)
      this.suppressClick = d.moved && d.button === 0;
      this.drag = null;
    }
  }

  /** Sin menú contextual sobre una imagen monocromo: el botón derecho también ajusta la ventana. */
  public onContextMenu(event: MouseEvent) {
    if (this.currentImage?.grayscale) {
      event.preventDefault();
    }
  }

  /** Un repintado por fotograma de pantalla mientras se arrastra (no uno por cada evento del ratón). */
  private queuePaint() {
    if (this.paintQueued) {
      return;
    }
    this.paintQueued = true;
    requestAnimationFrame(() => {
      this.paintQueued = false;
      this.paintImage();
    });
  }

  public NextClick() {
    this.nextClick.emit();
  }

  public BeforeClick() {
    this.beforeClick.emit();
  }

  public ImageClicked() {
    if (Date.now() < this.touchClickUntil) {
      return; // el click que el navegador genera tras un toque: el toque (o el gesto) ya se ha tratado
    }
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
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
