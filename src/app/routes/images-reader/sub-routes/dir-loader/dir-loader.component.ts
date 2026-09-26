import { Component } from '@angular/core';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
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
  /** El visor se muestra cuando el usuario lo pide con "Ver imágenes"; la lectura sigue mientras tanto. */
  public showViewer: boolean = false;

  constructor() { }

  /** Muestra el visor. Como estaba oculto, sus medidas eran cero: se le avisa como si la ventana cambiara de tamaño. */
  public openViewer(): void {
    this.showViewer = true;
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }
}
