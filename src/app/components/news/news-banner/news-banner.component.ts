import { Component } from '@angular/core';
import { NewsService } from 'src/app/services/news.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'news-banner',
  templateUrl: './news-banner.component.html',
  styleUrls: ['./news-banner.component.scss']
})
export class NewsBannerComponent {

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public changeBannerVisibility() {
    NewsService.visible = !NewsService.visible;
  }

}
