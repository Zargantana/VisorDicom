import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})

export class ThemeService {

  public static default = 'light';

  public static get current(): string {
    return localStorage.getItem('theme') ?? ThemeService.default;
  }

  public static set current(value: string) {
    localStorage.setItem('theme', value);
  }

  constructor() {    
  }
}
