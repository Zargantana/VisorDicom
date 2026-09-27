import { CA } from './ca';
import { DE } from './de';
import { EL } from './el';
import { EN } from './en';
import { ES } from './es';
import { EU } from './eu';
import { FR } from './fr';
import { GL } from './gl';
import { IT } from './it';
import { JA } from './ja';
import { KO } from './ko';
import { PT } from './pt';
import { RU } from './ru';
import { Lang, LANGS, Texts } from './texts';
import { ZH } from './zh';

const DICTIONARIES: Record<Lang, Texts> = {
  es: ES, en: EN, ca: CA, eu: EU, gl: GL, pt: PT, fr: FR, it: IT, de: DE, ja: JA, zh: ZH, ru: RU, ko: KO, el: EL,
};

/**
 * Idioma de la interfaz. Estático como `ThemeService`: no hay que inyectar nada y el pipe `t` (impuro) vuelve a leer
 * el texto en cada ciclo de detección de cambios, así que cambiar de idioma repinta toda la aplicación sin recargar.
 *
 * - Si hay una preferencia guardada (`localStorage`, clave `visordicom-lang`), manda. Si no, el idioma del navegador
 *   (`navigator.languages`, lo mismo que envía en `Accept-Language`) cuando es uno de los nuestros; para el resto del
 *   mundo, inglés. Un navegador en español (es-ES, es-MX…) sale en español, como antes. No se usa la geolocalización
 *   del CDN: el país no dice el idioma, y CloudFront solo podría pasarlo a la SPA con otra función y una cookie.
 * - `document.documentElement.lang` se actualiza para lectores de pantalla y correctores.
 * - Solo se traducen los textos de `Texts`. Las páginas legales, las notas de la versión, el conformance statement y
 *   los créditos siguen en español.
 */
export class I18n {

  public static readonly STORAGE_KEY = 'visordicom-lang';
  public static readonly default: Lang = 'es';

  private static _current: Lang = I18n.default;
  private static initialized = false;

  public static get current(): Lang {
    if (!this.initialized) this.init();
    return this._current;
  }

  /** Lee la preferencia guardada (si la hay y es válida); si no, el idioma del navegador o inglés. */
  public static init(): void {
    this.initialized = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(this.STORAGE_KEY);
    } catch { /* sin almacenamiento */ }
    this.apply(this.isLang(saved) ? saved : this.fromBrowser());
  }

  /**
   * Idioma inicial cuando no hay preferencia: el primero de los del navegador que tengamos (solo la parte de idioma:
   * `pt-BR` → `pt`, `es-419` → `es`); si ninguno coincide, inglés. Sin navegador (pruebas en Node), español.
   */
  public static fromBrowser(): Lang {
    let prefs: readonly string[] = [];
    try {
      prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    } catch {
      return this.default;
    }
    for (const pref of prefs) {
      const code = (pref ?? '').toLowerCase().split('-')[0];
      if (this.isLang(code)) return code;
    }
    return prefs.length ? 'en' : this.default;
  }

  /** Cambia el idioma y lo guarda como preferencia. */
  public static set(lang: Lang): void {
    if (!this.isLang(lang)) return;
    this.apply(lang);
    try {
      localStorage.setItem(this.STORAGE_KEY, lang);
    } catch { /* sin almacenamiento: vale solo para esta página */ }
  }

  /**
   * Idioma para el Managed Login de Cognito, que solo tiene un puñado (en, es, pt-BR, fr, de, it, ja, ko, zh-CN…):
   * catalán, euskera y gallego caen al español; ruso y griego, que Cognito no tiene, al inglés.
   */
  public static cognitoLang(): string {
    switch (this.current) {
      case 'en': return 'en';
      case 'pt': return 'pt-BR';
      case 'fr': return 'fr';
      case 'it': return 'it';
      case 'de': return 'de';
      case 'ja': return 'ja';
      case 'ko': return 'ko';
      case 'zh': return 'zh-CN';
      case 'ru':
      case 'el': return 'en';
      default: return 'es';
    }
  }

  public static isLang(value: unknown): value is Lang {
    return typeof value === 'string' && LANGS.some(l => l.code === value);
  }

  /** Texto de la clave en el idioma actual; `{0}`, `{1}`… se sustituyen por los argumentos. */
  public static t(key: keyof Texts, ...args: unknown[]): string {
    const text = DICTIONARIES[this.current][key] ?? ES[key] ?? key;
    return args.length ? text.replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined ? m : String(args[+i]))) : text;
  }

  private static apply(lang: Lang): void {
    this._current = lang;
    try {
      document.documentElement.lang = lang;
    } catch { /* sin DOM */ }
  }
}
