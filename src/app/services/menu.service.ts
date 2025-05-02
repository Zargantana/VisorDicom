import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})

export class MenuService {

  public static expanded = true;

  constructor() {    
  }
}