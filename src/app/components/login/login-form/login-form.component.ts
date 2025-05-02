import { AfterViewChecked, Component, ElementRef, ViewChild } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { LoginService } from 'src/app/services/login.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'login-form',
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.scss']
})
export class LoginFormComponent implements AfterViewChecked {

  @ViewChild('email') emailElement: ElementRef | undefined
  @ViewChild('password') passwordElement: ElementRef | undefined
  @ViewChild('submitButton') submitButtonElement: ElementRef | undefined

  form:UntypedFormGroup;

  public errorMessage: string = ''
  public loggingIn: boolean = false;

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  constructor(private fb:UntypedFormBuilder) {

      this.form = this.fb.group({
        email: ['',Validators.required], 
        password: ['',Validators.required]
      });
      console.log('Fet');
  }

  ngAfterViewChecked(): void {
    if (LoginService.shouldFoucs) {
      this.emailElement?.nativeElement.focus();
      if (this.emailElement) {
        this.emailElement.nativeElement.value = '';
      } 
      if (this.passwordElement) {
        this.passwordElement.nativeElement.value = '';
      }
      LoginService.shouldFoucs = false;
    }
  }

  public login(): void {
    if (!this.loggingIn) {
      const val = this.form.value;
      if (val.email && val.password) {
        this.loggingIn = true;
        this.hideError();
        window.setTimeout(() => {
          this.loggingIn = false;
        }, 3000);
      }
    }
  }

  private hideError() {
    this.errorMessage = '';
  }

  public Remember() {

  }

  public Register() {

  }

  public onEmailKeyPress(event: KeyboardEvent): boolean {
    if (event.key == 'Enter') {
      const val = this.form.value;
      if (val.email) {
        this.passwordElement?.nativeElement.focus();
        this.passwordElement?.nativeElement.select();
      } 
      event.stopPropagation();
      return false;
    }
    return true;
  }

  public onPassKeyPress(event: KeyboardEvent): boolean {
    const val = this.form.value;
    if ((event.key == 'Enter')&&(!val.password)) {
      event.stopPropagation();
      return false;
    }
    return true;
  }
}
