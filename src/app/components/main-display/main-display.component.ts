import { Component, OnInit } from '@angular/core';
import { MenuService } from 'src/app/services/menu.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
    selector: 'main-display',
    templateUrl: './main-display.component.html',
    styleUrls: ['./main-display.component.scss'],
    standalone: false
})
export class MainDisplayComponent implements OnInit {

  public get menuExpanded(): boolean {
    return MenuService.expanded;
  } 

  public set menuExpanded(value: boolean) {
    MenuService.expanded = value;
  } 

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  ngOnInit(): void {
    // El menú desplegado es la portada. Si se entra directamente en otra ruta (un enlace de Google a /file-loader),
    // el menú tiene que arrancar plegado o tapa el contenido.
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/' && path !== '/reader') {
      MenuService.expanded = false;
    }
  }

}
