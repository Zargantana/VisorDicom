import { Component } from '@angular/core';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { ViewSeriesRequest } from 'src/app/components/images-loader/images-loader.component';
import { ImagesViewerComponent } from 'src/app/components/images-viewer/images-viewer.component';
import { ViewerFullscreen } from 'src/app/components/images-viewer/viewer-fullscreen';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
    selector: 'app-dir-loader',
    templateUrl: './dir-loader.component.html',
    styleUrls: ['./dir-loader.component.scss'],
    host: {
        class: 'd-flex slab-flex-1 flex-column m-0 p-0'
    },
    standalone: false
})
export class DirLoaderComponent {
  public foundDCMFiles: DCMFile[] = [];
  /** El visor se muestra cuando el usuario pulsa una serie del selector; la lectura sigue mientras tanto. */
  public showViewer: boolean = false;

  constructor() { }

  /** En pantalla completa del visor no hay barra ("Estudios encontrados"): solo la imagen */
  public viewerFullscreen(): boolean {
    return ViewerFullscreen.active;
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
