import { Component } from '@angular/core';
import { NewsService } from 'src/app/services/news.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
    selector: 'news-board',
    templateUrl: './news-board.component.html',
    styleUrls: ['./news-board.component.scss'],
    standalone: false
})
export class NewsBoardComponent {
  /** Vista de créditos y agradecimientos en lugar de las novedades */
  public creditos: boolean = false;

  public creditosClick(visible: boolean) {
    this.creditos = visible;
  }


  public elfua: boolean = false;

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }
  
  public changeBannerVisibility() {
    NewsService.visible = !NewsService.visible;
    this.elfua = false;
    this.creditos = false;
  }

  public masClick() {
    this.elfua = true;
  }

  public menosClick() {
    this.elfua = false;
  }
}
