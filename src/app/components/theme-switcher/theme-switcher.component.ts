import { Component, OnInit } from '@angular/core';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'theme-switcher',
  templateUrl: './theme-switcher.component.html',
  styleUrls: ['./theme-switcher.component.scss']
})
export class ThemeSwitcherComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public switchTheme(): void {
    if (ThemeService.current === 'light') {
      ThemeService.current = 'dark';
    } else {
      ThemeService.current = 'light';
    }
  }

}