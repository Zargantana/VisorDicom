import { Pipe, PipeTransform } from '@angular/core';
import { I18n } from './i18n';
import { Texts } from './texts';

/**
 * `{{ 'menu.find' | t }}` o `{{ 'loader.reading' | t:leidos:total }}`.
 * Impuro a propósito: así el texto cambia en cuanto se elige otro idioma (la búsqueda es un acceso a un objeto).
 */
@Pipe({
  name: 't',
  pure: false,
  standalone: false
})
export class TPipe implements PipeTransform {
  transform(key: keyof Texts, ...args: unknown[]): string {
    return I18n.t(key, ...args);
  }
}
