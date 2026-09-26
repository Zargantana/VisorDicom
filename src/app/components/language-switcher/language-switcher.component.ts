import { Component, ElementRef, HostListener } from '@angular/core';
import { I18n } from 'src/app/i18n/i18n';
import { Lang, LANGS } from 'src/app/i18n/texts';
import { ThemeService } from 'src/app/services/theme.service';

/**
 * Botón de la barra superior con el idioma actual (ES, EN…) que despliega la lista de idiomas.
 * Cambiar de idioma no recarga la página: el pipe `t` repinta los textos en el siguiente ciclo.
 */
@Component({
    selector: 'language-switcher',
    templateUrl: './language-switcher.component.html',
    styleUrls: ['./language-switcher.component.scss'],
    standalone: false
})
export class LanguageSwitcherComponent {

  public readonly langs = LANGS;
  public open = false;
  /** Posición de la lista (fija respecto a la ventana: la barra superior recorta lo que sobresale con overflow hidden) */
  public listTop = 0;
  public listRight = 0;

  constructor(private host: ElementRef<HTMLElement>) { }

  public get current(): Lang {
    return I18n.current;
  }

  public get currentLabel(): string {
    return LANGS.find(l => l.code === I18n.current)?.label ?? I18n.current.toUpperCase();
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public toggle(): void {
    if (!this.open) this.place();
    this.open = !this.open;
  }

  /** La lista se pega bajo el botón, alineada a su borde derecho */
  private place(): void {
    const rect = this.host.nativeElement.querySelector('.lang-btn')?.getBoundingClientRect();
    if (!rect) return;
    this.listTop = rect.bottom + 2;
    this.listRight = Math.max(4, window.innerWidth - rect.right);
  }

  /** Si la ventana cambia, la posición guardada ya no vale: se cierra la lista */
  @HostListener('window:resize')
  @HostListener('window:scroll')
  public onWindowChange(): void {
    this.open = false;
  }

  public choose(lang: Lang): void {
    I18n.set(lang);
    this.open = false;
  }

  /** Un clic fuera del componente cierra la lista */
  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: Event): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    this.open = false;
  }
}
