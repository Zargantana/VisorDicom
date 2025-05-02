import { Component, OnInit } from '@angular/core';
import { LoginService } from 'src/app/services/login.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'login-floater',
  templateUrl: './login-floater.component.html',
  styleUrls: ['./login-floater.component.scss']
})
export class LoginFloaterComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public changeFloaterVisibility() {
    LoginService.floater_visible = !LoginService.floater_visible;
  }

}
