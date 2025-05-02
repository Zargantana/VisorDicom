import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})

export class LoginService {

  private static DEFAULTDISPLAYNAME = 'Identifícate'

  public static _floater_visible = false;
  
  public static get floater_visible(): boolean {
    return this._floater_visible;
  }

  public static set floater_visible(value: boolean) {
    this._floater_visible = value;
    this.shouldFoucs = value;
  }

  public static whereDoYouGoNow: string = '';
  public static shouldFoucs: boolean = false;

  public static get userDisplayName(): string {
    return LoginService.DEFAULTDISPLAYNAME;
  }
}
