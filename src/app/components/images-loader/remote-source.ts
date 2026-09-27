import { InjectionToken } from '@angular/core';

/**
 * Punto de extensión del cargador: de dónde sacar los ficheros de un enlace remoto (`/file-loader?qr=<token>`, el QR
 * que el portal pinta sobre el visor). El núcleo no sabe nada del API: el portal registra en `app.module.ts` un
 * proveedor que resuelve el token contra `/api/open/<token>` y devuelve URLs prefirmadas; VisorDicom no registra nada
 * y el parámetro se ignora. Inyectado con `@Optional()`, como `VIEWER_UPLOAD_HANDLER`.
 */
export interface LoaderRemoteSource {
  /** Ficheros del enlace: URL (GET, sin credenciales) y nombre. Rechaza si el enlace no existe o ha caducado. */
  resolve(token: string): Promise<{ url: string; fileName: string }[]>;
}

export const LOADER_REMOTE_SOURCE = new InjectionToken<LoaderRemoteSource>('LOADER_REMOTE_SOURCE');
