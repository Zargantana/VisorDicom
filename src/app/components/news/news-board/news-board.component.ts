import { Component } from '@angular/core';
import { NewsService } from 'src/app/services/news.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'news-board',
  templateUrl: './news-board.component.html',
  styleUrls: ['./news-board.component.scss']
})
export class NewsBoardComponent {

  public elfua: boolean = false;

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }
  
  public changeBannerVisibility() {
    NewsService.visible = !NewsService.visible;
    this.elfua = false;
  }

  public masClick() {
    this.elfua = true;
  }

  public menosClick() {
    this.elfua = false;
  }
}
