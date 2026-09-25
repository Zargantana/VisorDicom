import { InjectionToken } from '@angular/core';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';

/**
 * Punto de extensión del visor para "guardar en la nube".
 *
 * El núcleo del visor (clases, diccionarios y estos componentes) se comparte con el repo open source
 * VisorDicom, que no tiene portal. Por eso los visores NO importan servicios del portal: si la aplicación
 * registra un VIEWER_UPLOAD_HANDLER aparecen el botón de subida y "Guardar"; si no lo registra
 * (VisorDicom), no aparecen.
 *
 * ReadyDoctor lo registra en app.module.ts con PortalViewerUploadHandler.
 */
export interface ViewerUploadHandler {
  prepareUpload(classifier: classifierDCM): void;
}

export const VIEWER_UPLOAD_HANDLER = new InjectionToken<ViewerUploadHandler>('VIEWER_UPLOAD_HANDLER');
