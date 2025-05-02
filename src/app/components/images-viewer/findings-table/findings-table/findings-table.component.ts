import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'findings-table',
  templateUrl: './findings-table.component.html',
  styleUrls: ['./findings-table.component.scss']
})
export class FindingsTableComponent implements OnInit {

  @Input() classifier: classifierDCM | undefined;

  @Output() reviewPatientClick = new EventEmitter<string>();
  @Output() reviewStudyClick = new EventEmitter<string>();
  @Output() reviewModalityClick = new EventEmitter<string>();
  @Output() reviewImageClick = new EventEmitter<string>();

  constructor() { }

  ngOnInit(): void {
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public ReViewImage(event: any, SOPInstanceUID: string) {
    this.reviewImageClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewModality(event: any, SOPInstanceUID: string) {
    this.reviewModalityClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewStudy(event: any, SOPInstanceUID: string) {
    this.reviewStudyClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewPatient(event: any, SOPInstanceUID: string) {
    this.reviewPatientClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }
}
