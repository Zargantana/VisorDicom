/**
 * Textos de la interfaz que se traducen. Cada idioma implementa esta interfaz entera: si falta una clave, no compila.
 * Los `{0}`, `{1}` se sustituyen por los argumentos del pipe `t` (p. ej. `'loader.done' | t:dicom:total`).
 * No se traducen: las páginas legales (el texto válido es el español), las notas de la versión, el conformance
 * statement, los créditos, los mensajes técnicos del visor (motivos de los carteles, datos de la imagen) ni la
 * pantalla de pruebas.
 */
export type Lang = 'es' | 'en' | 'ca' | 'eu' | 'gl' | 'pt' | 'fr' | 'it' | 'de' | 'ja';

export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'ca', label: 'CA', name: 'Català' },
  { code: 'eu', label: 'EU', name: 'Euskara' },
  { code: 'gl', label: 'GL', name: 'Galego' },
  { code: 'pt', label: 'PT', name: 'Português' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'it', label: 'IT', name: 'Italiano' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'ja', label: 'JA', name: '日本語' },
];

export interface Texts {
  // Barra superior
  'topbar.login': string;
  'topbar.kind.doctor': string;
  'topbar.kind.patient': string;
  'topbar.kind.org': string;
  'topbar.news': string;
  'topbar.language': string;
  'topbar.theme': string;
  // Menú principal
  'menu.find': string;
  'menu.mine': string;
  'menu.request': string;
  // Portada del visor
  'home.title': string;
  'home.hint': string;
  'home.cd': string;
  'home.folder': string;
  'home.files': string;
  // Pantalla de carga
  'loader.chooseFiles': string;
  'loader.chooseFolder': string;
  'loader.view': string;
  'loader.back': string;
  'loader.drop.1': string;
  'loader.drop.or': string;
  'loader.drop.drag': string;
  'loader.drop.2': string;
  'loader.local': string;
  'loader.files': string;
  'loader.pending': string;
  'loader.read': string;
  'loader.dicom': string;
  'loader.reading': string;
  'loader.canView.before': string;
  'loader.canView.link': string;
  'loader.canView.after': string;
  'loader.done': string;
  'loader.found': string;
  'loader.series.one': string;
  'loader.series.many': string;
  'loader.pressOne': string;
  // Tabla de hallazgos
  'table.patient': string;
  'table.date': string;
  'table.study': string;
  'table.modality': string;
  'table.series': string;
  'table.images': string;
  'table.seriesWord': string;
  'table.image.one': string;
  'table.image.many': string;
  'table.noId': string;
  // Visor
  'viewer.save': string;
  'viewer.patientId': string;
  'viewer.studyDate': string;
  'viewer.modality': string;
  'viewer.seriesNumber': string;
  'viewer.image': string;
  'viewer.window': string;
  'viewer.windowVOI': string;
  'viewer.loading': string;
  'viewer.fullscreen': string;
  'viewer.exitFullscreen': string;
  // Novedades
  'news.title': string;
  'news.headline': string;
  'news.h1.b': string; 'news.h1.t': string;
  'news.h2.b': string; 'news.h2.t': string;
  'news.h3.b': string; 'news.h3.t': string;
  'news.h4.b': string; 'news.h4.t': string;
  'news.h5.b': string; 'news.h5.t': string;
  'news.h6.b': string; 'news.h6.t': string;
  'news.h7.b': string; 'news.h7.t': string;
  'news.h8.b': string; 'news.h8.t': string;
  'news.more': string;
  'news.less': string;
  'news.hist.1': string;
  'news.hist.2': string;
  'news.hist.3': string;
  'news.hist.4': string;
  'news.hist.5': string;
  'news.hist.6': string;
  'news.hist.7': string;
  'news.hist.8': string;
  'news.hist.9': string;
  'news.soon': string;
  'news.soon.1': string;
  'news.soon.2': string;
  'news.soon.3': string;
  'news.soon.5': string;
  'news.soon.6': string;
  'news.soon.7': string;
  'news.releaseNotes': string;
  'news.conformance': string;
  'news.credits': string;
  'news.creditsTitle': string;
  'news.backToNews': string;
  'legal.disclaimer': string;
  'legal.notice': string;
  'legal.privacy': string;
  // Portal: estudios guardados, compartir, subir
  'stored.title': string;
  'stored.shared': string;
  'share.legend': string;
  'share.consent': string;
  'share.email': string;
  'share.button': string;
  'share.sharing': string;
  'share.confirm': string;
  'upload.patient': string;
  'upload.email': string;
  'upload.anonymize': string;
  'upload.name': string;
  'upload.surname1': string;
  'upload.surname2': string;
  'upload.sex': string;
  'sex.unknown': string;
  'sex.male': string;
  'sex.female': string;
  'sex.other': string;
  'upload.birthdate': string;
  'upload.submit': string;
  'upload.preparing': string;
  'upload.uploading': string;
  'upload.uploadingShort': string;
  'upload.mine': string;
  'upload.mineConsent': string;
  'upload.status': string;
  'request.text': string;
  // Acceso
  'auth.identifying': string;
  'auth.close': string;
  'auth.back': string;
  'auth.done': string;
  'auth.failed': string;
  'auth.failedCode': string;
  'auth.cancelled': string;
  'auth.expired': string;
}
