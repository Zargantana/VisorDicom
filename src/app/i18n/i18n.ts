import { CA } from './ca';
import { EN } from './en';
import { ES } from './es';
import { EU } from './eu';
import { GL } from './gl';
import { PT } from './pt';
import { Lang, LANGS, Texts } from './texts';

const DICTIONARIES: Record<Lang, Texts> = { es: ES, en: EN, ca: CA, eu: EU, gl: GL, pt: PT };

/**
 * Idioma de la interfaz. Estático como `ThemeService`: no hay que inyectar nada y el pipe `t` (impuro) vuelve a leer
 * el texto en cada ciclo de detección de cambios, así que cambiar de idioma repinta toda la aplicación sin recargar.
 *
 * - Por defecto español, siempre, salvo que haya una preferencia guardada (`localStorage`, clave `visordicom-lang`).
 *   No se mira el idioma del navegador: el servicio es español y así lo espera quien llega.
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

  /** Lee la preferencia guardada (si la hay y es válida); si no, español. */
  public static init(): void {
    this.initialized = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(this.STORAGE_KEY);
    } catch { /* sin almacenamiento */ }
    this.apply(this.isLang(saved) ? saved : this.default);
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
   * Idioma para el Managed Login de Cognito, que solo tiene un puñado (en, es, pt-BR, fr, de, it…): catalán, euskera y
   * gallego caen al español.
   */
  public static cognitoLang(): string {
    switch (this.current) {
      case 'en': return 'en';
      case 'pt': return 'pt-BR';
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
