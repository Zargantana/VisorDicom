/**
 * Estado global: el visor está en pantalla completa del navegador (lo mantiene `basic-image-viewer` a partir de
 * `fullscreenchange`). El portal (ReadyDoctor) y VisorDicom lo leen en `app.component` y `main-display` para esconder
 * la barra superior y el menú principal y dejar solo la pantalla del visor (con su barra de "Estudios encontrados").
 * Estático, como ThemeService: el núcleo no puede importar servicios del portal.
 */
export class ViewerFullscreen {
  public static active = false;
}
