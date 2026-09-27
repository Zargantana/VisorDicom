import { AfterViewInit, Component, Inject, Optional, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { ImagesLoaderComponent, ViewSeriesRequest } from 'src/app/components/images-loader/images-loader.component';
import { LOADER_REMOTE_SOURCE, LoaderRemoteSource } from 'src/app/components/images-loader/remote-source';
import { ImagesViewerComponent } from 'src/app/components/images-viewer/images-viewer.component';
import { ViewerFullscreen } from 'src/app/components/images-viewer/viewer-fullscreen';
import { I18n } from 'src/app/i18n/i18n';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
    selector: 'app-file-loader',
    templateUrl: './file-loader.component.html',
    styleUrls: ['./file-loader.component.scss'],
    host: {
        class: 'd-flex slab-flex-1 flex-column m-0 p-0'
    },
    standalone: false
})
export class FileLoaderComponent implements AfterViewInit {
  public foundDCMFiles: DCMFile[] = [];
  /** El visor se muestra cuando el usuario pulsa una serie del selector; la lectura sigue mientras tanto. */
  public showViewer: boolean = false;
  /**
   * Enlace remoto (`?qr=<token>`, el QR del portal): los ficheros se descargan solos y, leídos, el visor se abre sin
   * pasar por el selector. Mensaje de estado o de error para la pantalla de carga.
   */
  public remoteStatus: string = '';
  public remoteError: boolean = false;
  private autoOpen: boolean = false;

  @ViewChild('imgsLoader') private imgsLoader: ImagesLoaderComponent | undefined;
  @ViewChild('imgsViewer') private imgsViewer: ImagesViewerComponent | undefined;

  constructor(private route: ActivatedRoute, @Optional() @Inject(LOADER_REMOTE_SOURCE) private remote: LoaderRemoteSource | null) { }

  /** En pantalla completa del visor no hay barra ("Estudios encontrados"): solo la imagen */
  public viewerFullscreen(): boolean {
    return ViewerFullscreen.active;
  }

  ngAfterViewInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const token = params.get('qr');
    // ?url=<URL prefirmada> (se puede repetir): el visor abre esos DICOM directamente. Solo https; la CSP de la web
    // decide además a qué orígenes se puede conectar (en visordicom.es, el bucket de estudios)
    const urls = params.getAll('url').filter((u) => /^https:\/\//i.test(u));
    if (token && this.remote) setTimeout(() => this.loadRemote(() => this.remote!.resolve(token)), 0);
    else if (urls.length) setTimeout(() => this.loadRemote(async () => urls.map((url, i) => ({ url, fileName: FileLoaderComponent.nameFromUrl(url, i) }))), 0);
  }

  /** Nombre del fichero a partir de la ruta de la URL (sin la query con la firma) */
  private static nameFromUrl(url: string, index: number): string {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      return last || `imagen-${index + 1}.dcm`;
    } catch {
      return `imagen-${index + 1}.dcm`;
    }
  }

  /** Descarga los ficheros del enlace y los mete en el cargador como si el usuario los hubiera elegido. */
  private async loadRemote(resolve: () => Promise<{ url: string; fileName: string }[]>): Promise<void> {
    this.remoteStatus = I18n.t('loader.qrLoading');
    this.remoteError = false;
    try {
      const entries = await resolve();
      const files: File[] = [];
      for (const entry of entries) {
        const resp = await fetch(entry.url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
        if (!resp.ok) throw new Error('S3 ha respondido ' + resp.status);
        // Blob y no ArrayBuffer: el navegador puede guardarlo en disco y el visor lo lee por rangos (sin tope de tamaño)
        files.push(new File([await resp.blob()], entry.fileName || 'imagen.dcm', { type: 'application/dicom' }));
      }
      if (!files.length) throw new Error('sin ficheros');
      this.autoOpen = true;
      this.remoteStatus = '';
      this.imgsLoader?.loadFiles(files);
    } catch (err) {
      console.warn('Enlace remoto', err);
      this.remoteStatus = I18n.t('loader.qrExpired');
      this.remoteError = true;
    }
  }

  /** Todos los ficheros leídos: el visor empieza a vigilarlos y, si vienen de un enlace, se abre solo. */
  public onAllRead(viewer: ImagesViewerComponent): void {
    viewer.StartWatchingDCMFile();
    if (this.autoOpen) {
      this.autoOpen = false;
      this.openViewer();
    }
  }

  /** Muestra el visor. Como estaba oculto, sus medidas eran cero: se le avisa como si la ventana cambiara de tamaño. */
  public openViewer(): void {
    this.showViewer = true;
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  /** Abre el visor en el paciente, estudio, modalidad o serie que el usuario ha pulsado en el selector del cargador. */
  public openSeries(viewer: ImagesViewerComponent, request: ViewSeriesRequest): void {
    this.openViewer();
    setTimeout(() => {
      switch (request.level) {
        case 'patient': viewer.ReViewPatient(request.uid); break;
        case 'study': viewer.ReViewStudy(request.uid); break;
        case 'modality': viewer.ReViewModality(request.uid); break;
        default: viewer.ReViewImage(request.uid);
      }
    }, 0);
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }
}
