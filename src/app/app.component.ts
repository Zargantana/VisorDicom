import { Component } from '@angular/core';
import { LoginService } from './services/login.service';
import { NewsService } from './services/news.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'VisorDicom';

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public hideNewsBanner(): boolean {
    return !this.showNewsBanner();
  }

  private showNewsBanner(): boolean {
    return NewsService.visible;
  }

  public hideLogin(): boolean {
    return !this.showLogin();
  }

  private showLogin(): boolean {
    return LoginService.floater_visible;
  }
}
