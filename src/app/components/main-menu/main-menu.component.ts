import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LoginService } from 'src/app/services/login.service';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'main-menu',
  templateUrl: './main-menu.component.html',
  styleUrls: ['./main-menu.component.scss']
})
export class MainMenuComponent implements OnInit {

  @Input() expanded: boolean = true;
  @Output() expandedChange = new EventEmitter<boolean>();

  constructor() { }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  ngOnInit(): void {
  }

  public OnHomeClick(): boolean{
    this.expanded = true;
    this.expandedChange.emit(this.expanded);
    return true;
  }

  public OnMenuEntryClick(authRequired: boolean): boolean{
    if (authRequired) {
      this.expanded = false;
      this.expandedChange.emit(this.expanded);
    } else {
      this.expanded = false;
      this.expandedChange.emit(this.expanded);
    }
    return true;
  }
}
