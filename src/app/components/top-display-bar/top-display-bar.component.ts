import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoginService } from 'src/app/services/login.service';
import { MenuService } from 'src/app/services/menu.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'top-display-bar',
  templateUrl: './top-display-bar.component.html',
  styleUrls: ['./top-display-bar.component.scss']
})
export class TopDisplayBarComponent implements OnInit {

  public get userDisplayName(): string {
    return LoginService.userDisplayName;
  }

  public get isLoggedIn(): boolean {
    return false;
  }

  constructor(private router: Router) { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }
  
  ngOnInit(): void {
  }

  public visualizeLogin() {
    LoginService.floater_visible = true;
  }

}
