import { Component, OnInit } from '@angular/core';
import { NewsService } from 'src/app/services/news.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'product-information',
  templateUrl: './product-information.component.html',
  styleUrls: ['./product-information.component.scss']
})
export class ProductInformationComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public changeBannerVisibility() {
    NewsService.visible = !NewsService.visible;
  }

}